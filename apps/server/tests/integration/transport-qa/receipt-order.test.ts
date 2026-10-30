import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import type { GameplayReplyData } from '@typeduel/contracts';
import {
  answer,
  barrier,
  createHarness,
  deferred,
  eventually,
  ManualClock,
  readyRound,
  settle,
  startMatch,
  success,
  type Harness,
} from './support/harness.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.testDb.dispose();
  h = undefined;
});

describe('socket ingress order rather than asynchronous processing time', () => {
  it('drains replaced due timers once at the same tick while retaining nofire and a dispatch bound', () => {
    const clock = new ManualClock(0);
    let calls = 0;
    let cancel = clock.schedule(20, () => {
      calls += 1;
    });
    clock.schedule(10, () => {
      cancel();
      cancel = clock.schedule(20, () => {
        calls += 1;
      });
    });
    clock.set(30);
    expect(calls).toBe(0);
    clock.set(30, true);
    expect(calls).toBe(1);
    clock.set(30, true);
    expect(calls).toBe(1);
    const looping = new ManualClock(0);
    const rearm = () => {
      looping.schedule(0, rearm);
    };
    rearm();
    expect(() => looping.set(0, true)).toThrow(/dispatch bound/);
  });

  it('commits exactly one winner for concurrent correct answers', async () => {
    h = await createHarness();
    const a = await h.connect();
    const b = await h.connect();
    const matchId = await startMatch(h, a, b);
    const { round } = await readyRound(h, a, b, matchId);
    const results = await Promise.all(
      [a, b].map((peer) =>
        peer.request<GameplayReplyData>(
          'answer.submit',
          answer(matchId, round.roundId, round.canonicalText),
        ),
      ),
    );
    expect(results.map((result) => success(result).ack?.status).sort()).toEqual(
      ['CORRECT', 'ROUND_CLOSED'],
    );
    const saved = (await h.store.readCommitted(matchId))!;
    expect(saved.state.countedAttempts).toHaveLength(1);
    expect(saved.state.participants.reduce((sum, p) => sum + p.score, 0)).toBe(
      1,
    );
    expect(saved.state.lastResult?.winnerId).toBe(
      saved.state.countedAttempts[0]!.playerId,
    );
  });

  it.each(['rolled_back', 'unknown'] as const)(
    'publishes no unconfirmed point while a %s head blocks later real frames',
    async (kind) => {
      h = await createHarness();
      const a = await h.connect();
      const b = await h.connect();
      const matchId = await startMatch(h, a, b);
      const { round } = await readyRound(h, a, b, matchId);
      const paused = deferred<void>();
      let attempts = 0;
      let unknown = false;
      const beforePackets = h.packets.length;
      h.setFault((point, context) => {
        if (context.matchId !== matchId) return;
        if (kind === 'rolled_back' && point === 'before_commit') {
          if (++attempts === 3) paused.resolve();
          throw new Error('qa-private-rollback');
        }
        if (kind === 'unknown' && point === 'after_commit') {
          unknown = true;
          throw new Error('qa-private-lost-commit-response');
        }
        if (unknown && point === 'before_owner_lock') {
          paused.resolve();
          throw new Error('qa-private-resolution-unavailable');
        }
      });
      const first = a.request<GameplayReplyData>(
        'answer.submit',
        answer(matchId, round.roundId, round.canonicalText),
      );
      await paused.promise;
      const queued = deferred<void>();
      const later = answer(matchId, round.roundId, round.canonicalText);
      h.setAdmissionObserver((event) => {
        if (event.attemptId === later.attemptId) queued.resolve();
      });
      const second = b.request<GameplayReplyData>('answer.submit', later);
      await queued.promise;
      const durable = (await h.store.readCommitted(matchId))!;
      expect(durable.state.countedAttempts).toHaveLength(
        kind === 'unknown' ? 1 : 0,
      );
      expect(
        h.packets
          .slice(beforePackets)
          .filter(
            (packet) =>
              packet.event === 'match.update' ||
              packet.event === 'answer.submit',
          ),
      ).toEqual([]);
      h.setFault(() => {});
      await h.runtime.reconcile();
      expect(success(await first).ack?.status).toBe('CORRECT');
      expect(success(await second).ack?.status).toBe('ROUND_CLOSED');
      const confirmed = (await h.store.readCommitted(matchId))!;
      expect(confirmed.state.countedAttempts).toHaveLength(1);
      expect(confirmed.state.participants.map((p) => p.score)).toEqual([1, 0]);
    },
  );

  it('keeps a timely queued answer ahead of the deadline while another transaction is stalled', async () => {
    h = await createHarness();
    const a = await h.connect();
    const b = await h.connect();
    const matchId = await startMatch(h, a, b);
    const { round, schedule } = await readyRound(h, a, b, matchId);
    const gate = barrier(h.testDb);
    let hold = true;
    h.setFault(async (point) => {
      if (point === 'before_commit' && hold) {
        hold = false;
        await gate.pause();
      }
    });
    h.clock.set(schedule.deadlineAt - 2);
    const wrong = a.request<GameplayReplyData>(
      'answer.submit',
      answer(matchId, round.roundId, 'qa-wrong'),
    );
    await gate.reached;
    const queued = deferred<void>();
    const packet = answer(matchId, round.roundId, round.canonicalText);
    h.setAdmissionObserver((event) => {
      if (event.attemptId === packet.attemptId) queued.resolve();
    });
    h.clock.set(schedule.deadlineAt - 1);
    const correct = b.request<GameplayReplyData>('answer.submit', packet);
    await queued.promise;
    h.clock.set(schedule.deadlineAt + 100, true);
    expect(
      (await h.store.readCommitted(matchId))!.state.countedAttempts,
    ).toEqual([]);
    expect(
      h.packets.filter((p) => p.kind === 'ack' && p.event === 'answer.submit'),
    ).toEqual([]);
    gate.release();
    expect(success(await wrong).ack?.status).toBe('INCORRECT');
    expect(success(await correct).ack?.status).toBe('CORRECT');
    await h.runtime.reconcile();
    const record = (await h.store.readCommitted(matchId))!;
    expect(record.state.lastResult?.winnerId).toBe(b.playerId);
    expect(record.state.countedAttempts).toHaveLength(2);
    expect(record.state.participants.map((p) => p.score)).toEqual([0, 1]);
  });

  it('rejects an exact-deadline answer and ignores an untrusted client time field', async () => {
    h = await createHarness();
    const a = await h.connect();
    const b = await h.connect();
    const matchId = await startMatch(h, a, b);
    const { round, schedule } = await readyRound(h, a, b, matchId);
    const spoofed = await a.request<GameplayReplyData>('answer.submit', {
      ...answer(matchId, round.roundId, round.canonicalText),
      receivedAtMonoMs: schedule.typingStartAt,
    });
    expect(spoofed.ok ? spoofed.data.ack : null).toBeNull();
    h.clock.set(schedule.deadlineAt);
    expect(
      success(
        await b.request<GameplayReplyData>(
          'answer.submit',
          answer(matchId, round.roundId, round.canonicalText),
        ),
      ).ack?.status,
    ).toBe('ROUND_CLOSED');
    const saved = (await h.store.readCommitted(matchId))!;
    expect(saved.state.countedAttempts).toEqual([]);
    expect(saved.state.participants.map((p) => p.score)).toEqual([0, 0]);
  });

  it('admits an established session without another JWKS round trip while a new handshake is delayed', async () => {
    h = await createHarness();
    const a = await h.connect();
    const b = await h.connect();
    const matchId = await startMatch(h, a, b);
    const { round } = await readyRound(h, a, b, matchId);
    await h.tokens.rotate();
    const gate = barrier(h.testDb);
    h.tokens.setGate(() => gate.pause());
    const newConnection = settle(h.connect());
    await gate.reached;
    const result = await a.request<GameplayReplyData>(
      'answer.submit',
      answer(matchId, round.roundId, round.canonicalText),
    );
    expect(success(result).ack?.status).toBe('CORRECT');
    gate.release();
    h.tokens.setGate();
    expect((await newConnection).ok).toBe(true);
  });

  it.each([20, 100, 350])(
    'keeps one durable winner under a controlled %i ms asymmetric client delivery delay',
    async (delayMs) => {
      h = await createHarness();
      const a = await h.connect();
      const b = await h.connect();
      const matchId = await startMatch(h, a, b);
      const { round } = await readyRound(h, a, b, matchId);
      const first = b.request<GameplayReplyData>(
        'answer.submit',
        answer(matchId, round.roundId, round.canonicalText),
      );
      await delay(delayMs);
      const later = a.request<GameplayReplyData>(
        'answer.submit',
        answer(matchId, round.roundId, round.canonicalText),
      );
      expect(success(await first).ack?.status).toBe('CORRECT');
      expect(success(await later).ack?.status).toBe('ROUND_CLOSED');
      const committed = (await h.store.readCommitted(matchId))!;
      expect(committed.state.participants.map((p) => p.score)).toEqual([0, 1]);
      expect(committed.state.countedAttempts).toHaveLength(1);
      const ingress = h.ingress.filter(
        (event) => event.event === 'answer.submit',
      );
      expect(ingress.map((event) => event.playerId)).toEqual([
        b.playerId,
        a.playerId,
      ]);
    },
  );

  it('allows a different match to commit while one match transaction waits', async () => {
    h = await createHarness();
    const a = await h.connect();
    const b = await h.connect();
    const c = await h.connect();
    const d = await h.connect();
    const firstId = await startMatch(h, a, b);
    const first = await readyRound(h, a, b, firstId);
    const secondId = await startMatch(h, c, d);
    const second = await readyRound(h, c, d, secondId);
    const gate = barrier(h.testDb);
    h.setFault(async (point, context) => {
      if (point === 'before_commit' && context.matchId === firstId)
        await gate.pause();
    });
    const pending = a.request<GameplayReplyData>(
      'answer.submit',
      answer(firstId, first.round.roundId, first.round.canonicalText),
    );
    await gate.reached;
    expect(
      success(
        await c.request<GameplayReplyData>(
          'answer.submit',
          answer(secondId, second.round.roundId, second.round.canonicalText),
        ),
      ).ack?.status,
    ).toBe('CORRECT');
    expect(
      (await h.store.readCommitted(firstId))!.state.participants[0].score,
    ).toBe(0);
    gate.release();
    expect(success(await pending).ack?.status).toBe('CORRECT');
    await eventually(
      async () =>
        (await h!.store.readCommitted(firstId))!.state.countedAttempts
          .length === 1,
      'first match commit',
    );
  });
});
