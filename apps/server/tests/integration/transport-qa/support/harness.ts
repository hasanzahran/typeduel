import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { io, type Socket } from 'socket.io-client';
import { createRemoteJWKSet } from 'jose';
import {
  SessionReplySchema,
  type Reply,
  type SessionState,
  type MatchUpdate,
  type MatchSetup,
  type GameplayReplyData,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@typeduel/contracts';
import { createDatabase } from '../../../../src/db/client.js';
import { migrateDatabase } from '../../../../src/db/migrate.js';
import { acquireOwner } from '../../../../src/db/owner.js';
import { createMatchStore } from '../../../../src/db/match-store.js';
import { createGameRuntime } from '../../../../src/runtime.js';
import { createJwtVerifier } from '../../../../src/auth/verifier.js';
import type { FaultHook } from '../../../../src/db/types.js';
import type { RoundDescriptor } from '../../../../src/game/types.js';
import { createTokenIssuer } from './tokens.js';
import {
  createTestDatabase,
  ManualClock,
  deferred,
  eventually,
  barrier,
  settle,
  durableRows,
  type TestDatabase,
} from '../../qa/support/harness.js';
export {
  deferred,
  eventually,
  barrier,
  settle,
  durableRows,
  createTestDatabase,
  ManualClock,
};
export type { TestDatabase };

type RuntimeOptions = Parameters<typeof createGameRuntime>[0];
export type RuntimeHooks = NonNullable<RuntimeOptions['hooks']>;
export const DEFAULT_SETUP: MatchSetup = {
  mode: 'classic',
  categorySlug: 'general',
  difficulty: 1,
};
export const RESULT_HOLD_MS = 50;

export function success<T>(reply: Reply<T>): T {
  if (!reply.ok)
    throw new Error(`Unexpected transport failure: ${reply.error.code}`);
  return reply.data;
}

export function createSource() {
  const descriptors = new Map<string, RoundDescriptor>();
  let available = true;
  let beforeNext: (() => Promise<void>) | undefined;
  const calls: { matchId: string; roundNumber: number }[] = [];
  const source: RuntimeOptions['source'] = {
    async checkAvailability() {
      return available;
    },
    async nextRound(input) {
      calls.push({ matchId: input.matchId, roundNumber: input.roundNumber });
      await beforeNext?.();
      const key = `${input.matchId}:${input.roundNumber}`;
      let descriptor = descriptors.get(key);
      if (!descriptor) {
        descriptor = {
          roundId: randomUUID(),
          wordId: randomUUID(),
          canonicalText: `qa-secret-${input.roundNumber}`,
          acceptedVariants: [`qa-variant-${input.roundNumber}`],
          level: input.level,
          categorySlugs: ['animals', 'food', 'sports', 'technology'],
          audio: {
            assetId: randomUUID(),
            audioVersion: randomUUID(),
            url: `https://audio.invalid/${randomUUID()}`,
            clipDurationMs: 500,
            sha256: 'a'.repeat(64),
          },
        };
        descriptors.set(key, descriptor);
      }
      return structuredClone(descriptor);
    },
  };
  return {
    source,
    calls,
    descriptors,
    setAvailable(value: boolean) {
      available = value;
    },
    setGate(value?: () => Promise<void>) {
      beforeNext = value;
    },
  };
}

export interface Peer {
  playerId: string;
  token: string;
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  events: { event: string; payload: unknown }[];
  replies: { event: string; payload: unknown }[];
  session: SessionState;
  request<T>(
    event: string,
    payload: unknown,
    timeoutMs?: number,
  ): Promise<Reply<T>>;
  fire(event: string, payload: unknown): void;
  sync(): Promise<SessionState>;
  match(matchId: string): Promise<MatchUpdate>;
  close(): void;
}

export async function connectPeer(
  origin: string,
  token: string,
  playerId: string,
  db: TestDatabase,
): Promise<Peer> {
  const socket: Peer['socket'] = io(`${origin}/game`, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
    auth: { accessToken: token },
    timeout: 3_000,
  });
  db.cleanupWith(() => {
    socket.disconnect();
  });
  const events: Peer['events'] = [];
  const replies: Peer['replies'] = [];
  socket.onAny((event: string, payload: unknown) =>
    events.push({ event, payload }),
  );
  const send = (
    event: string,
    payload: unknown,
    ack: (reply: unknown) => void,
  ) => {
    (
      socket.emit as unknown as (
        event: string,
        payload: unknown,
        ack: (reply: unknown) => void,
      ) => void
    )(event, payload, ack);
  };
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Socket connection timed out')),
      4_000,
    );
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.connect();
  });
  const peer: Peer = {
    playerId,
    token,
    socket,
    events,
    replies,
    session: undefined as unknown as SessionState,
    request<T>(event: string, payload: unknown, timeoutMs = 5_000) {
      if (!socket.connected)
        return Promise.reject(new Error('Socket is disconnected'));
      return new Promise<Reply<T>>((resolve, reject) => {
        const disconnected = () => {
          clearTimeout(timer);
          reject(new Error('Socket disconnected before reply'));
        };
        const timer = setTimeout(() => {
          socket.off('disconnect', disconnected);
          reject(new Error(`Missing ${event} reply`));
        }, timeoutMs);
        socket.once('disconnect', disconnected);
        send(event, payload, (reply) => {
          clearTimeout(timer);
          socket.off('disconnect', disconnected);
          replies.push({ event, payload: reply });
          resolve(reply as Reply<T>);
        });
      });
    },
    fire(event, payload) {
      send(event, payload, (reply) => replies.push({ event, payload: reply }));
    },
    async sync() {
      const response = SessionReplySchema.parse(
        await peer.request<SessionState>('session.sync', {
          requestId: randomUUID(),
        }),
      );
      peer.session = success(response);
      return peer.session;
    },
    async match(matchId) {
      return success(
        await peer.request<MatchUpdate>('match.sync', {
          requestId: randomUUID(),
          matchId,
          lastSeenVersion: 0,
        }),
      );
    },
    close() {
      socket.disconnect();
    },
  };
  await peer.sync();
  return peer;
}

