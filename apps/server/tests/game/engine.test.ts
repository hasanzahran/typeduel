import { describe, expect, it } from 'vitest';
import { AnswerAckSchema, TransitionBatchSchema } from '@typeduel/contracts';
import {
  applyCommand,
  createMatch,
  getNextWakeAt,
} from '../../src/game/engine.js';
import { fingerprintText, normalizeAnswer } from '../../src/game/rules.js';
import { projectSnapshot } from '../../src/game/snapshot.js';
import type { MatchState, TransitionResult } from '../../src/game/types.js';
import {
  createFixtureMatch,
  createRoundDescriptor,
  completeInitialPlayback,
  fixtureId,
  preparePlayableRound as prepareReadyRound,
  prepareReadyRound as prepareCountdownRound,
  receiptAt,
  submit,
  tickAt,
} from './fixtures.js';

function verify(result: TransitionResult): MatchState {
  for (const batch of result.batches)
    expect(TransitionBatchSchema.safeParse(batch).success).toBe(true);
  if (result.ack)
    expect(AnswerAckSchema.safeParse(result.ack).success).toBe(true);
  for (const p of result.state.participants)
    expect(projectSnapshot(result.state, p.playerId).ok).toBe(true);
  expect(
    result.state.participants.reduce((total, p) => total + p.score, 0),
  ).toBeLessThanOrEqual(result.state.roundNumber);
  return result.state;
}
function finishRound(
  state: MatchState,
  winningPlayer: 0 | 1 | null,
): MatchState {
  const ready = prepareReadyRound(state);
  ready.steps.forEach(verify);
  return winningPlayer === null
    ? verify(tickAt(ready.state, ready.monoSchedule.deadlineAt))
    : verify(
        submit(ready.state, ready.state.participants[winningPlayer].playerId, {
          attemptId: fixtureId(1_000 + ready.state.roundNumber),
          text: ready.descriptor.canonicalText,
          atMonoMs: ready.monoSchedule.typingStartAt,
        }),
      );
}

