import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../../src/db/client.js';
import { migrateDatabase } from '../../../src/db/migrate.js';
import { acquireOwner } from '../../../src/db/owner.js';
import { createMatchStore } from '../../../src/db/match-store.js';
import type { MatchStore, OwnerLease } from '../../../src/db/types.js';
import { applyCommand } from '../../../src/game/engine.js';
import {
  createFixtureMatch,
  createRoundDescriptor,
  receiptAt,
  submit,
} from '../../game/fixtures.js';

const connectionString = process.env.TEST_DATABASE_URL!;
const schemaName = `typeduel_backend_${randomUUID().replaceAll('-', '')}`;
let database: Database;
let owner: OwnerLease;
let store: MatchStore;
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
  const admin = new Pool({ connectionString });
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
  }
});
describe('PostgreSQL durable store baseline', () => {
  it('migrates privately and enforces non-null terminal outcome invariants in SQL', async () => {
    const state = createFixtureMatch({ matchId: randomUUID() });
    await store.createMatch({ owner, operationId: randomUUID(), state });
    await expect(
      database.pool.query(
        "UPDATE matches SET status='ABORTED', interruption_reason=NULL WHERE id=$1",
        [state.matchId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      database.pool.query(
        "UPDATE matches SET status='COMPLETED', round_number=5,player1_score=1,winner_id=NULL,is_draw=false WHERE id=$1",
        [state.matchId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const namespaces = await database.pool.query<{ schemaname: string }>(
      "SELECT schemaname FROM pg_tables WHERE schemaname=$1 AND tablename='matches'",
      [schemaName],
    );
    expect(namespaces.rows).toEqual([{ schemaname: schemaName }]);
  });
  it('commits one winner, ledger ACK and checkpoint atomically', async () => {
    let persisted = await store.createMatch({
      owner,
      operationId: randomUUID(),
      state: createFixtureMatch({ matchId: randomUUID() }),
    });
    const descriptor = createRoundDescriptor(persisted.state, {
      roundId: randomUUID(),
    });
    const commands = [
      { type: 'round.prepare' as const, descriptor },
      ...persisted.state.participants.map((p) => ({
        type: 'round.audio_ready' as const,
        playerId: p.playerId,
        payload: {
          matchId: persisted.state.matchId,
          roundId: descriptor.roundId,
          audioVersion: descriptor.audio.audioVersion,
        },
      })),
    ];
    for (const command of commands) {
      const candidate = applyCommand(
        persisted.state,
        command,
        receiptAt(persisted.state, 1_000),
      );
      persisted = await store.commitTransition({
        owner,
        matchId: persisted.state.matchId,
        expectedRevision: persisted.storeRevision,
        operationId: randomUUID(),
        candidate,
      });
    }
    const candidate = submit(
      persisted.state,
      persisted.state.participants[0].playerId,
      {
        attemptId: randomUUID(),
        text: descriptor.canonicalText,
        atMonoMs: persisted.state.round!.monoSchedule!.typingStartAt,
      },
    );
    persisted = await store.commitTransition({
      owner,
      matchId: persisted.state.matchId,
      expectedRevision: persisted.storeRevision,
      operationId: randomUUID(),
      candidate,
    });
    const row = await database.pool.query<{ original_ack: unknown }>(
      'SELECT original_ack FROM answer_attempts WHERE match_id=$1',
      [persisted.state.matchId],
    );
    expect(row.rows).toEqual([{ original_ack: candidate.ack }]);
    const loaded = await store.readCommitted(persisted.state.matchId);
    expect(loaded?.state).toEqual(candidate.state);
    expect(loaded?.state.participants[0].score).toBe(1);
  });
  it('rolls back physical writes and reconciles a lost real COMMIT response', async () => {
    const state = createFixtureMatch({ matchId: randomUUID() });
    const failing = createMatchStore({
      database,
      hooks(point, context) {
        if (point === 'after_dml' && context.statement === 'insert_participant')
          throw new Error('private-injected-failure');
      },
    });
    await expect(
      failing.createMatch({ owner, operationId: randomUUID(), state }),
    ).rejects.toMatchObject({ code: 'ROLLED_BACK' });
    expect(await store.readCommitted(state.matchId)).toBeNull();
    const operationId = randomUUID();
    const lost = createMatchStore({
      database,
      hooks(point) {
        if (point === 'after_commit')
          throw new Error('private-injected-failure');
      },
    });
    await expect(
      lost.createMatch({ owner, operationId, state }),
    ).rejects.toMatchObject({ code: 'COMMIT_UNKNOWN' });
    const resolution = await lost.resolveOperation({
      owner,
      matchId: state.matchId,
      operationId,
      expectedRevision: 0n,
    });
    expect(resolution.status).toBe('committed');
    expect((await store.readCommitted(state.matchId))?.storeRevision).toBe(1n);
  });
  it('does not classify an operation waiting before its owner lock as rolled back', async () => {
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = createFixtureMatch({ matchId: randomUUID() });
    const operationId = randomUUID();
    const blocked = createMatchStore({
      database,
      async hooks(point) {
        if (point === 'before_owner_lock') {
          enter();
          await gate;
        }
      },
    });
    const pending = blocked.createMatch({ owner, operationId, state });
    await entered;
    expect(
      (
        await blocked.resolveOperation({
          owner,
          matchId: state.matchId,
          operationId,
          expectedRevision: 0n,
        })
      ).status,
    ).toBe('unresolved');
    release();
    expect((await pending).lastOperationId).toBe(operationId);
  });
});
