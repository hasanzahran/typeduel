import { describe, expect, it } from 'vitest';
import {
  AnswerAckSchema,
  MatchSnapshotSchema,
  TransitionBatchSchema,
  type AnswerAck,
} from '@typeduel/contracts';
import { applyCommand } from '../../src/game/engine.js';
import { projectSnapshot } from '../../src/game/snapshot.js';
import {
  createFixtureMatch,
  createRoundDescriptor,
  fixtureId,
  prepareReadyRound,
  receiptAt,
  submit,
  tickAt,
} from './fixtures.js';

type State = ReturnType<typeof createFixtureMatch>;
const players = [fixtureId(1), fixtureId(2)] as const;
const makeMatch = (matchId = fixtureId(900)) =>
  createFixtureMatch({ matchId, participants: [...players] });

const gameplayState = (state: State) => ({ ...state, lastInput: null });

function snapshot(state: State, playerId: string) {
  const projected = projectSnapshot(state, playerId);
  expect(projected.ok).toBe(true);
  if (!projected.ok) throw new Error('Expected an authorized snapshot');
  return MatchSnapshotSchema.parse(projected.snapshot);
}

function publicState(state: State) {
  return players.map((playerId) => snapshot(state, playerId));
}

function activeRound(state = makeMatch()) {
  const prepared = prepareReadyRound(state);
  const active = tickAt(prepared.state, prepared.monoSchedule.typingStartAt);
  return { ...prepared, state: active.state };
}

