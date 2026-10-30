import { describe, expect, it } from 'vitest';
import {
  AnswerAckSchema,
  MatchSnapshotSchema,
  TransitionBatchSchema,
} from '@typeduel/contracts';
import { applyCommand } from '../../src/game/engine.js';
import { projectSnapshot } from '../../src/game/snapshot.js';
import type { MatchState, TransitionResult } from '../../src/game/types.js';
import {
  createFixtureMatch,
  createRoundDescriptor,
  fixtureId,
  prepareReadyRound,
  receiptAt,
  submit,
  tickAt,
} from './fixtures.js';

const players = [fixtureId(1), fixtureId(2)] as const;
const makeMatch = () =>
  createFixtureMatch({ matchId: fixtureId(900), participants: [...players] });
const canonical = 'qa-private-canonical-alpha';
const variant = 'qa-private-variant-alpha';
const guess = 'qa-private-guessed-alpha';
const privateWordId = fixtureId(90_001);

function snapshot(state: MatchState, playerId: string) {
  const result = projectSnapshot(state, playerId);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Expected an authorized projection');
  expect(MatchSnapshotSchema.safeParse(result.snapshot).success).toBe(true);
  // Return the actual projection: mutation tests must not mutate a second parse's copy.
  return result.snapshot;
}

function expectAbsent(value: unknown, secrets: readonly string[]) {
  const serialized = JSON.stringify(value);
  for (const secret of secrets) expect(serialized).not.toContain(secret);
}

function checkTransition(result: TransitionResult, hidden: readonly string[]) {
  for (const batch of result.batches) TransitionBatchSchema.parse(batch);
  if (result.ack !== null) AnswerAckSchema.parse(result.ack);
  expectAbsent(
    { batches: result.batches, ack: result.ack, error: result.error },
    hidden,
  );
  for (const playerId of players)
    expectAbsent(snapshot(result.state, playerId), hidden);
}

