import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { createDatabase, type Database } from '../../../src/db/client.js';
import { migrateDatabase } from '../../../src/db/migrate.js';
import { acquireOwner } from '../../../src/db/owner.js';
import { createMatchStore } from '../../../src/db/match-store.js';
import type {
  OwnerLease,
  DiscoverableMatchStore,
} from '../../../src/db/types.js';
import { createFixtureMatch, receiptAt } from '../../game/fixtures.js';
import { applyCommand } from '../../../src/game/engine.js';
const connectionString = process.env.TEST_DATABASE_URL!;
const schemaName = `typeduel_bindings_${randomUUID().replaceAll('-', '')}`;
let database: Database;
let owner: OwnerLease;
let store: DiscoverableMatchStore;
beforeAll(async () => {
  await migrateDatabase({ connectionString, schemaName });
  database = createDatabase({ connectionString, schemaName });
  owner = await acquireOwner({
    connectionString,
    schemaName,
    ownerId: randomUUID(),
  });
  store = createMatchStore({ database });
  await store.interruptOrphans(owner);
});
afterAll(async () => {
  await owner?.release();
  await database?.close();
  const pool = new Pool({ connectionString });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await pool.end();
  }
});
it.each([false, true])(
  'serializes overlapping player pairs including reversed order %s',
  async (reverse) => {
    const a = randomUUID(),
      b = randomUUID(),
      c = randomUUID();
    const create = (participants: [string, string]) =>
      store.createMatch({
        owner,
        operationId: randomUUID(),
        state: createFixtureMatch({ matchId: randomUUID(), participants }),
      });
    const results = await Promise.allSettled([
      create([a, b]),
      create(reverse ? [b, a] : [a, c]),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const winner = results.find((r) => r.status === 'fulfilled')!;
    if (winner.status !== 'fulfilled') throw new Error();
    expect((await store.readLatestForPlayer(a))?.state.matchId).toBe(
      winner.value.state.matchId,
    );
    expect(
      (
        await database.pool.query(
          'SELECT player_id FROM player_match_bindings WHERE last_match_id=$1',
          [winner.value.state.matchId],
        )
      ).rowCount,
    ).toBe(2);
  },
);
it('repoints terminal bindings atomically and preserves explicit historical recovery', async () => {
  const participants: [string, string] = [randomUUID(), randomUUID()];
  const old = await store.createMatch({
    owner,
    operationId: randomUUID(),
    state: createFixtureMatch({ matchId: randomUUID(), participants }),
  });
  const candidate = applyCommand(
    old.state,
    { type: 'source.unavailable' },
    receiptAt(old.state, 1000),
  );
  await store.commitTransition({
    owner,
    matchId: old.state.matchId,
    expectedRevision: old.storeRevision,
    operationId: randomUUID(),
    candidate,
  });
  const next = createFixtureMatch({
    matchId: randomUUID(),
    participants: [participants[0], randomUUID()],
  });
  const failing = createMatchStore({
    database,
    hooks(point, context) {
      if (point === 'after_dml' && context.statement === 'upsert_binding')
        throw new Error('injected');
    },
  });
  await expect(
    failing.createMatch({ owner, operationId: randomUUID(), state: next }),
  ).rejects.toMatchObject({ code: 'ROLLED_BACK' });
  expect(
    (await store.readLatestForPlayer(participants[0]))?.state.matchId,
  ).toBe(old.state.matchId);
  await store.createMatch({ owner, operationId: randomUUID(), state: next });
  expect(
    (await store.readLatestForPlayer(participants[0]))?.state.matchId,
  ).toBe(next.matchId);
  expect((await store.readCommitted(old.state.matchId))?.state.phase).toBe(
    'ABORTED',
  );
});
