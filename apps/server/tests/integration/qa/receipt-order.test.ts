import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createFixtureMatch } from '../../game/fixtures.js';
import {
  barrier,
  createScenario,
  eventually,
  prepareRound,
  settle,
  type Scenario,
} from './support/harness.js';

let scenario: Scenario | undefined;
afterEach(async () => {
  await scenario?.testDb.dispose();
  scenario = undefined;
});

describe('real PostgreSQL actor receipt order and publication', () => {
  it('queues a timely answer ahead of a delayed deadline while an earlier write is blocked', async () => {
    const s = (scenario = await createScenario());
    const prepared = await prepareRound(s);
    const actor = s.actor();
    const gate = barrier(s.testDb);
    let hold = true;
    s.setFault(async (point) => {
      if (point === 'before_commit' && hold) {
        hold = false;
        await gate.pause();
      }
    });
    const [a, b] = s.record.state.participants;
    const command = (text: string) => ({
      type: 'answer.submit' as const,
      payload: {
        matchId: s.record.state.matchId,
        roundId: prepared.descriptor.roundId,
        attemptId: randomUUID(),
        text,
      },
    });
    s.clock.set(prepared.monoSchedule.deadlineAt - 2);
    const wrong = settle(
      actor.acceptPlayerCommand({ playerId: a.playerId }, command('qa-wrong')),
    );
    await gate.reached;
    s.clock.set(prepared.monoSchedule.deadlineAt - 1);
    const correct = settle(
      actor.acceptPlayerCommand(
        { playerId: b.playerId },
        command(prepared.descriptor.canonicalText),
      ),
    );
    s.clock.set(prepared.monoSchedule.deadlineAt + 100);
    const expiry = settle(actor.wake());
    expect(s.publications).toEqual([]);
    expect(
      (await s.store.readCommitted(s.record.state.matchId))?.state,
    ).toEqual(s.record.state);
    gate.release();
    const [wrongResult, winnerResult, expiryResult] = await Promise.all([
      wrong,
      correct,
      expiry,
    ]);
    expect(wrongResult.ok && wrongResult.value.ack?.status).toBe('INCORRECT');
    expect(winnerResult.ok && winnerResult.value.ack?.status).toBe('CORRECT');
    expect(expiryResult.ok).toBe(true);
    const committed = await s.store.readCommitted(s.record.state.matchId);
    expect(committed?.state.lastResult?.winnerId).toBe(b.playerId);
    expect(committed?.state.countedAttempts).toHaveLength(2);
    expect(committed?.state.participants.map((p) => p.score)).toEqual([0, 1]);
    expect(committed?.state.countedAttempts[1]?.ack).toEqual(
      winnerResult.ok ? winnerResult.value.ack : null,
    );
  });

  it('rejects an exact-deadline receipt and retains first ingress order for equal-time correct answers', async () => {
    const s = (scenario = await createScenario());
    const first = await prepareRound(s);
    const actor = s.actor();
    s.clock.set(first.monoSchedule.deadlineAt);
    const late = await actor.acceptPlayerCommand(
      { playerId: s.record.state.participants[0].playerId },
      {
        type: 'answer.submit',
        payload: {
          matchId: s.record.state.matchId,
          roundId: first.descriptor.roundId,
          attemptId: randomUUID(),
          text: first.descriptor.canonicalText,
        },
      },
    );
    expect(late.ack?.status).toBe('ROUND_CLOSED');
    expect(
      (
        await s.store.readCommitted(s.record.state.matchId)
      )?.state.participants.map((p) => p.score),
    ).toEqual([0, 0]);
    actor.close();
    s.record = (await s.store.readCommitted(s.record.state.matchId))!;
    const next = await prepareRound(s);
    const nextActor = s.actor();
    s.clock.set(next.monoSchedule.typingStartAt);
    const [a, b] = s.record.state.participants;
    const packet = {
      type: 'answer.submit' as const,
      payload: {
        matchId: s.record.state.matchId,
        roundId: next.descriptor.roundId,
        attemptId: randomUUID(),
        text: next.descriptor.canonicalText,
      },
    };
    const firstReceipt = nextActor.acceptPlayerCommand(
      { playerId: b.playerId },
      packet,
    );
    const secondReceipt = nextActor.acceptPlayerCommand(
      { playerId: a.playerId },
      packet,
    );
    expect((await firstReceipt).ack?.status).toBe('CORRECT');
    expect((await secondReceipt).ack?.status).toBe('ROUND_CLOSED');
    expect(
      (
        await s.store.readCommitted(s.record.state.matchId)
      )?.state.participants.map((p) => p.score),
    ).toEqual([0, 1]);
  });

  it('allows an independent match to commit while another match transaction is waiting', async () => {
    const s = (scenario = await createScenario());
    const first = await prepareRound(s);
    const firstRecord = s.record;
    const secondInitial = await s.store.createMatch({
      owner: s.owner,
      operationId: randomUUID(),
      state: createFixtureMatch({
        matchId: randomUUID(),
        participants: [randomUUID(), randomUUID()],
      }),
    });
    s.record = secondInitial;
    const second = await prepareRound(s);
    const secondRecord = s.record;
    const a = s.actor(firstRecord);
    const b = s.actor(secondRecord);
    const gate = barrier(s.testDb);
    s.setFault(async (point, context) => {
      if (
        point === 'before_commit' &&
        context.matchId === firstRecord.state.matchId
      )
        await gate.pause();
    });
    const pending = settle(
      a.acceptPlayerCommand(
        { playerId: firstRecord.state.participants[0].playerId },
        {
          type: 'answer.submit',
          payload: {
            matchId: firstRecord.state.matchId,
            roundId: first.descriptor.roundId,
            attemptId: randomUUID(),
            text: first.descriptor.canonicalText,
          },
        },
      ),
    );
    await gate.reached;
    const independent = await b.acceptPlayerCommand(
      { playerId: secondRecord.state.participants[0].playerId },
      {
        type: 'answer.submit',
        payload: {
          matchId: secondRecord.state.matchId,
          roundId: second.descriptor.roundId,
          attemptId: randomUUID(),
          text: second.descriptor.canonicalText,
        },
      },
    );
    expect(independent.ack?.status).toBe('CORRECT');
    expect(
      (await s.store.readCommitted(firstRecord.state.matchId))?.state
        .participants[0].score,
    ).toBe(0);
    gate.release();
    expect((await pending).ok).toBe(true);
  });

  it('keeps rejected IDs unreserved and retains original counted ACKs after a lost response', async () => {
    const s = (scenario = await createScenario());
    const prepared = await prepareRound(s, false);
    const actor = s.actor();
    const playerId = s.record.state.participants[0].playerId;
    const attemptId = randomUUID();
    const packet = {
      type: 'answer.submit' as const,
      payload: {
        matchId: s.record.state.matchId,
        roundId: prepared.descriptor.roundId,
        attemptId,
        text: 'qa-wrong',
      },
    };
    s.clock.set(prepared.monoSchedule.typingStartAt - 1);
    const rejected = await actor.acceptPlayerCommand({ playerId }, packet);
    expect(rejected.ack?.status).toBe('NOT_TYPING');
    expect(
      (await s.store.readCommitted(s.record.state.matchId))?.state
        .countedAttempts,
    ).toEqual([]);
    let lost = true;
    s.setFault((point) => {
      if (point === 'after_commit' && lost) {
        lost = false;
        throw new Error('qa-lost-response');
      }
    });
    s.clock.set(prepared.monoSchedule.typingStartAt);
    let resolved = false;
    const pending = actor
      .acceptPlayerCommand({ playerId }, packet)
      .then((value) => {
        resolved = true;
        return value;
      });
    await eventually(async () => {
      await actor.reconcile();
      return resolved;
    }, 'commit ambiguity reconciliation');
    const counted = await pending;
    expect(counted.ack?.status).toBe('INCORRECT');
    const duplicate = await actor.acceptPlayerCommand({ playerId }, packet);
    expect(duplicate.ack).toEqual(counted.ack);
    expect(
      (await s.store.readCommitted(s.record.state.matchId))?.state
        .countedAttempts,
    ).toHaveLength(1);
  });

  it('does not publish an old owner envelope after ownership loss at the publication barrier', async () => {
    const s = (scenario = await createScenario());
    const prepared = await prepareRound(s);
    const actor = s.actor();
    const gate = barrier(s.testDb);
    s.setFault(async (point) => {
      if (point === 'before_publish') await gate.pause();
    });
    const pending = settle(
      actor.acceptPlayerCommand(
        { playerId: s.record.state.participants[0].playerId },
        {
          type: 'answer.submit',
          payload: {
            matchId: s.record.state.matchId,
            roundId: prepared.descriptor.roundId,
            attemptId: randomUUID(),
            text: prepared.descriptor.canonicalText,
          },
        },
      ),
    );
    await gate.reached;
    expect(
      (await s.store.readCommitted(s.record.state.matchId))?.state
        .participants[0].score,
    ).toBe(1);
    expect(s.publications).toEqual([]);
    await s.owner.release();
    gate.release();
    expect((await pending).ok).toBe(false);
    expect(s.publications).toEqual([]);
  });
});