describe('independent snapshot and temporal privacy review', () => {
  it('reveals only a closed canonical answer across preparation, playback, typing, result and next round', () => {
    const initial = makeMatch();
    const descriptor = createRoundDescriptor(initial, {
      canonicalText: canonical,
      acceptedVariants: [variant],
      wordId: privateWordId,
    });
    const hidden = [canonical, variant, guess, privateWordId];
    for (const playerId of players)
      expectAbsent(snapshot(initial, playerId), hidden);
    const prepared = prepareReadyRound(initial, { descriptor });
    for (const step of prepared.steps) checkTransition(step, hidden);
    const playing = tickAt(prepared.state, prepared.monoSchedule.playbackAt);
    expect(playing.state.phase).toBe('PLAYING_WORD');
    checkTransition(playing, hidden);
    const active = tickAt(playing.state, prepared.monoSchedule.typingStartAt);
    checkTransition(active, hidden);
    const wrong = submit(active.state, players[0], {
      attemptId: fixtureId(91_000),
      text: guess,
      atMonoMs: prepared.monoSchedule.typingStartAt,
    });
    checkTransition(wrong, [
      ...hidden,
      ...wrong.state.countedAttempts.map((entry) => entry.fingerprint),
    ]);
    const correct = submit(wrong.state, players[1], {
      attemptId: fixtureId(91_001),
      text: variant,
      atMonoMs: prepared.monoSchedule.typingStartAt + 1,
    });
    expect(correct.ack?.status).toBe('CORRECT');
    checkTransition(correct, [
      variant,
      guess,
      privateWordId,
      ...correct.state.countedAttempts.map((entry) => entry.fingerprint),
    ]);
    const events = correct.batches.flatMap((batch) => batch.events);
    expect(events.map((event) => event.type)).toEqual(['round.result']);
    expect(events[0]).toMatchObject({ payload: { correctWord: canonical } });
    for (const playerId of players) {
      const view = snapshot(correct.state, playerId);
      if (view.phase !== 'ROUND_RESULT')
        throw new Error('Expected round result');
      expect(view.result.correctWord).toBe(canonical);
      const { result, ...withoutResult } = view;
      expectAbsent(withoutResult, hidden);
      const { correctWord, ...withoutWord } = result;
      expect(correctWord).toBe(canonical);
      expectAbsent(withoutWord, hidden);
    }
    const nextCanonical = 'qa-private-canonical-beta';
    const next = prepareReadyRound(correct.state, {
      descriptor: createRoundDescriptor(correct.state, {
        canonicalText: nextCanonical,
        acceptedVariants: ['qa-private-variant-beta'],
      }),
    });
    for (const step of next.steps)
      checkTransition(step, [
        nextCanonical,
        variant,
        guess,
        privateWordId,
        'qa-private-variant-beta',
      ]);
    const interrupted = applyCommand(
      next.state,
      { type: 'source.unavailable' },
      receiptAt(next.state, next.state.lastInput.atMonoMs),
    );
    checkTransition(interrupted, [
      nextCanonical,
      variant,
      guess,
      privateWordId,
      'qa-private-variant-beta',
    ]);
    const aborted = snapshot(interrupted.state, players[0]);
    if (aborted.phase !== 'ABORTED') throw new Error('Expected interruption');
    expect(aborted.lastResult?.correctWord).toBe(canonical);
    expect(aborted.lastResult?.roundNumber).toBe(1);
    expect(aborted.roundNumber).toBe(2);
  });

  it('keeps public state identical while counters and historical outcomes belong only to the viewer', () => {
    const prepared = prepareReadyRound(makeMatch());
    let state = tickAt(
      prepared.state,
      prepared.monoSchedule.typingStartAt,
    ).state;
    const first = submit(state, players[0], {
      attemptId: fixtureId(92_001),
      text: 'wrong-a',
      atMonoMs: prepared.monoSchedule.typingStartAt,
    });
    const second = submit(first.state, players[0], {
      attemptId: fixtureId(92_002),
      text: 'wrong-b',
      atMonoMs: prepared.monoSchedule.typingStartAt,
    });
    state = applyCommand(
      second.state,
      {
        type: 'round.replay_used',
        playerId: players[0],
        payload: {
          matchId: second.state.matchId,
          roundId: prepared.descriptor.roundId,
          replaySequence: 1,
        },
      },
      receiptAt(second.state, prepared.monoSchedule.typingStartAt),
    ).state;
    const a = snapshot(state, players[0]);
    const b = snapshot(state, players[1]);
    expect(a.viewer).toMatchObject({
      playerId: players[0],
      attemptsRemaining: 1,
      replaysRemaining: 1,
      countedAttempts: [first.ack, second.ack],
    });
    expect(b.viewer).toMatchObject({
      playerId: players[1],
      attemptsRemaining: 3,
      replaysRemaining: 2,
      countedAttempts: [],
    });
    const { viewer: viewerA, ...publicA } = a;
    const { viewer: viewerB, ...publicB } = b;
    expect(viewerA.playerId).not.toBe(viewerB.playerId);
    expect(publicA).toEqual(publicB);
    expectAbsent(b, [
      fixtureId(92_001),
      fixtureId(92_002),
      'wrong-a',
      'wrong-b',
    ]);
    const unauthorized = projectSnapshot(state, fixtureId(92_999));
    expect(unauthorized).toEqual({
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Game command could not be applied.',
      },
    });
    expectAbsent(unauthorized, [
      state.matchId,
      prepared.descriptor.canonicalText,
      prepared.descriptor.wordId,
      'wrong-a',
      'wrong-b',
    ]);
  });

  it('returns detached nested snapshots, event payloads and acknowledgements', () => {
    const prepared = prepareReadyRound(makeMatch());
    const active = tickAt(prepared.state, prepared.monoSchedule.typingStartAt);
    const wrong = submit(active.state, players[0], {
      attemptId: fixtureId(93_001),
      text: guess,
      atMonoMs: prepared.monoSchedule.typingStartAt,
    });
    const priorState = structuredClone(wrong.state);
    const view = snapshot(wrong.state, players[0]);
    const priorProjection = structuredClone(view);
    view.participants[0].score = 7;
    view.viewer.attemptsRemaining = 0;
    const history = view.viewer.countedAttempts[0];
    if (!history) throw new Error('Expected a counted outcome');
    history.status = 'CORRECT';
    if (view.phase !== 'ACTIVE_TYPING')
      throw new Error('Expected typing phase');
    view.round.audio.url = 'https://mutated.invalid/';
    view.round.schedule.deadlineAt += 999;
    expect(wrong.state).toEqual(priorState);
    expect(snapshot(wrong.state, players[0])).toEqual(priorProjection);
    if (!wrong.ack) throw new Error('Expected answer acknowledgement');
    wrong.ack.attemptsRemaining = 0;
    expect(wrong.state).toEqual(priorState);
    const correct = submit(wrong.state, players[1], {
      attemptId: fixtureId(93_002),
      text: prepared.descriptor.canonicalText,
      atMonoMs: prepared.monoSchedule.typingStartAt + 1,
    });
    const closedState = structuredClone(correct.state);
    const closed = snapshot(correct.state, players[1]);
    if (closed.phase !== 'ROUND_RESULT')
      throw new Error('Expected round result');
    closed.result.correctWord = 'mutated';
    closed.result.scores[0].score = 8;
    const event = correct.batches[0]?.events[0];
    if (event?.type !== 'round.result')
      throw new Error('Expected round result event');
    event.payload.correctWord = 'mutated event';
    event.payload.scores[1].score = 8;
    expect(correct.state).toEqual(closedState);
    expect(wrong.state).toEqual(priorState);
  });

  it('sanitizes invalid descriptors, malformed input and unauthorized guesses', () => {
    const state = makeMatch();
    const descriptor = createRoundDescriptor(state, {
      canonicalText: canonical,
      acceptedVariants: [variant],
      wordId: privateWordId,
      level: 5,
    });
    const invalid = applyCommand(
      state,
      { type: 'round.prepare', descriptor },
      receiptAt(state, state.lastInput.atMonoMs),
    );
    expect(invalid.error?.code).toBe('INVALID_DESCRIPTOR');
    checkTransition(invalid, [canonical, variant, privateWordId]);
    expect(invalid.state.round).toBeNull();
    const prepared = prepareReadyRound(invalid.state, {
      descriptor: { ...descriptor, level: 1 },
    });
    const malformed = applyCommand(
      prepared.state,
      {
        type: 'answer.submit',
        playerId: players[0],
        payload: {
          matchId: canonical,
          roundId: privateWordId,
          attemptId: variant,
          text: guess,
        },
      },
      receiptAt(prepared.state, prepared.monoSchedule.typingStartAt),
    );
    expect(malformed.ack).toBeNull();
    expect(malformed.error?.code).toBe('INVALID_COMMAND');
    checkTransition(malformed, [canonical, variant, privateWordId, guess]);
    const unauthorized = submit(malformed.state, fixtureId(94_001), {
      attemptId: fixtureId(94_002),
      text: canonical,
      atMonoMs: prepared.monoSchedule.typingStartAt,
    });
    expect(unauthorized.ack?.status).toBe('UNAUTHORIZED');
    expect(unauthorized.ack?.attemptsRemaining).toBeNull();
    checkTransition(unauthorized, [canonical, variant, privateWordId, guess]);
    expect(unauthorized.state.countedAttempts).toEqual([]);
  });

  it('does not reveal an unclosed answer on exact grace expiry or a terminal answer retry', () => {
    const state = makeMatch();
    const prepared = prepareReadyRound(state, {
      descriptor: createRoundDescriptor(state, {
        canonicalText: canonical,
        acceptedVariants: [variant],
        wordId: privateWordId,
      }),
    });
    const disconnectedAt = prepared.monoSchedule.deadlineAt - 10_000;
    const disconnected = applyCommand(
      prepared.state,
      { type: 'player.disconnect', playerId: players[1] },
      receiptAt(prepared.state, disconnectedAt),
    );
    const wrong = submit(disconnected.state, players[0], {
      attemptId: fixtureId(95_001),
      text: guess,
      atMonoMs: prepared.monoSchedule.typingStartAt,
    });
    const expired = tickAt(wrong.state, prepared.monoSchedule.deadlineAt);
    expect(expired.state.phase).toBe('ABORTED');
    checkTransition(expired, [canonical, variant, guess, privateWordId]);
    const aborted = snapshot(expired.state, players[0]);
    if (aborted.phase !== 'ABORTED') throw new Error('Expected interruption');
    expect(aborted.lastResult).toBeNull();
    const retry = submit(expired.state, players[0], {
      attemptId: fixtureId(95_001),
      text: guess,
      atMonoMs: prepared.monoSchedule.deadlineAt,
    });
    expect(retry.ack).toEqual(wrong.ack);
    expect(retry.batches).toEqual([]);
    checkTransition(retry, [canonical, variant, guess, privateWordId]);
  });

  it('recovers original acknowledgements and played/next levels after a Challenge result', () => {
    const state = createFixtureMatch({
      matchId: fixtureId(900),
      participants: [...players],
      setup: { mode: 'challenge', categorySlug: 'animals' },
    });
    const prepared = prepareReadyRound(state);
    const correct = submit(prepared.state, players[0], {
      attemptId: fixtureId(96_001),
      text: prepared.descriptor.canonicalText,
      atMonoMs: prepared.monoSchedule.typingStartAt,
    });
    const view = snapshot(correct.state, players[0]);
    if (view.phase !== 'ROUND_RESULT') throw new Error('Expected round result');
    expect(view.result).toMatchObject({
      level: 1,
      nextLevel: 2,
      correctWord: prepared.descriptor.canonicalText,
    });
    expect(view.currentLevel).toBe(2);
    expect(view.viewer.countedAttempts).toEqual([correct.ack]);
    const next = prepareReadyRound(correct.state);
    const fresh = snapshot(next.state, players[0]);
    expect(fresh.viewer.attemptsRemaining).toBe(3);
    expect(fresh.viewer.countedAttempts).toEqual([correct.ack]);
    expect(fresh.stateVersion).toBeGreaterThan(correct.ack?.stateVersion ?? -1);
    const retried = submit(next.state, players[0], {
      attemptId: fixtureId(96_001),
      roundId: prepared.descriptor.roundId,
      text: prepared.descriptor.canonicalText,
      atMonoMs: next.state.lastInput.atMonoMs,
    });
    expect(retried.ack).toEqual(correct.ack);
    expect(snapshot(retried.state, players[0])).toEqual(fresh);
  });
});
