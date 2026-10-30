import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool, type PoolConfig } from 'pg';
import { createDatabase } from '../../../../src/db/client.js';
import { migrateDatabase } from '../../../../src/db/migrate.js';
import { acquireOwner } from '../../../../src/db/owner.js';
import { createMatchStore } from '../../../../src/db/match-store.js';
import { createMatchActor } from '../../../../src/game/actor.js';
import { applyCommand } from '../../../../src/game/engine.js';
import type { ActorClock } from '../../../../src/game/clock.js';
import type {
  GameCommand,
  TransitionResult,
} from '../../../../src/game/types.js';
import type {
  CommittedUpdate,
  FaultHook,
  PersistedMatch,
} from '../../../../src/db/types.js';
import {
  createFixtureMatch,
  createRoundDescriptor,
  prepareReadyRound,
  receiptAt,
  tickAt,
} from '../../../game/fixtures.js';

export const TEST_TIMEOUT_MS = 20_000;

export interface TestDatabase {
  schema: string;
  config: PoolConfig;
  pool: Pool;
  createPool(): Pool;
  cleanupWith(action: () => Promise<void> | void): void;
  dispose(): Promise<void>;
}

const quoteIdentifier = (name: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name))
    throw new Error('Unsafe test SQL identifier');
  return `"${name}"`;
};

/** Only this freshly generated namespace can be removed by the harness. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString)
    throw new Error(
      'TEST_DATABASE_URL is required for real PostgreSQL integration tests',
    );
  const schema = `typeduel_qa_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await admin.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
  } catch (error) {
    await admin.end();
    throw error;
  }
  const config: PoolConfig = {
    connectionString,
    options: `-c search_path=${schema},pg_catalog`,
    connectionTimeoutMillis: 5_000,
    max: 8,
    application_name: schema,
  };
  const pools: Pool[] = [];
  const cleanup: (() => Promise<void> | void)[] = [];
  const createPool = () => {
    const pool = new Pool(config);
    pools.push(pool);
    return pool;
  };
  const pool = createPool();
  let disposed = false;
  return {
    schema,
    config,
    pool,
    createPool,
    cleanupWith: (action) => cleanup.push(action),
    async dispose() {
      if (disposed) return;
      disposed = true;
      try {
        for (const action of cleanup.reverse()) await action();
        await Promise.all(pools.map((entry) => entry.end()));
        await admin.query(`DROP SCHEMA ${quoteIdentifier(schema)} CASCADE`);
      } finally {
        await admin.end();
      }
    },
  };
}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Deterministic failure barriers, rather than timing-sensitive sleeps. */
export function barrier(db?: TestDatabase) {
  const reached = deferred<void>();
  const released = deferred<void>();
  db?.cleanupWith(() => released.resolve());
  return {
    reached: reached.promise,
    release: () => released.resolve(),
    async pause() {
      reached.resolve();
      await released.promise;
    },
  };
}

export async function eventually(
  assertion: () => Promise<boolean>,
  description: string,
  timeoutMs = 5_000,
): Promise<void> {
  const end = performance.now() + timeoutMs;
  do {
    if (await assertion()) return;
    await delay(10);
  } while (performance.now() < end);
  throw new Error(`Timed out waiting for ${description}`);
}

export async function durableRows(
  pool: Pool,
): Promise<Record<string, unknown[]>> {
  const tables = await pool.query<{ table_name: string }>(
    'SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = $1 ORDER BY table_name',
    ['BASE TABLE'],
  );
  const snapshot: Record<string, unknown[]> = {};
  for (const { table_name: name } of tables.rows) {
    const rows = await pool.query<{ row: unknown }>(
      `SELECT to_jsonb(t) AS row FROM ${quoteIdentifier(name)} AS t`,
    );
    snapshot[name] = rows.rows
      .map(({ row }) => row)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return snapshot;
}

export async function settle<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

export class ManualClock implements ActorClock {
  private readonly callbacks = new Map<
    number,
    { at: number; callback: () => void }
  >();
  private nextId = 0;
  constructor(
    private now: number,
    private readonly utc = 1_800_000_000_000,
    private readonly origin = now,
  ) {}
  monoNow() {
    return this.now;
  }
  utcNow() {
    return this.utc + this.now - this.origin;
  }
  schedule(at: number, callback: () => void) {
    const id = this.nextId++;
    this.callbacks.set(id, { at, callback });
    return () => {
      this.callbacks.delete(id);
    };
  }
  set(at: number, fire = false) {
    if (at < this.now) throw new Error('Test clock cannot move backwards');
    this.now = at;
    if (fire) {
      // A callback may cancel/rearm another already-due timer. Re-read after
      // every callback so the replacement runs at this same trusted time.
      for (let dispatched = 0; dispatched < 1_000; dispatched += 1) {
        const due = [...this.callbacks.entries()]
          .filter(([, timer]) => timer.at <= at)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) return;
        const [id, timer] = due;
        this.callbacks.delete(id);
        timer.callback();
      }
      throw new Error('Test clock exceeded due callback dispatch bound');
    }
  }
}

