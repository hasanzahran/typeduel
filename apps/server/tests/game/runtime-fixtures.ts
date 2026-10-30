import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { vi } from 'vitest';
import type { Database } from '../../src/db/client.js';
import {
  StoreError,
  type DiscoverableMatchStore,
  type PersistedMatch,
  type OwnerLease,
} from '../../src/db/types.js';
import { createGameRuntime } from '../../src/runtime.js';
import type { RuntimeHooks } from '../../src/runtime.js';
import type { Reply, SessionState } from '@typeduel/contracts';

export async function testRuntime(
  hooks?: RuntimeHooks,
  options: { checkAvailability?: () => Promise<boolean> } = {},
) {
  const records = new Map<string, PersistedMatch>();
  const bindings = new Map<string, string>();
  let now = 1000;
  let active = true;
  const jobs = new Map<symbol, { at: number; run: () => void }>();
  const lost = new Set<() => void>();
  const clock = {
    monoNow() {
      if (this !== clock) throw new Error('Clock receiver lost');
      return now;
    },
    utcNow() {
      if (this !== clock) throw new Error('Clock receiver lost');
      return 1800000000000 + now;
    },
    schedule(at: number, run: () => void) {
      const id = Symbol();
      jobs.set(id, { at, run });
      return () => {
        jobs.delete(id);
      };
    },
  };
  const owner: OwnerLease = {
    token: { ownerId: randomUUID(), epoch: 1n },
    schemaName: 'test',
    backendPid: 0,
    isActive: () => active,
    onLost(fn) {
      lost.add(fn);
      return () => {
        lost.delete(fn);
      };
    },
    async release() {
      active = false;
      for (const fn of lost) fn();
    },
  };
  const store: DiscoverableMatchStore = {
    createMatch: vi.fn(async ({ state, operationId }) => {
      const record = {
        state: structuredClone(state),
        storeRevision: 1n,
        lastOperationId: operationId,
        owner: owner.token,
      };
      records.set(state.matchId, record);
      for (const p of state.participants)
        bindings.set(p.playerId, state.matchId);
      return structuredClone(record);
    }),
    commitTransition: vi.fn(
      async ({ matchId, expectedRevision, operationId, candidate }) => {
        const previous = records.get(matchId);
        if (!previous || previous.storeRevision !== expectedRevision)
          throw new StoreError('CONFLICT');
        const record = {
          state: structuredClone(candidate.state),
          storeRevision: expectedRevision + 1n,
          lastOperationId: operationId,
          owner: owner.token,
        };
        records.set(matchId, record);
        return structuredClone(record);
      },
    ),
    async readCommitted(id) {
      return structuredClone(records.get(id) ?? null);
    },
    async readLatestForPlayer(id) {
      return structuredClone(records.get(bindings.get(id) ?? '') ?? null);
    },
    async resolveOperation({ matchId, operationId, expectedRevision }) {
      const record = records.get(matchId);
      if (record?.lastOperationId === operationId)
        return { status: 'committed', match: structuredClone(record) };
      return !record && expectedRevision === 0n
        ? { status: 'rolled_back' }
        : { status: 'unresolved' };
    },
    async interruptOrphans() {
      return 0;
    },
  };
  const runtime = await createGameRuntime({
    database: {
      pool: { query: async () => ({ rows: [] }) },
    } as unknown as Database,
    owner,
    store,
    clock,
    verifier: {
      async verifyAccessToken(token) {
        return { playerId: token, expiresAtUtcMs: clock.utcNow() + 3600000 };
      },
    },
    source: {
      async checkAvailability() {
        if (options.checkAvailability) return options.checkAvailability();
        return true;
      },
      async nextRound(input) {
        return {
          roundId: randomUUID(),
          wordId: randomUUID(),
          canonicalText: `synthetic-${input.roundNumber}`,
          acceptedVariants: [],
          level: input.level,
          categorySlugs: ['animals', 'food', 'sports', 'technology'],
          audio: {
            assetId: randomUUID(),
            audioVersion: randomUUID(),
            url: 'https://audio.invalid/opaque',
            clipDurationMs: 500,
            sha256: 'a'.repeat(64),
          },
        };
      },
    },
    config: { resultHoldMs: 0 },
    ...(hooks ? { hooks } : {}),
  });
  const origin = await runtime.listen();
  const sockets: Socket[] = [];
  return {
    runtime,
    store,
    records,
    owner,
    origin,
    clock,
    async connect(playerId = randomUUID()) {
      const socket = io(`${origin}/game`, {
        transports: ['websocket'],
        reconnection: false,
        auth: { accessToken: playerId },
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
      });
      return { socket, playerId };
    },
    setNow(at: number) {
      now = at;
    },
    async advance(at: number) {
      now = at;
      for (let i = 0; i < 50; i++) {
        const due = [...jobs].filter(([, job]) => job.at <= now);
        if (!due.length) {
          await new Promise<void>(setImmediate);
          if (![...jobs.values()].some((job) => job.at <= now)) break;
          continue;
        }
        for (const [id, job] of due) {
          jobs.delete(id);
          job.run();
        }
        await new Promise<void>(setImmediate);
      }
    },
    async close() {
      for (const socket of sockets) socket.disconnect();
      await runtime.close();
    },
  };
}
export function call<T>(
  socket: Socket,
  event: string,
  payload: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    socket
      .timeout(3000)
      .emit(event, payload, (error: Error | null, reply: Reply<T>) => {
        if (error) reject(error);
        else if (!reply.ok) reject(new Error(reply.error.code));
        else resolve(reply.data);
      });
  });
}
export const sync = (socket: Socket) =>
  call<SessionState>(socket, 'session.sync', { requestId: randomUUID() });
export async function pair(h: Awaited<ReturnType<typeof testRuntime>>) {
  const a = await h.connect(),
    b = await h.connect();
  const setup = {
    mode: 'classic' as const,
    difficulty: 1 as const,
    categorySlug: 'general' as const,
  };
  for (const client of [a, b]) {
    const s = await sync(client.socket);
    await call(client.socket, 'queue.join', {
      requestId: randomUUID(),
      expectedAdmissionRevision: s.admissionRevision,
      setup,
    });
  }
  for (const client of [a, b]) {
    const s = await sync(client.socket);
    if (s.admission.kind !== 'lobby') throw new Error('No lobby');
    await call(client.socket, 'lobby.ready', {
      requestId: randomUUID(),
      expectedAdmissionRevision: s.admissionRevision,
      lobbyId: s.admission.lobby.lobbyId,
      ready: true,
    });
  }
  for (let i = 0; i < 10; i++) {
    await h.advance(1000);
    const s = await sync(a.socket);
    if (
      s.admission.kind === 'match' &&
      s.admission.update.snapshot.phase === 'PREPARING_ROUND' &&
      s.admission.update.snapshot.round
    )
      return { a, b, state: s };
  }
  throw new Error('No prepared match');
}
