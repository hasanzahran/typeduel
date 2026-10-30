import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { applyCommand } from '../../../src/game/engine.js';
import { StoreError } from '../../../src/db/types.js';
import {
  createFixtureMatch,
  createRoundDescriptor,
  receiptAt,
  submit,
  tickAt,
} from '../../game/fixtures.js';
import {
  barrier,
  createScenario,
  durableRows,
  persistCandidate,
  prepareRound,
  settle,
  TEST_TIMEOUT_MS,
  winRound,
  type Scenario,
} from './support/harness.js';

let scenario: Scenario | undefined;
afterEach(async () => {
  await scenario?.testDb.dispose();
  scenario = undefined;
});

describe('real PostgreSQL atomicity and commit ambiguity', () => {
  it.each([
    'prepare',
    'incorrect',
    'winner',
    'deadline',
    'interrupt',
    'complete',
  ] as const)(
    'rolls back every physical write in a %s operation',
    async (kind) => {
      const s = (scenario = await createScenario());
      if (kind === 'complete')
        for (let round = 0; round < 4; round += 1) await winRound(s);
      const prepared = kind === 'prepare' ? null : await prepareRound(s);
      const state = s.record.state;
      const candidate =
        kind === 'prepare'
          ? applyCommand(
              state,
              {
                type: 'round.prepare',
                descriptor: createRoundDescriptor(state),
              },
              receiptAt(state, state.lastInput.atMonoMs),
            )
          : kind === 'deadline'
            ? tickAt(state, prepared!.monoSchedule.deadlineAt)
            : kind === 'interrupt'
              ? applyCommand(
                  state,
                  { type: 'source.unavailable' },
                  receiptAt(state, state.lastInput.atMonoMs),
                )
              : submit(state, state.participants[0].playerId, {
                  attemptId: randomUUID(),
                  text:
                    kind === 'incorrect'
                      ? 'qa-wrong'
                      : prepared!.descriptor.canonicalText,
                  atMonoMs: state.lastInput.atMonoMs,
                });
      expect(candidate.error).toBeNull();
      const before = await durableRows(s.testDb.pool);
      let completed = false;
      for (let failAt = 1; failAt <= 20; failAt += 1) {
        let writes = 0;
        s.setFault((point) => {
          if (point === 'after_dml' && ++writes === failAt)
            throw new Error('qa-private-write-failure');
        });
        const operation = settle(
          s.store.commitTransition({
            owner: s.owner,
            matchId: state.matchId,
            expectedRevision: s.record.storeRevision,
            operationId: randomUUID(),
            candidate,
          }),
        );
        const result = await operation;
        if (result.ok) {
          expect(writes).toBe(failAt - 1);
          expect(writes).toBeGreaterThan(0);
          expect(result.value.state).toEqual(candidate.state);
          expect(result.value.storeRevision).toBe(s.record.storeRevision + 1n);
          completed = true;
          break;
        }
        expect(writes).toBe(failAt);
        expect(result.error).toBeInstanceOf(StoreError);
        expect((result.error as StoreError).code).toBe('ROLLED_BACK');
        expect(String(result.error)).not.toContain('qa-private-write-failure');
        expect(await durableRows(s.testDb.pool)).toEqual(before);
        expect(await s.store.readCommitted(state.matchId)).toEqual(s.record);
      }
      expect(completed).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it('rolls back a real SQL constraint error without exposing database diagnostics', async () => {
    const s = (scenario = await createScenario());
    const prepared = await prepareRound(s);
    await s.testDb.pool.query(
      `CREATE FUNCTION qa_reject_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'qa-private-database-diagnostic' USING ERRCODE = '23514'; END $$`,
    );
    await s.testDb.pool.query(
      'CREATE TRIGGER qa_reject_write BEFORE UPDATE ON matches FOR EACH ROW EXECUTE FUNCTION qa_reject_write()',
    );
    const before = await durableRows(s.testDb.pool);
    const candidate = submit(
      s.record.state,
      s.record.state.participants[0].playerId,
      {
        attemptId: randomUUID(),
        text: prepared.descriptor.canonicalText,
        atMonoMs: prepared.monoSchedule.typingStartAt,
      },
    );
    const failed = await settle(persistCandidate(s, candidate));
    expect(failed.ok).toBe(false);
    if (failed.ok) throw new Error('Database constraint was not enforced');
    expect((failed.error as StoreError).code).toBe('INVALID_STATE');
    expect(String(failed.error)).not.toContain(
      'qa-private-database-diagnostic',
    );
    expect(await durableRows(s.testDb.pool)).toEqual(before);
  });

  it('reconciles a committed operation after its COMMIT response is lost', async () => {
    const s = (scenario = await createScenario());
    const prepared = await prepareRound(s);
    const before = s.record;
    const operationId = randomUUID();
    const candidate = submit(
      before.state,
      before.state.participants[0].playerId,
      {
        attemptId: randomUUID(),
        text: prepared.descriptor.canonicalText,
        atMonoMs: prepared.monoSchedule.typingStartAt,
      },
    );
    s.setFault((point) => {
      if (point === 'after_commit') throw new Error('qa-lost-commit-response');
    });
    const unknown = await settle(
      s.store.commitTransition({
        owner: s.owner,
        matchId: before.state.matchId,
        expectedRevision: before.storeRevision,
        operationId,
        candidate,
      }),
    );
    expect(unknown.ok).toBe(false);
    if (unknown.ok) throw new Error('Expected an ambiguous response');
    expect((unknown.error as StoreError).code).toBe('COMMIT_UNKNOWN');
    s.setFault(() => {});
    const resolution = await s.store.resolveOperation({
      owner: s.owner,
      matchId: before.state.matchId,
      expectedRevision: before.storeRevision,
      operationId,
    });
    expect(resolution.status).toBe('committed');
    if (resolution.status !== 'committed')
      throw new Error('Committed operation was lost');
    expect(resolution.match.state).toEqual(candidate.state);
    expect(resolution.match.state.countedAttempts).toHaveLength(1);
    expect(resolution.match.state.participants.map((p) => p.score)).toEqual([
      1, 0,
    ]);
    const retry = await s.store.commitTransition({
      owner: s.owner,
      matchId: before.state.matchId,
      expectedRevision: before.storeRevision,
      operationId,
      candidate,
    });
    expect(retry).toEqual(resolution.match);
  });

  it('proves rollback before retrying the same operation and original receipt', async () => {
    const s = (scenario = await createScenario());
    const prepared = await prepareRound(s);
    const before = s.record;
    const operationId = randomUUID();
    const candidate = submit(
      before.state,
      before.state.participants[0].playerId,
      {
        attemptId: randomUUID(),
        text: prepared.descriptor.canonicalText,
        atMonoMs: prepared.monoSchedule.deadlineAt - 1,
      },
    );
    s.setFault((point) => {
      if (point === 'before_commit') throw new Error('qa-rollback');
    });
    const failed = await settle(
      s.store.commitTransition({
        owner: s.owner,
        matchId: before.state.matchId,
        expectedRevision: before.storeRevision,
        operationId,
        candidate,
      }),
    );
    expect(failed.ok).toBe(false);
    s.setFault(() => {});
    expect(
      await s.store.resolveOperation({
        owner: s.owner,
        matchId: before.state.matchId,
        expectedRevision: before.storeRevision,
        operationId,
      }),
    ).toEqual({ status: 'rolled_back' });
    const committed = await s.store.commitTransition({
      owner: s.owner,
      matchId: before.state.matchId,
      expectedRevision: before.storeRevision,
      operationId,
      candidate,
    });
    expect(committed.state.countedAttempts[0]?.ack).toEqual(candidate.ack);
    expect(committed.state.participants.map((p) => p.score)).toEqual([1, 0]);
  });

  it('does not call an operation rolled back while its original row-guarded transaction is still pending', async () => {
    const s = (scenario = await createScenario());
    const prepared = await prepareRound(s);
    const held = barrier(s.testDb);
    s.setFault(async (point) => {
      if (point === 'before_commit') await held.pause();
    });
    const operationId = randomUUID();
    const before = s.record;
    const candidate = submit(
      before.state,
      before.state.participants[0].playerId,
      {
        attemptId: randomUUID(),
        text: 'wrong',
        atMonoMs: prepared.monoSchedule.typingStartAt,
      },
    );
    const pending = settle(
      s.store.commitTransition({
        owner: s.owner,
        matchId: before.state.matchId,
        expectedRevision: before.storeRevision,
        operationId,
        candidate,
      }),
    );
    await held.reached;
    const resolution = await s.store.resolveOperation({
      owner: s.owner,
      matchId: before.state.matchId,
      expectedRevision: before.storeRevision,
      operationId,
    });
    expect(resolution.status).toBe('unresolved');
    held.release();
    expect((await pending).ok).toBe(true);
    s.setFault(() => {});
    expect(
      (
        await s.store.resolveOperation({
          owner: s.owner,
          matchId: before.state.matchId,
          expectedRevision: before.storeRevision,
          operationId,
        })
      ).status,
    ).toBe('committed');
  });

  it('fences a delayed pre-lock attempt with the same expected revision and operation ID', async () => {
    const s = (scenario = await createScenario());
    const prepared = await prepareRound(s);
    const held = barrier(s.testDb);
    let first = true;
    s.setFault(async (point) => {
      if (point === 'before_match_lock' && first) {
        first = false;
        await held.pause();
      }
    });
    const before = s.record;
    const operationId = randomUUID();
    const candidate = submit(
      before.state,
      before.state.participants[0].playerId,
      {
        attemptId: randomUUID(),
        text: prepared.descriptor.canonicalText,
        atMonoMs: prepared.monoSchedule.typingStartAt,
      },
    );
    const input = {
      owner: s.owner,
      matchId: before.state.matchId,
      expectedRevision: before.storeRevision,
      operationId,
      candidate,
    };
    const delayed = settle(s.store.commitTransition(input));
    await held.reached;
    await expect(s.store.commitTransition(input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(await s.store.readCommitted(before.state.matchId)).toEqual(before);
    held.release();
    const late = await delayed;
    expect(late.ok).toBe(true);
    if (!late.ok) throw new Error('Original operation failed');
    const retry = await s.store.commitTransition(input);
    expect(late.value).toEqual(retry);
    expect(retry.state.countedAttempts).toHaveLength(1);
    expect(
      (
        await s.store.readCommitted(before.state.matchId)
      )?.state.participants.map((p) => p.score),
    ).toEqual([1, 0]);
  });

  it.each(['create', 'transition'] as const)(
    'keeps an original %s operation unresolved while it is delayed before the owner guard',
    async (kind) => {
      const s = (scenario = await createScenario());
      const before = s.record;
      const initial = createFixtureMatch({ matchId: randomUUID() });
      const candidate = applyCommand(
        before.state,
        {
          type: 'round.prepare',
          descriptor: createRoundDescriptor(before.state),
        },
        receiptAt(before.state, before.state.lastInput.atMonoMs),
      );
      const operationId = randomUUID();
      const matchId =
        kind === 'create' ? initial.matchId : before.state.matchId;
      const expectedRevision = kind === 'create' ? 0n : before.storeRevision;
      const held = barrier(s.testDb);
      let hold = true;
      s.setFault(async (point) => {
        if (point === 'before_owner_lock' && hold) {
          hold = false;
          await held.pause();
        }
      });
      const pending = settle(
        kind === 'create'
          ? s.store.createMatch({ owner: s.owner, operationId, state: initial })
          : s.store.commitTransition({
              owner: s.owner,
              matchId,
              expectedRevision,
              operationId,
              candidate,
            }),
      );
      await held.reached;
      expect(
        await s.store.resolveOperation({
          owner: s.owner,
          matchId,
          expectedRevision,
          operationId,
        }),
      ).toEqual({ status: 'unresolved' });
      held.release();
      expect((await pending).ok).toBe(true);
      expect(
        (
          await s.store.resolveOperation({
            owner: s.owner,
            matchId,
            expectedRevision,
            operationId,
          })
        ).status,
      ).toBe('committed');
    },
  );

  it('rolls back each initial match and participant write without creating a partial match', async () => {
    const s = (scenario = await createScenario());
    const initial = createFixtureMatch({ matchId: randomUUID() });
    const before = await durableRows(s.testDb.pool);
    let succeeded = false;
    for (let failAt = 1; failAt < 10; failAt += 1) {
      let writes = 0;
      s.setFault((point) => {
        if (point === 'after_dml' && ++writes === failAt)
          throw new Error('qa-create-failure');
      });
      const result = await settle(
        s.store.createMatch({
          owner: s.owner,
          operationId: randomUUID(),
          state: initial,
        }),
      );
      if (result.ok) {
        expect(writes).toBe(failAt - 1);
        expect(writes).toBeGreaterThan(0);
        succeeded = true;
        break;
      }
      expect(writes).toBe(failAt);
      expect(await s.store.readCommitted(initial.matchId)).toBeNull();
      expect(await durableRows(s.testDb.pool)).toEqual(before);
    }
    expect(succeeded).toBe(true);
  });

  it.each([
    "status = 'ABORTED', interruption_reason = NULL",
    "status = 'COMPLETED', round_number = 5, player1_score = 5, winner_id = NULL, is_draw = false",
  ])(
    'rejects a NULL terminal invariant in real SQL: %s',
    async (assignment) => {
      const s = (scenario = await createScenario());
      const before = await durableRows(s.testDb.pool);
      await expect(
        s.testDb.pool.query(`UPDATE matches SET ${assignment} WHERE id = $1`, [
          s.record.state.matchId,
        ]),
      ).rejects.toMatchObject({ code: '23514', constraint: 'match_terminal' });
      expect(await durableRows(s.testDb.pool)).toEqual(before);
    },
  );

  it('rejects a round ID already owned by another match without storing a mismatched checkpoint', async () => {
    const s = (scenario = await createScenario());
    const firstRound = await prepareRound(s);
    s.record = await s.store.createMatch({
      owner: s.owner,
      operationId: randomUUID(),
      state: createFixtureMatch({ matchId: randomUUID() }),
    });
    const before = await durableRows(s.testDb.pool);
    const descriptor = createRoundDescriptor(s.record.state, {
      roundId: firstRound.descriptor.roundId,
    });
    const candidate = applyCommand(
      s.record.state,
      { type: 'round.prepare', descriptor },
      receiptAt(s.record.state, s.record.state.lastInput.atMonoMs),
    );
    expect(candidate.error).toBeNull();
    await expect(persistCandidate(s, candidate)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(await durableRows(s.testDb.pool)).toEqual(before);
    expect(
      (await s.store.readCommitted(s.record.state.matchId))?.state.round,
    ).toBeNull();
  });

  it('destroys a transaction connection when ROLLBACK fails and reconciles before using a fresh connection', async () => {
    const s = (scenario = await createScenario());
    const prepared = await prepareRound(s);
    const before = s.record;
    const operationId = randomUUID();
    const candidate = submit(
      before.state,
      before.state.participants[0].playerId,
      {
        attemptId: randomUUID(),
        text: prepared.descriptor.canonicalText,
        atMonoMs: prepared.monoSchedule.typingStartAt,
      },
    );
    let terminatedPid = 0;
    s.setFault(async (point) => {
      if (point === 'before_commit') {
        const connections = await s.testDb.pool.query<{ pid: number }>(
          "SELECT DISTINCT pid FROM pg_locks WHERE relation = 'matches'::regclass AND mode = 'RowExclusiveLock' AND granted",
        );
        expect(connections.rows).toHaveLength(1);
        terminatedPid = connections.rows[0]!.pid;
        await s.testDb.pool.query('SELECT pg_terminate_backend($1, 1000)', [
          terminatedPid,
        ]);
        throw new Error('qa-connection-lost-before-rollback');
      }
    });
    const input = {
      owner: s.owner,
      matchId: before.state.matchId,
      expectedRevision: before.storeRevision,
      operationId,
      candidate,
    };
    await expect(s.store.commitTransition(input)).rejects.toMatchObject({
      code: 'COMMIT_UNKNOWN',
    });
    s.setFault(() => {});
    expect(
      await s.store.resolveOperation({
        owner: s.owner,
        matchId: before.state.matchId,
        expectedRevision: before.storeRevision,
        operationId,
      }),
    ).toEqual({ status: 'rolled_back' });
    expect(await s.store.readCommitted(before.state.matchId)).toEqual(before);
    expect(
      (
        await s.database.pool.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        )
      ).rows[0]?.pid,
    ).not.toBe(terminatedPid);
    const retry = await s.store.commitTransition(input);
    expect(retry.state.participants.map((p) => p.score)).toEqual([1, 0]);
    expect(retry.state.countedAttempts).toHaveLength(1);
  });
});