export async function createScenario(
  setup?: Parameters<typeof createFixtureMatch>[0],
) {
  const testDb = await createTestDatabase();
  try {
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
    const hooks: FaultHook = (point, context) => fault(point, context);
    const store = createMatchStore({ database, hooks });
    await store.interruptOrphans(owner);
    let record = await store.createMatch({
      owner,
      operationId: randomUUID(),
      state: createFixtureMatch(setup),
    });
    const publications: { viewerId: string; update: CommittedUpdate }[] = [];
    const clock = new ManualClock(record.state.lastInput.atMonoMs);
    return {
      testDb,
      database,
      owner,
      store,
      clock,
      publications,
      get record() {
        return record;
      },
      set record(value: PersistedMatch) {
        record = value;
      },
      setFault(hook: FaultHook) {
        fault = hook;
      },
      actor(initial = record) {
        clock.set(Math.max(clock.monoNow(), initial.state.lastInput.atMonoMs));
        const actor = createMatchActor({
          store,
          owner,
          initial,
          clock,
          hooks,
          publish: (viewerId, update) =>
            publications.push({ viewerId, update: structuredClone(update) }),
        });
        testDb.cleanupWith(() => actor.close());
        return actor;
      },
    };
  } catch (error) {
    await testDb.dispose();
    throw error;
  }
}

export type Scenario = Awaited<ReturnType<typeof createScenario>>;

export async function persistCandidate(
  scenario: Scenario,
  candidate: TransitionResult,
  operationId = randomUUID(),
) {
  const result = await scenario.store.commitTransition({
    owner: scenario.owner,
    matchId: scenario.record.state.matchId,
    expectedRevision: scenario.record.storeRevision,
    operationId,
    candidate,
  });
  scenario.record = result;
  return result;
}

export async function drive(
  scenario: Scenario,
  command: GameCommand,
  at = scenario.record.state.lastInput.atMonoMs,
) {
  const candidate = applyCommand(
    scenario.record.state,
    command,
    receiptAt(scenario.record.state, at),
  );
  if (candidate.error)
    throw new Error(`Invalid test trace: ${candidate.error.code}`);
  await persistCandidate(scenario, candidate);
  return candidate;
}

export async function prepareRound(scenario: Scenario, active = true) {
  const prepared = prepareReadyRound(scenario.record.state, {
    descriptor: createRoundDescriptor(scenario.record.state, {
      roundId: randomUUID(),
    }),
  });
  for (const step of prepared.steps) await persistCandidate(scenario, step);
  if (active)
    await persistCandidate(
      scenario,
      tickAt(scenario.record.state, prepared.monoSchedule.typingStartAt),
    );
  return prepared;
}

export async function winRound(scenario: Scenario, player = 0) {
  const prepared = await prepareRound(scenario);
  await drive(
    scenario,
    {
      type: 'answer.submit',
      playerId: scenario.record.state.participants[player]!.playerId,
      payload: {
        matchId: scenario.record.state.matchId,
        roundId: prepared.descriptor.roundId,
        attemptId: randomUUID(),
        text: prepared.descriptor.canonicalText,
      },
    },
    prepared.monoSchedule.typingStartAt,
  );
  return prepared;
}

export function spawnActorChild(testDb: TestDatabase) {
  const child = fork(new URL('./actor-child.ts', import.meta.url), [], {
    execArgv: ['--import', 'tsx'],
    serialization: 'advanced',
    silent: true,
    env: { ...process.env, TEST_DATABASE_URL: testDb.config.connectionString },
  });
  const pending = new Map<number, ReturnType<typeof deferred<unknown>>>();
  const barriers = new Map<string, ReturnType<typeof deferred<void>>>();
  const publications: { viewerId: string; update: CommittedUpdate }[] = [];
  const exited = deferred<void>();
  let nextId = 0;
  let ended = false;
  let diagnostics = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    diagnostics += chunk.toString();
  });
  child.on('message', (message: unknown) => {
    const packet = message as {
      kind: string;
      id?: number;
      ok?: boolean;
      value?: unknown;
      error?: string;
      point?: string;
      viewerId?: string;
      update?: CommittedUpdate;
    };
    if (packet.kind === 'reply' && packet.id !== undefined) {
      const request = pending.get(packet.id);
      if (request) {
        pending.delete(packet.id);
        if (packet.ok) request.resolve(packet.value);
        else
          request.reject(new Error(packet.error ?? 'Child operation failed'));
      }
    } else if (packet.kind === 'barrier' && packet.point) {
      let gate = barriers.get(packet.point);
      if (!gate) {
        gate = deferred<void>();
        barriers.set(packet.point, gate);
      }
      gate.resolve();
    } else if (
      packet.kind === 'publication' &&
      packet.viewerId &&
      packet.update
    ) {
      publications.push({ viewerId: packet.viewerId, update: packet.update });
    }
  });
  child.once('exit', () => {
    ended = true;
    const error = new Error(
      `Actor child exited${diagnostics ? `: ${diagnostics}` : ''}`,
    );
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    for (const gate of barriers.values()) gate.reject(error);
    exited.resolve();
  });
  const kill = async () => {
    if (!ended) child.kill('SIGKILL');
    await exited.promise;
  };
  testDb.cleanupWith(kill);
  return {
    publications,
    async request<T>(action: string, payload: unknown = {}): Promise<T> {
      if (ended) throw new Error('Actor child already exited');
      const id = nextId++;
      const waiter = deferred<unknown>();
      pending.set(id, waiter);
      child.send({ id, action, payload });
      return (await waiter.promise) as T;
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