describe('independent adversarial game traces', () => {
  it('rejects old-round readiness after the next preparation and schedules only fresh acknowledgements', () => {
    const first = activeRound();
    const closed = submit(first.state, players[0], {
      attemptId: fixtureId(33_000),
      text: first.descriptor.canonicalText,
      atMonoMs: first.monoSchedule.typingStartAt,
    });
    const descriptor = createRoundDescriptor(closed.state);
    const prepared = applyCommand(
      closed.state,
      { type: 'round.prepare', descriptor },
      receiptAt(closed.state, closed.state.lastInput.atMonoMs),
    );
    expect(prepared.error).toBeNull();
    expect(prepared.state.phase).toBe('PREPARING_ROUND');
    const stale = applyCommand(
      prepared.state,
      {
        type: 'round.audio_ready',
        playerId: players[0],
        payload: {
          matchId: prepared.state.matchId,
          roundId: first.descriptor.roundId,
          audioVersion: first.descriptor.audio.audioVersion,
        },
      },
      receiptAt(prepared.state, prepared.state.lastInput.atMonoMs),
    );
    expect(stale.error?.code).toBe('UNKNOWN_ROUND');
    expect(stale.batches).toEqual([]);
    expect(gameplayState(stale.state)).toEqual(gameplayState(prepared.state));
    expect(stale.state.participants.map((p) => p.ready)).toEqual([
      false,
      false,
    ]);
    expect(stale.state.round?.monoSchedule).toBeNull();

    let state = stale.state;
    const starts = [];
    for (const playerId of players) {
      const ready = applyCommand(
        state,
        {
          type: 'round.audio_ready',
          playerId,
          payload: {
            matchId: state.matchId,
            roundId: descriptor.roundId,
            audioVersion: descriptor.audio.audioVersion,
          },
        },
        receiptAt(state, state.lastInput.atMonoMs),
      );
      expect(ready.error).toBeNull();
      starts.push(...ready.batches.flatMap((batch) => batch.events));
      state = ready.state;
      if (playerId === players[0]) {
        expect(state.phase).toBe('PREPARING_ROUND');
        expect(state.round?.monoSchedule).toBeNull();
      }
    }
    expect(starts.map((event) => event.type)).toEqual(['round.start']);
    expect(state.phase).toBe('COUNTDOWN');
    expect(state.round?.monoSchedule).not.toBeNull();
    const scheduled = gameplayState(state);
    for (const playerId of players) {
      const duplicate = applyCommand(
        state,
        {
          type: 'round.audio_ready',
          playerId,
          payload: {
            matchId: state.matchId,
            roundId: descriptor.roundId,
            audioVersion: descriptor.audio.audioVersion,
          },
        },
        receiptAt(state, state.lastInput.atMonoMs),
      );
      expect(duplicate.error).toBeNull();
      expect(duplicate.batches).toEqual([]);
      expect(gameplayState(duplicate.state)).toEqual(scheduled);
      state = duplicate.state;
    }
  });

  it('retains all 48 counted outcomes through an eight-round draw and terminal retries', () => {
    let state = makeMatch();
    const history: { playerId: string; text: string; ack: AnswerAck }[] = [];
    let terminalAt = 0;
    for (let round = 1; round <= 8; round += 1) {
      const active = activeRound(state);
      state = active.state;
      for (const [playerIndex, playerId] of players.entries()) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const text = 'qa-wrong-no-match';
          const answer = submit(state, playerId, {
            attemptId: fixtureId(
              10_000 + round * 10 + playerIndex * 3 + attempt,
            ),
            text,
            atMonoMs: active.monoSchedule.typingStartAt,
          });
          const ack = AnswerAckSchema.parse(answer.ack);
          expect(ack.status).toBe('INCORRECT');
          expect(ack.attemptsRemaining).toBe(2 - attempt);
          history.push({ playerId, text, ack });
          state = answer.state;
        }
      }
      expect(snapshot(state, players[0]).phase).toBe('ACTIVE_TYPING');
      expect(
        snapshot(state, players[0]).participants.map((p) => p.score),
      ).toEqual([0, 0]);
      const expiry = tickAt(state, active.monoSchedule.deadlineAt);
      state = expiry.state;
      terminalAt = active.monoSchedule.deadlineAt;
      expect(snapshot(state, players[0]).phase).toBe(
        round === 8 ? 'COMPLETED' : 'ROUND_RESULT',
      );
    }
    const terminal = publicState(state);
    const terminalGameplay = gameplayState(state);
    expect(history).toHaveLength(48);
    expect(state.countedAttempts).toHaveLength(48);
    for (const viewer of terminal)
      expect(viewer.viewer.countedAttempts).toHaveLength(24);
    const final = terminal[0];
    expect(final?.phase).toBe('COMPLETED');
    if (final?.phase !== 'COMPLETED')
      throw new Error('Expected completed draw');
    expect(final.completion).toMatchObject({
      draw: true,
      winnerId: null,
      roundCount: 8,
    });

    for (const entry of history) {
      const retry = submit(state, entry.playerId, {
        attemptId: entry.ack.attemptId,
        roundId: entry.ack.roundId,
        text: entry.text,
        atMonoMs: terminalAt,
      });
      expect(retry.ack).toEqual(entry.ack);
      expect(retry.batches).toEqual([]);
      expect(retry.error).toBeNull();
      expect(publicState(retry.state)).toEqual(terminal);
      expect(gameplayState(retry.state)).toEqual(terminalGameplay);
      state = retry.state;
    }
    for (const entry of history) {
      const conflict = submit(state, entry.playerId, {
        attemptId: entry.ack.attemptId,
        roundId: entry.ack.roundId,
        text: `${entry.text} `,
        atMonoMs: terminalAt,
      });
      expect(conflict.ack?.status).toBe('IDEMPOTENCY_CONFLICT');
      expect(conflict.batches).toEqual([]);
      expect(publicState(conflict.state)).toEqual(terminal);
      expect(gameplayState(conflict.state)).toEqual(terminalGameplay);
      state = conflict.state;
    }
  });

  it('keeps matching round and attempt IDs isolated across interleaved matches', () => {
    const first = activeRound(makeMatch(fixtureId(901)));
    const secondPrepared = prepareReadyRound(makeMatch(fixtureId(902)), {
      descriptor: { ...first.descriptor },
    });
    const second = {
      ...secondPrepared,
      state: tickAt(
        secondPrepared.state,
        secondPrepared.monoSchedule.typingStartAt,
      ).state,
    };
    const attemptId = fixtureId(903);
    const a = submit(first.state, players[0], {
      attemptId,
      text: 'first-wrong',
      atMonoMs: first.monoSchedule.typingStartAt,
    });
    const b = submit(second.state, players[0], {
      attemptId,
      text: 'second-wrong',
      atMonoMs: second.monoSchedule.typingStartAt,
    });
    expect(a.ack?.status).toBe('INCORRECT');
    expect(b.ack?.status).toBe('INCORRECT');
    const foreign = applyCommand(
      a.state,
      {
        type: 'answer.submit',
        playerId: players[0],
        payload: {
          matchId: fixtureId(902),
          roundId: first.descriptor.roundId,
          attemptId,
          text: 'second-wrong',
        },
      },
      receiptAt(a.state, first.monoSchedule.typingStartAt),
    );
    expect(foreign.ack?.status).toBe('WRONG_MATCH');
    expect(publicState(foreign.state)).toEqual(publicState(a.state));
    for (const [result, text, time] of [
      [a, 'first-wrong', first.monoSchedule.typingStartAt],
      [b, 'second-wrong', second.monoSchedule.typingStartAt],
    ] as const) {
      const retry = submit(result.state, players[0], {
        attemptId,
        text,
        atMonoMs: time,
      });
      expect(retry.ack).toEqual(result.ack);
      expect(retry.batches).toEqual([]);
      expect(publicState(retry.state)).toEqual(publicState(result.state));
    }
  });

  it('leaves early rejected IDs unreserved, then compares counted payloads before normalization', () => {
    const prepared = prepareReadyRound(makeMatch());
    const attemptId = fixtureId(910);
    const early = submit(prepared.state, players[0], {
      attemptId,
      text: 'early-text',
      atMonoMs: prepared.monoSchedule.typingStartAt - 1,
    });
    expect(early.ack?.status).toBe('NOT_TYPING');
    expect(snapshot(early.state, players[0]).viewer.countedAttempts).toEqual(
      [],
    );
    const counted = submit(early.state, players[0], {
      attemptId,
      text: ' Counted-Wrong ',
      atMonoMs: prepared.monoSchedule.typingStartAt,
    });
    expect(counted.ack?.status).toBe('INCORRECT');
    const conflict = submit(counted.state, players[0], {
      attemptId,
      text: 'counted-wrong',
      atMonoMs: prepared.monoSchedule.typingStartAt,
    });
    expect(conflict.ack?.status).toBe('IDEMPOTENCY_CONFLICT');
    expect(publicState(conflict.state)).toEqual(publicState(counted.state));
    const retry = submit(conflict.state, players[0], {
      attemptId,
      text: ' Counted-Wrong ',
      atMonoMs: prepared.monoSchedule.typingStartAt,
    });
    expect(retry.ack).toEqual(counted.ack);
    expect(counted.ack?.stateVersion).toBeGreaterThan(
      early.ack?.stateVersion ?? -1,
    );
    expect(snapshot(retry.state, players[0]).viewer.countedAttempts).toEqual([
      counted.ack,
    ]);
  });

  it('does not grow counted history or consume attempts during a rejection flood', () => {
    const prepared = prepareReadyRound(makeMatch());
    let state = prepared.state;
    for (let index = 0; index < 128; index += 1) {
      const rejected = submit(state, players[0], {
        attemptId: fixtureId(20_000 + index),
        text: 'rejected',
        atMonoMs: prepared.monoSchedule.playbackAt - 1,
      });
      expect(rejected.ack?.status).toBe('NOT_TYPING');
      state = rejected.state;
    }
    expect(snapshot(state, players[0]).viewer).toMatchObject({
      attemptsRemaining: 3,
      countedAttempts: [],
    });
    expect(state.countedAttempts).toEqual([]);
    const counted = submit(state, players[0], {
      attemptId: fixtureId(20_000),
      text: 'now-valid-wrong',
      atMonoMs: prepared.monoSchedule.typingStartAt,
    });
    expect(counted.ack?.status).toBe('INCORRECT');
  });

  it.each([players, [players[1], players[0]] as const])(
    'awards equal-time correct answers to the first ordered participant %s',
    (first, second) => {
      const active = activeRound();
      const winner = submit(active.state, first, {
        attemptId: fixtureId(930),
        text: active.descriptor.canonicalText,
        atMonoMs: active.monoSchedule.typingStartAt,
      });
      const loser = submit(winner.state, second, {
        attemptId: fixtureId(931),
        text: active.descriptor.canonicalText,
        atMonoMs: active.monoSchedule.typingStartAt,
      });
      expect(winner.ack?.status).toBe('CORRECT');
      expect(loser.ack?.status).toBe('ROUND_CLOSED');
      expect(loser.batches).toEqual([]);
      const view = snapshot(loser.state, first);
      expect(view.participants.reduce((sum, p) => sum + p.score, 0)).toBe(1);
      if (view.phase !== 'ROUND_RESULT')
        throw new Error('Expected a closed round');
      expect(view.result.winnerId).toBe(first);
    },
  );

  it('uses receipt boundaries and rejects inputs older than a processed timer watermark', () => {
    const active = activeRound();
    const timely = submit(active.state, players[0], {
      attemptId: fixtureId(940),
      text: active.descriptor.canonicalText,
      atMonoMs: active.monoSchedule.deadlineAt - 1,
    });
    expect(timely.ack?.status).toBe('CORRECT');
    const delayedWake = tickAt(
      timely.state,
      active.monoSchedule.deadlineAt + 100,
    );
    expect(delayedWake.batches).toEqual([]);
    const late = submit(active.state, players[0], {
      attemptId: fixtureId(941),
      text: active.descriptor.canonicalText,
      atMonoMs: active.monoSchedule.deadlineAt,
    });
    expect(late.ack?.status).toBe('ROUND_CLOSED');
    expect(
      snapshot(late.state, players[0]).participants.map((p) => p.score),
    ).toEqual([0, 0]);
    const backwards = submit(late.state, players[0], {
      attemptId: fixtureId(942),
      text: active.descriptor.canonicalText,
      atMonoMs: active.monoSchedule.deadlineAt - 1,
    });
    expect(backwards.error).not.toBeNull();
    expect(backwards.batches).toEqual([]);
    expect(publicState(backwards.state)).toEqual(publicState(late.state));
  });

  it('returns historical acknowledgements while still draining a due deadline exactly once', () => {
    const active = activeRound();
    const counted = submit(active.state, players[0], {
      attemptId: fixtureId(950),
      text: 'wrong',
      atMonoMs: active.monoSchedule.typingStartAt,
    });
    const retry = submit(counted.state, players[0], {
      attemptId: fixtureId(950),
      text: 'wrong',
      atMonoMs: active.monoSchedule.deadlineAt,
    });
    expect(retry.ack).toEqual(counted.ack);
    expect(
      retry.batches.flatMap((batch) => batch.events).map((event) => event.type),
    ).toEqual(['round.result']);
    const repeated = submit(retry.state, players[0], {
      attemptId: fixtureId(950),
      text: 'wrong',
      atMonoMs: active.monoSchedule.deadlineAt,
    });
    expect(repeated.ack).toEqual(counted.ack);
    expect(repeated.batches).toEqual([]);
    expect(publicState(repeated.state)).toEqual(publicState(retry.state));
  });

  it.each([-1, 0, 1])(
    'orders a delayed final-round wake when grace minus deadline is %i ms',
    (offset) => {
      let state = makeMatch();
      for (let round = 1; round <= 4; round += 1) {
        const active = activeRound(state);
        state = submit(active.state, players[0], {
          attemptId: fixtureId(30_000 + round),
          text: active.descriptor.canonicalText,
          atMonoMs: active.monoSchedule.typingStartAt,
        }).state;
      }
      const fifth = prepareReadyRound(state);
      const disconnected = applyCommand(
        fifth.state,
        { type: 'player.disconnect', playerId: players[1] },
        receiptAt(fifth.state, fifth.monoSchedule.deadlineAt - 10_000 + offset),
      );
      expect(disconnected.error).toBeNull();
      const delayed = tickAt(
        disconnected.state,
        fifth.monoSchedule.deadlineAt + 500,
      );
      const view = snapshot(delayed.state, players[0]);
      expect(view.participants.map((p) => p.score)).toEqual([4, 0]);
      expect(view.phase).toBe(offset > 0 ? 'COMPLETED' : 'ABORTED');
      const types = delayed.batches
        .flatMap((batch) => batch.events)
        .map((event) => event.type);
      expect(types).toEqual(
        offset > 0 ? ['round.result', 'match.complete'] : ['match.interrupted'],
      );
      if (view.phase === 'ABORTED') {
        expect(view.interruption.reason).toBe('DISCONNECT_TIMEOUT');
        expect(delayed.state.completion).toBeNull();
      }
      const repeated = tickAt(
        delayed.state,
        fifth.monoSchedule.deadlineAt + 501,
      );
      expect(repeated.batches).toEqual([]);
      expect(gameplayState(repeated.state)).toEqual(
        gameplayState(delayed.state),
      );
    },
  );

  it('does not extend grace on duplicate disconnect and distinguishes 9999 ms from 10000 ms', () => {
    const active = activeRound();
    const disconnectedAt = active.monoSchedule.typingStartAt;
    const disconnected = applyCommand(
      active.state,
      { type: 'player.disconnect', playerId: players[1] },
      receiptAt(active.state, disconnectedAt),
    );
    const duplicated = applyCommand(
      disconnected.state,
      { type: 'player.disconnect', playerId: players[1] },
      receiptAt(disconnected.state, disconnectedAt + 100),
    );
    expect(duplicated.batches).toEqual([]);
    expect(duplicated.state.participants[1].graceDeadlineMonoMs).toBe(
      disconnectedAt + 10_000,
    );
    const rejoined = applyCommand(
      duplicated.state,
      { type: 'player.reconnect', playerId: players[1] },
      receiptAt(duplicated.state, disconnectedAt + 9_999),
    );
    expect(rejoined.state.phase).toBe('ROUND_RESULT');
    expect(rejoined.state.participants[1].connected).toBe(true);
    const expired = applyCommand(
      duplicated.state,
      { type: 'player.reconnect', playerId: players[1] },
      receiptAt(duplicated.state, disconnectedAt + 10_000),
    );
    expect(expired.state.phase).toBe('ABORTED');
    expect(expired.state.completion).toBeNull();
    const revived = applyCommand(
      expired.state,
      { type: 'player.reconnect', playerId: players[1] },
      receiptAt(expired.state, disconnectedAt + 10_001),
    );
    expect(revived.batches).toEqual([]);
    expect(gameplayState(revived.state)).toEqual(gameplayState(expired.state));
  });

  it('rejects replayed ingress sequences before applying any action', () => {
    const active = activeRound();
    const context = receiptAt(active.state, active.monoSchedule.typingStartAt);
    const command = {
      type: 'answer.submit',
      playerId: players[0],
      payload: {
        matchId: active.state.matchId,
        roundId: active.descriptor.roundId,
        attemptId: fixtureId(32_000),
        text: 'wrong',
      },
    } as const;
    const counted = applyCommand(active.state, command, context);
    expect(counted.ack?.status).toBe('INCORRECT');
    const replayed = applyCommand(counted.state, command, context);
    expect(replayed.error?.code).toBe('OUT_OF_ORDER');
    expect(replayed.batches).toEqual([]);
    expect(replayed.state).toEqual(counted.state);
  });

  it.each([false, true])(
    'expires the earliest unresolved grace with two offline players (first reconnects: %s)',
    (reconnectFirst) => {
      const active = activeRound();
      const at = active.monoSchedule.typingStartAt;
      const first = applyCommand(
        active.state,
        { type: 'player.disconnect', playerId: players[0] },
        receiptAt(active.state, at),
      );
      const second = applyCommand(
        first.state,
        { type: 'player.disconnect', playerId: players[1] },
        receiptAt(first.state, at + 200),
      );
      let state = second.state;
      if (reconnectFirst) {
        state = applyCommand(
          state,
          { type: 'player.reconnect', playerId: players[0] },
          receiptAt(state, at + 9_999),
        ).state;
        const clearedBoundary = tickAt(state, at + 10_000);
        expect(clearedBoundary.state.phase).toBe('ROUND_RESULT');
        expect(clearedBoundary.batches).toEqual([]);
        state = clearedBoundary.state;
      }
      const expired = tickAt(state, at + (reconnectFirst ? 10_200 : 10_000));
      expect(expired.state.phase).toBe('ABORTED');
      expect(expired.state.participants.map((p) => p.score)).toEqual([0, 0]);
      expect(expired.state.completion).toBeNull();
    },
  );

  it('keeps completion atomic and cannot be changed by late grace or gameplay commands', () => {
    let state = makeMatch();
    for (let round = 1; round <= 4; round += 1) {
      const active = activeRound(state);
      state = submit(active.state, players[0], {
        attemptId: fixtureId(960 + round),
        text: active.descriptor.canonicalText,
        atMonoMs: active.monoSchedule.typingStartAt,
      }).state;
    }
    const fifth = activeRound(state);
    const disconnected = applyCommand(
      fifth.state,
      { type: 'player.disconnect', playerId: players[1] },
      receiptAt(fifth.state, fifth.monoSchedule.typingStartAt),
    );
    const won = submit(disconnected.state, players[0], {
      attemptId: fixtureId(970),
      text: fifth.descriptor.canonicalText,
      atMonoMs: fifth.monoSchedule.typingStartAt + 1,
    });
    expect(won.batches).toHaveLength(1);
    expect(won.batches[0]?.events.map((event) => event.type)).toEqual([
      'round.result',
      'match.complete',
    ]);
    for (const batch of won.batches) TransitionBatchSchema.parse(batch);
    const terminal = publicState(won.state);
    let terminalState = tickAt(
      won.state,
      fifth.monoSchedule.typingStartAt + 10_000,
    ).state;
    expect(publicState(terminalState)).toEqual(terminal);
    const commands = [
      { type: 'source.unavailable' } as const,
      { type: 'player.reconnect', playerId: players[1] } as const,
      { type: 'player.disconnect', playerId: players[0] } as const,
      {
        type: 'round.prepare',
        descriptor: createRoundDescriptor(terminalState),
      } as const,
      {
        type: 'round.audio_ready',
        playerId: players[0],
        payload: {
          matchId: terminalState.matchId,
          roundId: fifth.descriptor.roundId,
          audioVersion: fifth.descriptor.audio.audioVersion,
        },
      } as const,
      {
        type: 'round.replay_used',
        playerId: players[0],
        payload: {
          matchId: terminalState.matchId,
          roundId: fifth.descriptor.roundId,
          replaySequence: 1,
        },
      } as const,
      {
        type: 'answer.submit',
        playerId: players[0],
        payload: {
          matchId: terminalState.matchId,
          roundId: fifth.descriptor.roundId,
          attemptId: fixtureId(971),
          text: fifth.descriptor.canonicalText,
        },
      } as const,
    ];
    for (const command of commands) {
      const result = applyCommand(
        terminalState,
        command,
        receiptAt(terminalState, fifth.monoSchedule.typingStartAt + 10_000),
      );
      expect(result.batches).toEqual([]);
      expect(publicState(result.state)).toEqual(terminal);
      terminalState = result.state;
    }
  });
});
