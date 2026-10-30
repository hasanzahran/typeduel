import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { MatchUpdateSchema, type GameplayReplyData } from '@typeduel/contracts';
import {
  answer,
  createHarness,
  durableRows,
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
const forbiddenKeys = new Set([
  'canonicalText',
  'acceptedVariants',
  'wordId',
  'usedWordIds',
  'fingerprint',
  'checkpoint',
  'clockAnchor',
  'monoSchedule',
  'lastInput',
  'ownerEpoch',
  'ownerId',
  'storeRevision',
  'lastOperationId',
  'text',
]);
function publicOnly(value: unknown, secrets: string[]) {
  const encoded = JSON.stringify(value);
  for (const secret of secrets) expect(encoded).not.toContain(secret);
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node !== null && typeof node === 'object')
      for (const [key, child] of Object.entries(node)) {
        expect(
          forbiddenKeys.has(key),
          `Private field ${key} crossed transport`,
        ).toBe(false);
        visit(child);
      }
  };
  visit(value);
}

describe('actual transport privacy boundaries', () => {
  it('keeps credentials, guesses and private answer material out of live packets and opponent recovery', async () => {
    h = await createHarness();
    const a = await h.connect();
    const b = await h.connect();
    const matchId = await startMatch(h, a, b);
    const { round } = await readyRound(h, a, b, matchId);
    const rawA = 'qa-private-guess-A';
    const rawB = 'qa-private-guess-B';
    const first = answer(matchId, round.roundId, rawA);
    const second = answer(matchId, round.roundId, rawB);
    expect(
      success(await a.request<GameplayReplyData>('answer.submit', first)).ack
        ?.status,
    ).toBe('INCORRECT');
    expect(
      success(await b.request<GameplayReplyData>('answer.submit', second)).ack
        ?.status,
    ).toBe('INCORRECT');
    const committed = (await h.store.readCommitted(matchId))!;
    const secrets = [
      a.token,
      b.token,
      rawA,
      rawB,
      round.canonicalText,
      round.wordId,
      ...round.acceptedVariants,
      ...committed.state.countedAttempts.map((entry) => entry.fingerprint),
    ];
    for (const peer of [a, b]) {
      const update = await peer.match(matchId);
      expect(MatchUpdateSchema.safeParse(update).success).toBe(true);
      expect(update.snapshot.viewer.playerId).toBe(peer.playerId);
      expect(
        update.snapshot.viewer.countedAttempts.map((ack) => ack.attemptId),
      ).toEqual([peer === a ? first.attemptId : second.attemptId]);
      expect(JSON.stringify(update)).not.toContain(
        peer === a ? second.attemptId : first.attemptId,
      );
      publicOnly(update, secrets);
      publicOnly(peer.events, secrets);
      publicOnly(peer.replies, secrets);
    }
    const durable = JSON.stringify(await durableRows(h.testDb.pool));
    for (const secret of [a.token, b.token, rawA, rawB])
      expect(durable).not.toContain(secret);
  });

  it('reveals canonical spelling only in closed results and never reflects the submitted raw spelling', async () => {
    h = await createHarness();
    const a = await h.connect();
    const b = await h.connect();
    const matchId = await startMatch(h, a, b);
    const { round } = await readyRound(h, a, b, matchId);
    const before = h.packets.length;
    const raw = ` ${round.canonicalText.toUpperCase()} `;
    const reply = await a.request<GameplayReplyData>(
      'answer.submit',
      answer(matchId, round.roundId, raw),
    );
    expect(success(reply).ack?.status).toBe('CORRECT');
    for (const peer of [a, b]) {
      const update = await peer.match(matchId);
      expect(update.snapshot.phase).toBe('ROUND_RESULT');
      if (update.snapshot.phase !== 'ROUND_RESULT')
        throw new Error('Expected closed round');
      expect(update.snapshot.result.correctWord).toBe(round.canonicalText);
      expect(MatchUpdateSchema.safeParse(update).success).toBe(true);
      publicOnly(update, [
        raw,
        round.wordId,
        ...round.acceptedVariants,
        a.token,
        b.token,
      ]);
    }
    publicOnly(
      h.packets.slice(before).map((packet) => packet.payload),
      [raw, round.wordId, ...round.acceptedVariants, a.token, b.token],
    );
    publicOnly(
      h.packets.slice(0, before).map((packet) => packet.payload),
      [raw, round.canonicalText, round.wordId],
    );
  });

  it('sanitizes a private source failure and does not expose participant bindings to outsiders', async () => {
    h = await createHarness();
    const a = await h.connect();
    const b = await h.connect();
    const outsider = await h.connect();
    h.content.setGate(async () => {
      throw new Error('qa-private-provider-response');
    });
    const matchId = await startMatch(h, a, b);
    await eventually(
      async () =>
        (await h!.store.readCommitted(matchId))!.state.phase === 'ABORTED',
      'source failure interruption',
    );
    const response = await outsider.request('match.sync', {
      requestId: randomUUID(),
      matchId,
      lastSeenVersion: 0,
    });
    expect(response).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHORIZED' },
    });
    expect((await outsider.sync()).admission.kind).toBe('idle');
    publicOnly(
      h.packets.map((packet) => packet.payload),
      ['qa-private-provider-response', a.token, b.token],
    );
    expect((await h.store.readCommitted(matchId))!.state.completion).toBeNull();
  });

  it('bounds malformed and duplicate ingress without admitting a match or reflecting payloads', async () => {
    h = await createHarness();
    const a = await h.connect();
    const replies = await Promise.all(
      Array.from({ length: 30 }, () =>
        a.request('answer.submit', { text: 'qa-rate-private-guess' }),
      ),
    );
    expect(
      replies.some((reply) => !reply.ok && reply.error.code === 'RATE_LIMITED'),
    ).toBe(true);
    expect(replies.every((reply) => !reply.ok)).toBe(true);
    publicOnly(replies, ['qa-rate-private-guess', a.token]);
    expect((await h.testDb.pool.query('SELECT 1 FROM matches')).rows).toEqual(
      [],
    );
    h.clock.set(h.clock.monoNow() + 2_000);
    expect((await a.sync()).admission.kind).toBe('idle');
  });

  it('enforces two replay sequences and three distinct counted attempts through the real socket adapter', async () => {
    h = await createHarness();
    const a = await h.connect();
    const b = await h.connect();
    const matchId = await startMatch(h, a, b);
    const { round } = await readyRound(h, a, b, matchId);
    for (const replaySequence of [1, 2, 2]) {
      const replay = await a.request<GameplayReplyData>('round.replay_used', {
        matchId,
        roundId: round.roundId,
        replaySequence,
      });
      expect(success(replay).error).toBeNull();
    }
    const invalid = await a.request<GameplayReplyData>('round.replay_used', {
      matchId,
      roundId: round.roundId,
      replaySequence: 3,
    });
    expect(invalid.ok ? invalid.data.error?.code : invalid.error.code).toMatch(
      /INVALID/,
    );
    for (let index = 0; index < 3; index += 1)
      expect(
        success(
          await a.request<GameplayReplyData>(
            'answer.submit',
            answer(matchId, round.roundId, `wrong-${index}`),
          ),
        ).ack?.status,
      ).toBe('INCORRECT');
    expect(
      success(
        await a.request<GameplayReplyData>(
          'answer.submit',
          answer(matchId, round.roundId, round.canonicalText),
        ),
      ).ack?.status,
    ).toBe('EXHAUSTED');
    const saved = (await h.store.readCommitted(matchId))!;
    expect(
      saved.state.participants.find((p) => p.playerId === a.playerId)
        ?.replaySequences,
    ).toEqual([1, 2]);
    expect(saved.state.countedAttempts).toHaveLength(3);
    expect(saved.state.participants.map((p) => p.score)).toEqual([0, 0]);
  });
});