describe('deterministic authoritative core', () => {
  it('validates creation without reflecting invalid private values', () => {
    const state = createFixtureMatch();
    expect(() =>
      createMatch({
        matchId: state.matchId,
        setup: state.setup,
        clockAnchor: state.clockAnchor,
        participants: [fixtureId(2), fixtureId(2)],
      }),
    ).toThrow('Invalid match configuration');
    expect(() =>
      createFixtureMatch({ config: { playbackMarginMs: -1 } }),
    ).toThrow('Invalid match configuration');
    expect(() =>
      createFixtureMatch({
        config: { laterCountdownMs: Number.POSITIVE_INFINITY },
      }),
    ).toThrow('Invalid match configuration');
    expect(getNextWakeAt(state)).toBeNull();
  });

  it('replays identical traces and preserves previous states and descriptors', () => {
    const trace = () => {
      const initial = createFixtureMatch({
        setup: { mode: 'challenge', categorySlug: 'animals' },
      });
      const before = structuredClone(initial);
      const descriptor = createRoundDescriptor(initial);
      const descriptorBefore = structuredClone(descriptor);
      const ready = prepareReadyRound(initial, { descriptor });
      const result = submit(ready.state, initial.participants[0].playerId, {
        attemptId: fixtureId(999),
        text: descriptor.canonicalText,
        atMonoMs: ready.monoSchedule.typingStartAt,
      });
      verify(result);
      expect(initial).toEqual(before);
      expect(descriptor).toEqual(descriptorBefore);
      expect(ready.state.participants[0].score).toBe(0);
      return { ready, result };
    };
    expect(trace()).toEqual(trace());
  });

  it.each([1, 2, 3, 4, 5])(
    'uses fixed Classic level %i and its typing duration',
    (level) => {
      const ready = prepareCountdownRound(
        createFixtureMatch({
          setup: {
            mode: 'classic',
            categorySlug: 'general',
            difficulty: level,
          },
        }),
      );
      expect(ready.monoSchedule.playbackAt).toBe(4_000);
      expect(ready.monoSchedule.typingStartAt).toBe(5_500);
      expect(
        ready.monoSchedule.deadlineAt - ready.monoSchedule.typingStartAt,
      ).toBe([8_000, 8_000, 10_000, 12_000, 15_000][level - 1]);
      let state = ready.state;
      expect(getNextWakeAt(state)).toBe(4_000);
      state = verify(tickAt(state, 4_000));
      expect(state.phase).toBe('PLAYING_WORD');
      state = completeInitialPlayback(state);
      expect(getNextWakeAt(state)).toBe(5_500);
      state = verify(tickAt(state, 5_500));
      expect(state.phase).toBe('ACTIVE_TYPING');
      state = verify(
        submit(state, state.participants[0].playerId, {
          attemptId: fixtureId(900),
          text: ready.descriptor.canonicalText,
          atMonoMs: 5_500,
        }),
      );
      expect(state.currentLevel).toBe(level);
      expect(state.lastResult?.nextLevel).toBe(level);
    },
  );

  it('requires both exact assets; duplicate readiness never resets a countdown', () => {
    let state = createFixtureMatch();
    const descriptor = createRoundDescriptor(state);
    state = verify(
      applyCommand(
        state,
        { type: 'round.prepare', descriptor },
        receiptAt(state, 1_000),
      ),
    );
    const ready = (
      audioVersion: string,
      player = state.participants[0].playerId,
    ) =>
      applyCommand(
        state,
        {
          type: 'round.audio_ready',
          playerId: player,
          payload: {
            matchId: state.matchId,
            roundId: descriptor.roundId,
            audioVersion,
          },
        },
        receiptAt(state, 1_000),
      );
    expect(ready(fixtureId(999)).error?.code).toBe('WRONG_ASSET');
    state = verify(ready(descriptor.audio.audioVersion));
    expect(state.phase).toBe('PREPARING_ROUND');
    expect(ready(descriptor.audio.audioVersion).batches).toEqual([]);
    state = verify(
      ready(descriptor.audio.audioVersion, state.participants[1].playerId),
    );
    const schedule = structuredClone(state.round?.monoSchedule);
    const duplicate = ready(descriptor.audio.audioVersion);
    expect(duplicate.batches).toEqual([]);
    expect(duplicate.state.round?.monoSchedule).toEqual(schedule);
  });

  it('expires preparation exactly 20 seconds after preparation without rescheduling', () => {
    let state = createFixtureMatch();
    const descriptor = createRoundDescriptor(state);
    state = verify(
      applyCommand(
        state,
        { type: 'round.prepare', descriptor },
        receiptAt(state, 1_000),
      ),
    );
    expect(state.round?.preflightDeadlineMonoMs).toBe(21_000);
    state = verify(
      applyCommand(
        state,
        {
          type: 'round.audio_ready',
          playerId: state.participants[0].playerId,
          payload: {
            matchId: state.matchId,
            roundId: descriptor.roundId,
            audioVersion: descriptor.audio.audioVersion,
          },
        },
        receiptAt(state, 20_999),
      ),
    );
    expect(state.round?.preflightDeadlineMonoMs).toBe(21_000);
    const expired = tickAt(state, 21_000);
    verify(expired);
    expect(expired.state.phase).toBe('ABORTED');
    expect(expired.state.interruption?.reason).toBe('AUDIO_UNAVAILABLE');
    expect(expired.state.participants.map((p) => p.score)).toEqual([0, 0]);
  });

  it('accepts both completions only in the fixed end-to-typing window', () => {
    const ready = prepareCountdownRound(createFixtureMatch());
    const round = ready.state.round!;
    const payload = {
      matchId: ready.state.matchId,
      roundId: round.roundId,
      audioVersion: round.audio.audioVersion,
    };
    let state = ready.state;
    const firstEnd = ready.monoSchedule.playbackAt + round.audio.clipDurationMs;
    const early = applyCommand(
      state,
      {
        type: 'round.audio_completed',
        playerId: state.participants[0].playerId,
        payload,
      },
      receiptAt(state, firstEnd - 1),
    );
    expect(early.error?.code).toBe('INVALID_TIME');
    state = early.state;
    for (const [index, at] of [
      firstEnd,
      ready.monoSchedule.typingStartAt - 1,
    ].entries()) {
      const completed = applyCommand(
        state,
        {
          type: 'round.audio_completed',
          playerId: state.participants[index]!.playerId,
          payload,
        },
        receiptAt(state, at),
      );
      expect(completed.error).toBeNull();
      state = verify(completed);
    }
    state = verify(tickAt(state, ready.monoSchedule.typingStartAt));
    expect(state.phase).toBe('ACTIVE_TYPING');
    expect(state.participants.every((p) => p.initialPlaybackCompleted)).toBe(
      true,
    );
  });

  it('interrupts without a winner when completion proof is missing or cleared', () => {
    const cases = ['missing', 'disconnect'] as const;
    for (const mode of cases) {
      const ready = prepareCountdownRound(createFixtureMatch());
      const round = ready.state.round!;
      const payload = {
        matchId: ready.state.matchId,
        roundId: round.roundId,
        audioVersion: round.audio.audioVersion,
      };
      let state = tickAt(ready.state, ready.monoSchedule.playbackAt).state;
      state = verify(
        applyCommand(
          state,
          {
            type: 'round.audio_completed',
            playerId: state.participants[0].playerId,
            payload,
          },
          receiptAt(
            state,
            ready.monoSchedule.playbackAt + round.audio.clipDurationMs,
          ),
        ),
      );
      if (mode === 'disconnect') {
        state = verify(
          applyCommand(
            state,
            {
              type: 'round.audio_completed',
              playerId: state.participants[1].playerId,
              payload,
            },
            receiptAt(state, ready.monoSchedule.typingStartAt - 3),
          ),
        );
        const playerId = state.participants[0].playerId;
        state = verify(
          applyCommand(
            state,
            { type: 'player.disconnect', playerId },
            receiptAt(state, ready.monoSchedule.typingStartAt - 2),
          ),
        );
        state = verify(
          applyCommand(
            state,
            { type: 'player.reconnect', playerId },
            receiptAt(state, ready.monoSchedule.typingStartAt - 1),
          ),
        );
      }
      const gated = tickAt(state, ready.monoSchedule.typingStartAt);
      verify(gated);
      expect(gated.state.phase).toBe('ABORTED');
      expect(gated.state.interruption?.reason).toBe('AUDIO_UNAVAILABLE');
      expect(gated.state.completion).toBeNull();
    }
  });

  it('accepts only allowlisted audio failures and fails the shared round closed', () => {
    const ready = prepareCountdownRound(createFixtureMatch());
    const round = ready.state.round!;
    const base = {
      matchId: ready.state.matchId,
      roundId: round.roundId,
      audioVersion: round.audio.audioVersion,
    };
    const invalid = applyCommand(
      ready.state,
      {
        type: 'round.audio_failed',
        playerId: ready.state.participants[0].playerId,
        payload: { ...base, reason: 'PRIVATE_REASON' },
      },
      receiptAt(ready.state, ready.state.lastInput.atMonoMs),
    );
    expect(invalid.error?.code).toBe('INVALID_COMMAND');
    const failed = applyCommand(
      invalid.state,
      {
        type: 'round.audio_failed',
        playerId: invalid.state.participants[0].playerId,
        payload: { ...base, reason: 'PLAYBACK_FAILED' },
      },
      receiptAt(invalid.state, invalid.state.lastInput.atMonoMs),
    );
    verify(failed);
    expect(failed.state.phase).toBe('ABORTED');
    expect(failed.state.interruption?.reason).toBe('AUDIO_UNAVAILABLE');
  });

  it('checks category, level, word and round reuse without modifying setup', () => {
    let state = createFixtureMatch({
      setup: { mode: 'classic', categorySlug: 'animals', difficulty: 3 },
    });
    for (const overrides of [
      { level: 2 },
      { categorySlugs: [] },
      { canonicalText: ' ' },
    ]) {
      const rejected = applyCommand(
        state,
        {
          type: 'round.prepare',
          descriptor: createRoundDescriptor(state, overrides),
        },
        receiptAt(state, 1_000),
      );
      expect(rejected.error?.code).toBe('INVALID_DESCRIPTOR');
      expect(rejected.state.roundNumber).toBe(0);
      expect(rejected.batches).toEqual([]);
    }
    state = finishRound(state, null);
    for (const overrides of [
      { wordId: fixtureId(201) },
      { roundId: fixtureId(101) },
    ]) {
      const rejected = applyCommand(
        state,
        {
          type: 'round.prepare',
          descriptor: createRoundDescriptor(state, overrides),
        },
        receiptAt(state, state.lastInput.atMonoMs),
      );
      expect(rejected.error?.code).toBe('INVALID_DESCRIPTOR');
    }
    expect(state.setup).toEqual({
      mode: 'classic',
      categorySlug: 'animals',
      difficulty: 3,
    });
  });

  it('rejects early input, allows exact typing start and rejects exact deadline without an explicit tick', () => {
    const ready = prepareReadyRound(createFixtureMatch());
    const [player] = ready.state.participants;
    const early = submit(ready.state, player.playerId, {
      attemptId: fixtureId(800),
      text: 'wrong',
      atMonoMs: ready.monoSchedule.typingStartAt - 1,
    });
    expect(early.ack?.status).toBe('NOT_TYPING');
    expect(early.state.countedAttempts).toHaveLength(0);
    const start = submit(early.state, player.playerId, {
      attemptId: fixtureId(800),
      text: 'wrong',
      atMonoMs: ready.monoSchedule.typingStartAt,
    });
    verify(start);
    expect(start.ack?.status).toBe('INCORRECT');
    const late = submit(start.state, player.playerId, {
      attemptId: fixtureId(801),
      text: ready.descriptor.canonicalText,
      atMonoMs: ready.monoSchedule.deadlineAt,
    });
    verify(late);
    expect(late.ack?.status).toBe('ROUND_CLOSED');
    expect(late.state.lastResult?.winnerId).toBeNull();
    expect(late.state.countedAttempts).toHaveLength(1);
  });

  it('counts three distinct IDs, not retransmissions; exhausted players wait for deadline', () => {
    const ready = prepareReadyRound(createFixtureMatch());
    let state = ready.state;
    for (const player of state.participants)
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const result = submit(state, player.playerId, {
          attemptId: fixtureId(800 + attempt),
          text: 'same wrong text',
          atMonoMs: ready.monoSchedule.typingStartAt,
        });
        state = verify(result);
        expect(result.ack?.attemptsRemaining).toBe(3 - attempt);
      }
    expect(state.phase).toBe('ACTIVE_TYPING');
    const exhausted = submit(state, state.participants[0].playerId, {
      attemptId: fixtureId(899),
      text: ready.descriptor.canonicalText,
      atMonoMs: ready.monoSchedule.typingStartAt,
    });
    expect(exhausted.ack?.status).toBe('EXHAUSTED');
    expect(exhausted.batches).toEqual([]);
    expect(exhausted.state.countedAttempts).toHaveLength(6);
    const ended = tickAt(
      exhausted.state,
      ready.monoSchedule.deadlineAt + 1_000,
    );
    verify(ended);
    expect(ended.batches).toHaveLength(1);
    expect(ended.state.lastResult?.winnerId).toBeNull();
    expect(
      tickAt(ended.state, ready.monoSchedule.deadlineAt + 1_000).batches,
    ).toEqual([]);
  });

  it.each([0, 1] as const)(
    'chooses player %i when their equal-time correct receipt is first',
    (first) => {
      const ready = prepareReadyRound(createFixtureMatch());
      const win = submit(
        ready.state,
        ready.state.participants[first].playerId,
        {
          attemptId: fixtureId(900),
          text: ready.descriptor.canonicalText,
          atMonoMs: ready.monoSchedule.typingStartAt,
        },
      );
      const lose = submit(
        win.state,
        win.state.participants[first === 0 ? 1 : 0].playerId,
        {
          attemptId: fixtureId(900),
          text: ready.descriptor.canonicalText,
          atMonoMs: ready.monoSchedule.typingStartAt,
        },
      );
      verify(lose);
      expect(lose.ack?.status).toBe('ROUND_CLOSED');
      expect(lose.state.lastResult?.winnerId).toBe(
        win.ack && ready.state.participants[first].playerId,
      );
      expect(lose.state.participants.reduce((n, p) => n + p.score, 0)).toBe(1);
    },
  );

  it('replays counted historical ACKs and rejects changed raw payload before phase checks', () => {
    const ready = prepareReadyRound(createFixtureMatch());
    const playerId = ready.state.participants[0].playerId;
    const options = {
      attemptId: fixtureId(900),
      text: ` ${ready.descriptor.canonicalText.toUpperCase()} `,
      atMonoMs: ready.monoSchedule.typingStartAt,
    };
    const win = submit(ready.state, playerId, options);
    const next = prepareReadyRound(win.state);
    const retry = submit(next.state, playerId, {
      ...options,
      roundId: ready.descriptor.roundId,
      atMonoMs: next.state.lastInput.atMonoMs,
    });
    expect(retry.ack).toEqual(win.ack);
    expect(retry.batches).toEqual([]);
    expect(retry.state.stateVersion).toBe(next.state.stateVersion);
    const conflict = submit(retry.state, playerId, {
      ...options,
      roundId: ready.descriptor.roundId,
      text: ready.descriptor.canonicalText,
      atMonoMs: next.state.lastInput.atMonoMs,
    });
    expect(conflict.ack?.status).toBe('IDEMPOTENCY_CONFLICT');
    expect(conflict.state.countedAttempts).toHaveLength(1);
  });

  it('rejects malformed/unauthorized input without counting or echoing guesses', () => {
    const ready = prepareReadyRound(createFixtureMatch());
    const payload = {
      matchId: ready.state.matchId,
      roundId: ready.descriptor.roundId,
      attemptId: fixtureId(900),
      text: 'secret-guess',
    };
    for (const bad of [
      { ...payload, score: 1 },
      { ...payload, text: ' ' },
      { ...payload, text: 'x'.repeat(121) },
      { ...payload, attemptId: 'bad' },
    ]) {
      const result = applyCommand(
        ready.state,
        {
          type: 'answer.submit',
          playerId: ready.state.participants[0].playerId,
          payload: bad,
        },
        receiptAt(ready.state, ready.monoSchedule.typingStartAt),
      );
      expect(result.state.countedAttempts).toHaveLength(0);
      expect(
        JSON.stringify({ ack: result.ack, error: result.error }),
      ).not.toContain('secret-guess');
      expect(result.ack?.status ?? result.error?.code).toBe('INVALID_COMMAND');
    }
    const unauthorized = applyCommand(
      ready.state,
      { type: 'answer.submit', playerId: fixtureId(999), payload },
      receiptAt(ready.state, ready.monoSchedule.typingStartAt),
    );
    expect(unauthorized.ack?.status).toBe('UNAUTHORIZED');
    expect(unauthorized.ack?.attemptsRemaining).toBeNull();
    const wrongMatch = applyCommand(
      ready.state,
      {
        type: 'answer.submit',
        playerId: ready.state.participants[0].playerId,
        payload: { ...payload, matchId: fixtureId(99) },
      },
      receiptAt(ready.state, ready.monoSchedule.typingStartAt),
    );
    expect(wrongMatch.ack?.status).toBe('WRONG_MATCH');
  });

  it.each([
    ['café', ' CAFE\u0301 ', true],
    ['café', 'cafe', false],
    ['co-operate', 'cooperate', false],
    ['ice cream', 'ice  cream', false],
    ['colour', 'color', true],
  ])(
    'matches %s against %s only under frozen normalization/variants',
    (canonicalText, guess, correct) => {
      const initial = createFixtureMatch();
      const ready = prepareReadyRound(initial, {
        descriptor: createRoundDescriptor(initial, {
          canonicalText,
          acceptedVariants: canonicalText === 'colour' ? ['color'] : [],
        }),
      });
      const result = submit(ready.state, ready.state.participants[0].playerId, {
        attemptId: fixtureId(900),
        text: guess,
        atMonoMs: ready.monoSchedule.typingStartAt,
      });
      verify(result);
      expect(result.ack?.status).toBe(correct ? 'CORRECT' : 'INCORRECT');
    },
  );

  it('fingerprints raw UTF-16 before normalization, including unpaired surrogates', () => {
    expect(normalizeAnswer(' CAFE\u0301 ')).toBe('café');
    expect(fingerprintText(' Cat ')).not.toBe(fingerprintText('cat'));
    expect(fingerprintText('\ud800')).not.toBe(fingerprintText('\ud801'));
  });

  it('plays five normal rounds even with a decisive lead and completes atomically', () => {
    let state = createFixtureMatch();
    for (let i = 1; i <= 4; i += 1) {
      state = finishRound(state, 0);
      expect(state.phase).toBe('ROUND_RESULT');
    }
    const ready = prepareReadyRound(state);
    const result = submit(ready.state, state.participants[0].playerId, {
      attemptId: fixtureId(900),
      text: ready.descriptor.canonicalText,
      atMonoMs: ready.monoSchedule.typingStartAt,
    });
    verify(result);
    expect(result.state.phase).toBe('COMPLETED');
    expect(result.state.completion?.roundCount).toBe(5);
    expect(result.batches.at(-1)?.events.map((e) => e.type)).toEqual([
      'round.result',
      'match.complete',
    ]);
    expect(getNextWakeAt(result.state)).toBeNull();
  });

  it.each([1, 2, 3])(
    'ends on sudden-death round %i when scores diverge',
    (extra) => {
      let state = createFixtureMatch({
        setup: { mode: 'challenge', categorySlug: 'food' },
      });
      for (const winner of [0, 1, 0, 1, null] as const)
        state = finishRound(state, winner);
      expect(state.currentLevel).toBe(5);
      for (let i = 1; i < extra; i += 1) state = finishRound(state, null);
      state = finishRound(state, 1);
      expect(state.phase).toBe('COMPLETED');
      expect(state.completion?.roundCount).toBe(5 + extra);
      expect(state.completion?.winnerId).toBe(state.participants[1].playerId);
      expect(state.currentLevel).toBe(5);
      expect(state.setup.categorySlug).toBe('food');
    },
  );

  it('draws after eight scoreless rounds, with no Challenge increase or ninth round', () => {
    let state = createFixtureMatch({
      setup: { mode: 'challenge', categorySlug: 'general' },
    });
    for (let i = 1; i <= 8; i += 1) state = finishRound(state, null);
    expect(state.completion?.draw).toBe(true);
    expect(state.completion?.winnerId).toBeNull();
    expect(state.currentLevel).toBe(1);
    const ninth = applyCommand(
      state,
      { type: 'round.prepare', descriptor: createRoundDescriptor(state) },
      receiptAt(state, state.lastInput.atMonoMs),
    );
    expect(ninth.error?.code).toBe('MATCH_TERMINAL');
    expect(ninth.batches).toEqual([]);
  });

  it('replay sequences are idempotent telemetry with no rule/timer effects', () => {
    const ready = prepareCountdownRound(createFixtureMatch());
    let state = ready.state;
    const replay = (replaySequence: number, at: number) =>
      applyCommand(
        state,
        {
          type: 'round.replay_used',
          playerId: state.participants[0].playerId,
          payload: {
            matchId: state.matchId,
            roundId: ready.descriptor.roundId,
            replaySequence,
          },
        },
        receiptAt(state, at),
      );
    const early = replay(1, ready.monoSchedule.playbackAt);
    expect(early.error?.code).toBe('NOT_TYPING');
    state = early.state;
    state = completeInitialPlayback(state);
    state = verify(replay(2, ready.monoSchedule.typingStartAt));
    expect(replay(2, ready.monoSchedule.typingStartAt).batches).toEqual([]);
    state = verify(replay(1, ready.monoSchedule.typingStartAt));
    expect(replay(3, ready.monoSchedule.typingStartAt).error?.code).toBe(
      'INVALID_COMMAND',
    );
    expect(state.participants[0].replaySequences).toHaveLength(2);
    expect(state.participants[0].attemptsUsed).toBe(0);
    expect(state.round?.monoSchedule).toEqual(ready.monoSchedule);
    expect(state.currentLevel).toBe(1);
  });

  it('reconnects before grace without resetting attempts or scheduled timing', () => {
    const ready = prepareReadyRound(createFixtureMatch());
    const playerId = ready.state.participants[0].playerId;
    let state = verify(
      submit(ready.state, playerId, {
        attemptId: fixtureId(900),
        text: 'wrong',
        atMonoMs: ready.monoSchedule.typingStartAt,
      }),
    );
    state = verify(
      applyCommand(
        state,
        { type: 'player.disconnect', playerId },
        receiptAt(state, ready.monoSchedule.typingStartAt),
      ),
    );
    const grace = state.participants[0].graceDeadlineMonoMs;
    const duplicate = applyCommand(
      state,
      { type: 'player.disconnect', playerId },
      receiptAt(state, ready.monoSchedule.typingStartAt + 100),
    );
    expect(duplicate.state.participants[0].graceDeadlineMonoMs).toBe(grace);
    expect(duplicate.batches).toEqual([]);
    const offline = submit(duplicate.state, playerId, {
      attemptId: fixtureId(901),
      text: ready.descriptor.canonicalText,
      atMonoMs: ready.monoSchedule.typingStartAt + 100,
    });
    expect(offline.ack?.status).toBe('DISCONNECTED');
    state = verify(
      applyCommand(
        offline.state,
        { type: 'player.reconnect', playerId },
        receiptAt(offline.state, ready.monoSchedule.typingStartAt + 9_999),
      ),
    );
    expect(state.participants[0].connected).toBe(true);
    expect(state.participants[0].attemptsUsed).toBe(1);
    expect(state.round?.monoSchedule).toEqual(ready.monoSchedule);
    expect(state.phase).toBe('ROUND_RESULT');
  });

  it('expires grace at the boundary and never resurrects the match', () => {
    let state = createFixtureMatch();
    const playerId = state.participants[0].playerId;
    state = verify(
      applyCommand(
        state,
        { type: 'player.disconnect', playerId },
        receiptAt(state, 1_000),
      ),
    );
    const boundary = applyCommand(
      state,
      { type: 'player.reconnect', playerId },
      receiptAt(state, 11_000),
    );
    verify(boundary);
    expect(boundary.state.phase).toBe('ABORTED');
    expect(boundary.state.interruption?.reason).toBe('DISCONNECT_TIMEOUT');
    expect(boundary.state.completion).toBeNull();
    expect(tickAt(boundary.state, 12_000).batches).toEqual([]);
  });

  it('clears unscheduled readiness on disconnect and waits for fresh asset ACK', () => {
    let state = createFixtureMatch();
    const descriptor = createRoundDescriptor(state);
    state = verify(
      applyCommand(
        state,
        { type: 'round.prepare', descriptor },
        receiptAt(state, 1_000),
      ),
    );
    const playerId = state.participants[0].playerId;
    const payload = {
      matchId: state.matchId,
      roundId: descriptor.roundId,
      audioVersion: descriptor.audio.audioVersion,
    };
    state = verify(
      applyCommand(
        state,
        { type: 'round.audio_ready', playerId, payload },
        receiptAt(state, 1_000),
      ),
    );
    state = verify(
      applyCommand(
        state,
        { type: 'player.disconnect', playerId },
        receiptAt(state, 1_000),
      ),
    );
    expect(state.participants[0].ready).toBe(false);
    state = verify(
      applyCommand(
        state,
        {
          type: 'round.audio_ready',
          playerId: state.participants[1].playerId,
          payload,
        },
        receiptAt(state, 1_000),
      ),
    );
    state = verify(
      applyCommand(
        state,
        { type: 'player.reconnect', playerId },
        receiptAt(state, 1_001),
      ),
    );
    expect(state.phase).toBe('PREPARING_ROUND');
    state = verify(
      applyCommand(
        state,
        { type: 'round.audio_ready', playerId, payload },
        receiptAt(state, 1_001),
      ),
    );
    expect(state.phase).toBe('COUNTDOWN');
  });

  it('rejects backwards or reused ingress order and unsafe time without mutation', () => {
    const state = createFixtureMatch();
    const before = structuredClone(state);
    expect(tickAt(state, 999).error?.code).toBe('OUT_OF_ORDER');
    expect(tickAt(state, Number.NaN).error?.code).toBe('INVALID_TIME');
    expect(
      applyCommand(
        state,
        { type: 'source.unavailable' },
        { receivedAtMonoMs: 1_000, ingressSequence: 0 },
      ).error?.code,
    ).toBe('OUT_OF_ORDER');
    expect(state).toEqual(before);
  });

  it('rejects overflowing schedules and grace before mutating their candidate fields', () => {
    let state = createFixtureMatch({
      clockAnchor: {
        monoMs: 1_000,
        utcEpochMs: Number.MAX_SAFE_INTEGER - 25_000,
      },
    });
    const descriptor = createRoundDescriptor(state);
    state = verify(
      applyCommand(
        state,
        { type: 'round.prepare', descriptor },
        receiptAt(state, 1_000),
      ),
    );
    const payload = {
      matchId: state.matchId,
      roundId: descriptor.roundId,
      audioVersion: descriptor.audio.audioVersion,
    };
    state = verify(
      applyCommand(
        state,
        {
          type: 'round.audio_ready',
          playerId: state.participants[0].playerId,
          payload,
        },
        receiptAt(state, 1_000),
      ),
    );
    const failed = applyCommand(
      state,
      {
        type: 'round.audio_ready',
        playerId: state.participants[1].playerId,
        payload,
      },
      receiptAt(state, 20_000),
    );
    expect(failed.error?.code).toBe('TIME_OVERFLOW');
    expect(failed.state.round?.monoSchedule).toBeNull();
    expect(failed.state.participants[1].ready).toBe(false);
    expect(failed.batches).toEqual([]);
    const disconnect = applyCommand(
      state,
      { type: 'player.disconnect', playerId: state.participants[0].playerId },
      receiptAt(state, 17_000),
    );
    expect(disconnect.error?.code).toBe('TIME_OVERFLOW');
    expect(disconnect.state.participants[0].connected).toBe(true);
  });

  it('maps near-maximum anchors using elapsed differences without overflowing intermediates', () => {
    const monoMs = Number.MAX_SAFE_INTEGER - 20_001;
    const utcEpochMs = Number.MAX_SAFE_INTEGER - 20_000;
    const ready = prepareCountdownRound(
      createFixtureMatch({
        clockAnchor: { monoMs, utcEpochMs },
      }),
    );
    const projected = projectSnapshot(
      ready.state,
      ready.state.participants[0].playerId,
    );
    expect(projected.ok).toBe(true);
    if (!projected.ok || projected.snapshot.phase !== 'COUNTDOWN')
      throw new Error('Expected countdown');
    expect(projected.snapshot.round.schedule.deadlineAt).toBe(
      Number.MAX_SAFE_INTEGER - 7_500,
    );
    const disconnected = applyCommand(
      ready.state,
      {
        type: 'player.disconnect',
        playerId: ready.state.participants[0].playerId,
      },
      receiptAt(ready.state, monoMs),
    );
    verify(disconnected);
    expect(disconnected.error).toBeNull();
    expect(disconnected.state.participants[0].graceDeadlineMonoMs).toBe(
      monoMs + 10_000,
    );
  });

  it('source failure aborts with preserved scores and no award', () => {
    let state = finishRound(createFixtureMatch(), 0);
    const result = applyCommand(
      state,
      { type: 'source.unavailable' },
      receiptAt(state, state.lastInput.atMonoMs),
    );
    state = verify(result);
    expect(state.phase).toBe('ABORTED');
    expect(state.completion).toBeNull();
    expect(state.participants[0].score).toBe(1);
    expect(result.batches[0]?.events[0]?.type).toBe('match.interrupted');
  });
});