export async function createHarness(
  options: { config?: RuntimeOptions['config'] } = {},
) {
  const testDb = await createTestDatabase();
  try {
    const clock = new ManualClock(1_000);
    const tokens = await createTokenIssuer(() => clock.utcNow());
    testDb.cleanupWith(() => tokens.close());
    const connectionString = testDb.config.connectionString!;
    await migrateDatabase({ connectionString, schemaName: testDb.schema });
    const database = createDatabase({
      connectionString,
      schemaName: testDb.schema,
    });
    testDb.cleanupWith(() => database.close());
    const owner = await acquireOwner({
      connectionString,
      schemaName: testDb.schema,
      ownerId: randomUUID(),
    });
    testDb.cleanupWith(() => owner.release());
    let fault: FaultHook = () => {};
    const store = createMatchStore({
      database,
      hooks: (point, context) => fault(point, context),
    });
    const verifier = createJwtVerifier({
      issuer: tokens.issuer,
      audience: 'authenticated',
      key: createRemoteJWKSet(new URL(tokens.jwksUrl), {
        cooldownDuration: 0,
        timeoutDuration: 1_000,
      }),
      nowUtcMs: () => clock.utcNow(),
    });
    const content = createSource();
    let outbound: NonNullable<RuntimeHooks['outbound']> = () => 'send';
    let admission: NonNullable<
      RuntimeHooks['afterGameplayAdmission']
    > = () => {};
    let lifecycle: NonNullable<
      RuntimeHooks['afterLifecycleCapture']
    > = () => {};
    const packets: Parameters<NonNullable<RuntimeHooks['outbound']>>[0][] = [];
    const ingress: Parameters<
      NonNullable<RuntimeHooks['afterGameplayAdmission']>
    >[0][] = [];
    const runtime = await createGameRuntime({
      database,
      owner,
      store,
      clock,
      verifier,
      source: content.source,
      config: {
        resultHoldMs: RESULT_HOLD_MS,
        reconcileIntervalMs: 10,
        sourceTimeoutMs: 2_000,
        ...options.config,
      },
      hooks: {
        actor: (point, context) => fault(point, context),
        outbound(packet) {
          packets.push(structuredClone(packet));
          return outbound(packet);
        },
        afterGameplayAdmission(event) {
          ingress.push(structuredClone(event));
          admission(event);
        },
        afterLifecycleCapture(event) {
          lifecycle(event);
        },
      },
    });
    testDb.cleanupWith(() => runtime.close());
    const origin = await runtime.listen({ host: '127.0.0.1', port: 0 });
    return {
      testDb,
      clock,
      tokens,
      database,
      owner,
      store,
      runtime,
      origin,
      content,
      packets,
      ingress,
      setFault(value: FaultHook) {
        fault = value;
      },
      setOutbound(value: NonNullable<RuntimeHooks['outbound']>) {
        outbound = value;
      },
      setLifecycleObserver(
        value: NonNullable<RuntimeHooks['afterLifecycleCapture']>,
      ) {
        lifecycle = value;
      },
      setAdmissionObserver(
        value: NonNullable<RuntimeHooks['afterGameplayAdmission']>,
      ) {
        admission = value;
      },
      async connect(playerId: string = randomUUID(), token?: string) {
        return connectPeer(
          origin,
          token ?? (await tokens.sign(playerId)),
          playerId,
          testDb,
        );
      },
      async advance(at: number) {
        clock.set(at, true);
        await runtime.reconcile();
      },
      http<T>(peer: Peer, method: string, path: string, body?: unknown) {
        return httpRequest<T>(origin, peer, method, path, body);
      },
    };
  } catch (error) {
    await testDb.dispose();
    throw error;
  }
}
export async function httpRequest<T>(
  origin: string,
  peer: Peer,
  method: string,
  path: string,
  body?: unknown,
) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${peer.token}`,
      'x-typeduel-session-id': peer.session.sessionId,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    reply: (await response.json()) as Reply<T>,
  };
}
export type Harness = Awaited<ReturnType<typeof createHarness>>;

export async function mutate(
  peer: Peer,
  event: string,
  extra: Record<string, unknown> = {},
  requestId = randomUUID(),
) {
  const current = await peer.sync();
  const reply = await peer.request<SessionState>(event, {
    requestId,
    expectedAdmissionRevision: current.admissionRevision,
    ...extra,
  });
  if (reply.ok) peer.session = reply.data;
  return reply;
}
export async function privateLobby(
  h: Pick<Harness, 'http'>,
  a: Peer,
  b?: Peer,
  setup: MatchSetup = DEFAULT_SETUP,
) {
  const current = await a.sync();
  const created = await h.http<SessionState>(a, 'POST', '/v1/rooms', {
    requestId: randomUUID(),
    expectedAdmissionRevision: current.admissionRevision,
    setup,
  });
  a.session = success(created.reply);
  if (a.session.admission.kind !== 'lobby')
    throw new Error('Room create did not create lobby');
  const lobby = a.session.admission.lobby;
  if (!lobby.inviteCode) throw new Error('Private invite code missing');
  if (b) {
    const joined = await h.http<SessionState>(
      b,
      'POST',
      `/v1/rooms/${lobby.inviteCode}/join`,
      {
        requestId: randomUUID(),
        expectedAdmissionRevision: (await b.sync()).admissionRevision,
      },
    );
    b.session = success(joined.reply);
    await a.sync();
  }
  return lobby;
}
export async function readyLobby(a: Peer, b: Peer, lobbyId: string) {
  success(await mutate(a, 'lobby.ready', { lobbyId, ready: true }));
  return mutate(b, 'lobby.ready', { lobbyId, ready: true });
}
export async function waitMatch(peer: Peer, eventsFrom = 0) {
  await eventually(
    async () =>
      peer.events
        .slice(eventsFrom)
        .some((event) => event.event === 'match.found'),
    'committed match discovery event',
  );
  const state = await peer.sync();
  if (state.admission.kind !== 'match')
    throw new Error('Match admission missing');
  return state.admission.update;
}
export async function startMatch(
  h: Pick<Harness, 'http'>,
  a: Peer,
  b: Peer,
  setup: MatchSetup = DEFAULT_SETUP,
) {
  const lobby = await privateLobby(h, a, b, setup);
  const aFrom = a.events.length;
  const bFrom = b.events.length;
  success(await readyLobby(a, b, lobby.lobbyId));
  const match = await waitMatch(a, aFrom);
  const other = await waitMatch(b, bFrom);
  if (match.matchId !== other.matchId)
    throw new Error('Players admitted to different matches');
  return match.matchId;
}
export async function readyRound(
  h: Pick<Harness, 'store' | 'clock' | 'advance'>,
  a: Peer,
  b: Peer,
  matchId: string,
) {
  let record = await h.store.readCommitted(matchId);
  if (record?.state.phase === 'ROUND_RESULT')
    await h.advance(h.clock.monoNow() + RESULT_HOLD_MS + 1);
  await eventually(async () => {
    record = await h.store.readCommitted(matchId);
    return (
      record?.state.phase === 'PREPARING_ROUND' && record.state.round !== null
    );
  }, 'next private round preparation');
  const round = record!.state.round!;
  for (const peer of [a, b])
    success(
      await peer.request<GameplayReplyData>('round.audio_ready', {
        matchId,
        roundId: round.roundId,
        audioVersion: round.audio.audioVersion,
      }),
    );
  const scheduled = (await h.store.readCommitted(matchId))!;
  const schedule = scheduled.state.round!.monoSchedule;
  if (!schedule)
    throw new Error('Both audio ready commands did not schedule a round');
  await h.advance(schedule.typingStartAt);
  await eventually(
    async () =>
      (await h.store.readCommitted(matchId))?.state.phase === 'ACTIVE_TYPING',
    'typing start',
  );
  return { round, schedule };
}
export const answer = (
  matchId: string,
  roundId: string,
  text: string,
  attemptId = randomUUID(),
) => ({ matchId, roundId, attemptId, text });

export function spawnTransportChild(testDb: TestDatabase) {
  const child = fork(new URL('./transport-child.ts', import.meta.url), [], {
    execArgv: ['--import', 'tsx'],
    serialization: 'advanced',
    silent: true,
    env: { ...process.env, TEST_DATABASE_URL: testDb.config.connectionString },
  });
  const pending = new Map<number, ReturnType<typeof deferred<unknown>>>();
  const barriers = new Map<string, ReturnType<typeof deferred<void>>>();
  const exited = deferred<void>();
  const output: string[] = [];
  let nextId = 0;
  let ended = false;
  child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  child.on(
    'message',
    (message: {
      kind: string;
      id?: number;
      point?: string;
      ok?: boolean;
      value?: unknown;
    }) => {
      if (message.kind === 'reply' && message.id !== undefined) {
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        if (message.ok) waiter?.resolve(message.value);
        else waiter?.reject(new Error('Transport child operation failed'));
      } else if (message.kind === 'barrier' && message.point) {
        let gate = barriers.get(message.point);
        if (!gate) {
          gate = deferred<void>();
          barriers.set(message.point, gate);
        }
        gate.resolve();
      }
    },
  );
  child.once('exit', () => {
    ended = true;
    for (const waiter of pending.values())
      waiter.reject(new Error('Transport child exited'));
    pending.clear();
    exited.resolve();
  });
  const kill = async () => {
    if (!ended) child.kill('SIGKILL');
    await exited.promise;
  };
  testDb.cleanupWith(kill);
  return {
    output,
    request<T>(action: string, payload: unknown = {}) {
      const id = nextId++;
      const waiter = deferred<unknown>();
      if (ended)
        return Promise.reject(new Error('Transport child already exited'));
      pending.set(id, waiter);
      child.send({ id, action, payload });
      return waiter.promise as Promise<T>;
    },
    reached(point: string) {
      let gate = barriers.get(point);
      if (!gate) {
        gate = deferred<void>();
        barriers.set(point, gate);
      }
      return gate.promise;
    },
    kill,
  };
}
