import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MatchUpdateSchema,
  type GameplayReplyData,
  type MatchSetup,
  type SessionState,
} from '@typeduel/contracts';
import {
  answer,
  barrier,
  createHarness,
  eventually,
  readyRound,
  startMatch,
  success,
  type Harness,
} from './support/harness.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.testDb.dispose();
  h = undefined;
});

describe('committed socket delivery, atomic batches and round lifecycle', () => {
  it.each(['classic', 'challenge'] as const)(
    'converges both real clients and PostgreSQL on a five-round %s winner',
    async (mode) => {
      h = await createHarness();
      const a = await h.connect();
      const b = await h.connect();
      const setup: MatchSetup =
        mode === 'classic'
          ? { mode, categorySlug: 'general', difficulty: 1 }
          : { mode, categorySlug: 'general' };
      const matchId = await startMatch(h, a, b, setup);
      for (let roundNumber = 1; roundNumber <= 5; roundNumber += 1) {
        const { round } = await readyRound(h, a, b, matchId);
        expect(round.level).toBe(mode === 'classic' ? 1 : roundNumber);
        expect(
          success(
            await a.request<GameplayReplyData>(
              'answer.submit',
              answer(
                matchId,
                round.roundId,
                ` ${round.canonicalText.toUpperCase()} `,
              ),
            ),
          ).ack?.status,
        ).toBe('CORRECT');
      }
      const persisted = (await h.store.readCommitted(matchId))!;
      expect(persisted.state.phase).toBe('COMPLETED');
      expect(persisted.state.participants.map((p) => p.score)).toEqual([5, 0]);
      for (const peer of [a, b]) {
        const synced = await peer.match(matchId);
        expect(MatchUpdateSchema.safeParse(synced).success).toBe(true);
        expect(synced.snapshot.phase).toBe('COMPLETED');
        expect(synced.snapshot.participants.map((p) => p.score)).toEqual([
          5, 0,
        ]);
        await eventually(
          async () =>
            peer.events.some(
              (event) =>
                event.event === 'match.update' &&
                MatchUpdateSchema.parse(event.payload).snapshot.phase ===
                  'COMPLETED',
            ),
          'final atomic client update',
        );
        const finals = peer.events
          .filter((event) => event.event === 'match.update')
          .map((event) => MatchUpdateSchema.parse(event.payload))
          .filter((update) => update.snapshot.phase === 'COMPLETED');
        const final = finals.find((update) => update.batches.length > 0)!;
        expect(final.batches.at(-1)?.events.map((event) => event.type)).toEqual(
          ['round.result', 'match.complete'],
        );
        expect(final.batches.at(-1)?.stateVersion).toBe(
          final.snapshot.stateVersion,
        );
      }
      expect(
        h.content.calls
          .filter((call) => call.matchId === matchId)
          .map((call) => call.roundNumber),
      ).toEqual([1, 2, 3, 4, 5]);
    },
  );

  it('recovers a lost counted ACK with the original attempt ID and recovers a lost result by full snapshot', async () => {
    h = await createHarness();
    const a = await h.connect();
    const b = await h.connect();
    const matchId = await startMatch(h, a, b);
    const { round } = await readyRound(h, a, b, matchId);
    const packet = answer(matchId, round.roundId, round.canonicalText);
    h.setOutbound((message) =>
      (message.kind === 'ack' && message.event === 'answer.submit') ||
      (message.kind === 'event' && message.event === 'match.update')
        ? 'drop'
        : 'send',
    );
    a.fire('answer.submit', packet);
    await eventually(
      async () =>
        (await h!.store.readCommitted(matchId))!.state.countedAttempts
          .length === 1,
      'committed answer with lost delivery',
    );
    expect(
      a.replies.filter((reply) => reply.event === 'answer.submit'),
    ).toEqual([]);
    const durable = (await h.store.readCommitted(matchId))!;
    h.setOutbound(() => 'send');
    const retry = success(
      await a.request<GameplayReplyData>('answer.submit', packet),
    );
    expect(retry.ack).toEqual(durable.state.countedAttempts[0]?.ack);
    const synced = await b.match(matchId);
    expect(synced.batches).toEqual([]);
    expect(synced.snapshot.participants.map((p) => p.score)).toEqual([1, 0]);
    expect(synced.snapshot.stateVersion).toBe(durable.state.stateVersion);
    expect(
      (await h.store.readCommitted(matchId))!.state.countedAttempts,
    ).toHaveLength(1);
  });

  it('reuses a rejected ID on a fresh receipt and rejects changed raw text after it counts', async () => {
    h = await createHarness();
    const a = await h.connect();
    const b = await h.connect();
    const matchId = await startMatch(h, a, b);
    let record = await h.store.readCommitted(matchId);
    await eventually(async () => {
      record = await h!.store.readCommitted(matchId);
      return !!record?.state.round;
    }, 'prepared round');
    const packet = answer(matchId, record!.state.round!.roundId, 'qa-wrong');
    expect(
      success(await a.request<GameplayReplyData>('answer.submit', packet)).ack
        ?.status,
    ).toBe('NOT_TYPING');
    await readyRound(h, a, b, matchId);
    const counted = success(
      await a.request<GameplayReplyData>('answer.submit', packet),
    );
    expect(counted.ack?.status).toBe('INCORRECT');
    const conflict = success(
      await a.request<GameplayReplyData>('answer.submit', {
        ...packet,
        text: ' QA-WRONG ',
      }),
    );
    expect(conflict.ack?.status).toBe('IDEMPOTENCY_CONFLICT');
    expect(
      success(await a.request<GameplayReplyData>('answer.submit', packet)).ack,
    ).toEqual(counted.ack);
    expect(
      (await h.store.readCommitted(matchId))!.state.countedAttempts,
    ).toHaveLength(1);
  });

  it('requires fresh device audio readiness after a PREPARING replacement', async () => {
    h = await createHarness();
    const a = await h.connect();
    const b = await h.connect();
    const matchId = await startMatch(h, a, b);
    await eventually(
      async () => !!(await h!.store.readCommitted(matchId))?.state.round,
      'prepared round',
    );
    const round = (await h.store.readCommitted(matchId))!.state.round!;
    const payload = {
      matchId,
      roundId: round.roundId,
      audioVersion: round.audio.audioVersion,
    };
    expect(
      success(await a.request<GameplayReplyData>('round.audio_ready', payload))
        .error,
    ).toBeNull();
    const replacement = await h.connect(a.playerId);
    expect(
      success(await b.request<GameplayReplyData>('round.audio_ready', payload))
        .error,
    ).toBeNull();
    let saved = (await h.store.readCommitted(matchId))!;
    expect(saved.state.phase).toBe('PREPARING_ROUND');
    expect(saved.state.round!.monoSchedule).toBeNull();
    expect(
      saved.state.participants.find((p) => p.playerId === a.playerId)!.ready,
    ).toBe(false);
    expect(
      success(
        await replacement.request<GameplayReplyData>(
          'round.audio_ready',
          payload,
        ),
      ).error,
    ).toBeNull();
    saved = (await h.store.readCommitted(matchId))!;
    expect(saved.state.phase).toBe('COUNTDOWN');
    expect(saved.state.round!.monoSchedule).not.toBeNull();
    expect(saved.state.participants.map((p) => p.score)).toEqual([0, 0]);
  });

  it('recovers the original room after the HTTP creation response is ignored and fences a stale mutation', async () => {
    h = await createHarness();
    const a = await h.connect();
    const original = await a.sync();
    const body = {
      requestId: randomUUID(),
      expectedAdmissionRevision: original.admissionRevision,
      setup: { mode: 'classic', categorySlug: 'general', difficulty: 1 },
    };
    const first = await h.http<SessionState>(a, 'POST', '/v1/rooms', body);
    expect(first.status).toBeLessThan(300); // Simulate loss to the consumer after a real HTTP response.
    const recovered = await a.sync();
    expect(recovered.admission.kind).toBe('lobby');
    expect(
      success((await h.http<SessionState>(a, 'POST', '/v1/rooms', body)).reply),
    ).toEqual(success(first.reply));
    const stale = await a.request<SessionState>('queue.join', {
      ...body,
      requestId: randomUUID(),
    });
    expect(stale.ok).toBe(false);
    expect((await a.sync()).admission).toEqual(recovered.admission);
  });

  it('discards a late next-round source result after disconnect grace aborts the match', async () => {
    h = await createHarness({ config: { sourceTimeoutMs: 60_000 } });
    const a = await h.connect();
    const b = await h.connect();
    const gate = barrier(h.testDb);
    h.content.setGate(() => gate.pause());
    const matchId = await startMatch(h, a, b);
    await gate.reached;
    a.close();
    await eventually(
      async () =>
        (await h!.store.readCommitted(matchId))!.state.participants.some(
          (p) => !p.connected,
        ),
      'server-observed disconnect',
    );
    const disconnected = (await h.store.readCommitted(matchId))!;
    const deadline = disconnected.state.participants.find(
      (p) => p.playerId === a.playerId,
    )!.graceDeadlineMonoMs!;
    await h.advance(deadline);
    await eventually(
      async () =>
        (await h!.store.readCommitted(matchId))!.state.phase === 'ABORTED',
      'grace interruption',
    );
    gate.release();
    h.content.setGate();
    await h.runtime.reconcile();
    const terminal = (await h.store.readCommitted(matchId))!;
    expect(terminal.state.roundNumber).toBe(0);
    expect(terminal.state.completion).toBeNull();
    expect(terminal.state.interruption?.reason).toBe('DISCONNECT_TIMEOUT');
    expect(
      (
        await h.testDb.pool.query(
          'SELECT 1 FROM match_rounds WHERE match_id = $1',
          [matchId],
        )
      ).rows,
    ).toEqual([]);
    expect((await b.match(matchId)).snapshot.phase).toBe('ABORTED');
  });
});
