import type { FaultHook } from './db/types.js';
export interface RuntimeConfig {
  region: string;
  lobbyTtlMs: number;
  lobbyGraceMs: number;
  resultHoldMs: number;
  reconcileIntervalMs: number;
  sourceTimeoutMs: number;
  allowedOrigins: string[];
  maxPlayers: number;
}
export interface RuntimeHooks {
  afterLifecycleCapture?: (event: {
    event: 'player.disconnect' | 'player.reconnect';
    playerId: string;
    matchId: string;
  }) => void;
  actor?: FaultHook;
  outbound?: (event: {
    kind: 'event' | 'ack';
    event: string;
    playerId: string;
    payload: unknown;
  }) => 'send' | 'drop';
  afterGameplayAdmission?: (event: {
    event: string;
    playerId: string;
    matchId: string;
    attemptId?: string;
  }) => void;
}

import { randomUUID } from 'node:crypto';
import type { Database } from './db/client.js';
import type { DiscoverableMatchStore, OwnerLease } from './db/types.js';
import { createMatchStore } from './db/match-store.js';
import { createSystemClock, type ActorClock } from './game/clock.js';
import type { TokenVerifier } from './auth/verifier.js';
import type { RoundSource } from './game/source.js';
import { buildApp } from './app.js';
import { createRegistry } from './game/registry.js';
import { createCoordinator } from './matchmaking/coordinator.js';
import { createSessions } from './socket/session.js';
import { createHandlers } from './socket/handlers.js';
import { attachGameSocket } from './socket/server.js';
import { roomRoutes } from './http/rooms.js';
export async function createGameRuntime(options: {
  database: Database;
  owner: OwnerLease;
  store?: DiscoverableMatchStore;
  clock?: ActorClock;
  verifier: TokenVerifier;
  source: RoundSource;
  config?: Partial<RuntimeConfig>;
  hooks?: RuntimeHooks | undefined;
}) {
  const { database, owner, verifier, source, hooks } = options;
  const store = options.store ?? createMatchStore({ database });
  const clock = options.clock ?? createSystemClock();
  const config: RuntimeConfig = {
    region: 'development',
    lobbyTtlMs: 600000,
    lobbyGraceMs: 10000,
    resultHoldMs: 1500,
    reconcileIntervalMs: 250,
    sourceTimeoutMs: 5000,
    allowedOrigins: [],
    maxPlayers: 1000,
    ...options.config,
  };
  for (const key of [
    'lobbyTtlMs',
    'lobbyGraceMs',
    'resultHoldMs',
    'reconcileIntervalMs',
    'sourceTimeoutMs',
    'maxPlayers',
  ] as const)
    if (
      !Number.isSafeInteger(config[key]) ||
      config[key] < 0 ||
      (key !== 'resultHoldMs' && config[key] === 0)
    )
      throw new Error('Invalid runtime configuration');
  await store.interruptOrphans(owner);
  if (!owner.isActive()) throw new Error('Server unavailable');
  const app = buildApp();
  let closed = false;
  const registry = createRegistry({
    store,
    owner,
    clock,
    source,
    config,
    hooks,
    publish: (id, update) => coordinator.publish(id, update),
  });
  const coordinator = createCoordinator({
    store,
    clock,
    registry,
    config,
    serverInstanceId: randomUUID(),
    sessions: () => sessions,
  });
  const sessions = createSessions({
    clock,
    maxPlayers: config.maxPlayers,
    canConnect: coordinator.canConnect,
    onConnect: coordinator.connect,
    onDisconnect: coordinator.disconnect,
  });
  const handle = createHandlers({
    sessions,
    coordinator,
    registry,
    clock,
    hooks,
  });
  const socket = attachGameSocket(app, {
    sessions,
    verifier,
    clock,
    allowedOrigins: config.allowedOrigins,
    hooks,
    handle,
  });
  roomRoutes(app, { sessions, coordinator, verifier, clock, hooks });
  app.get('/health/ready', async (_request, reply) => {
    try {
      if (closed || !owner.isActive()) throw new Error();
      await database.pool.query('SELECT 1');
      if (!owner.isActive()) throw new Error();
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
  let cancelRecovery = () => {};
  const recover = () => {
    if (!closed)
      cancelRecovery = clock.schedule(
        clock.monoNow() + config.reconcileIntervalMs,
        () => {
          void registry.reconcile().finally(recover);
        },
      );
  };
  recover();
  const removeOwnerListener = owner.onLost(() => {
    void close();
  });
  async function close() {
    if (closed) return;
    closed = true;
    removeOwnerListener();
    cancelRecovery();
    coordinator.close();
    registry.close();
    sessions.close();
    await socket.close();
    await app.close();
  }
  return {
    app,
    async listen(input: { host?: string; port?: number } = {}) {
      return app.listen({
        host: input.host ?? '127.0.0.1',
        port: input.port ?? 0,
      });
    },
    reconcile: () => registry.reconcile(),
    close,
  };
}
