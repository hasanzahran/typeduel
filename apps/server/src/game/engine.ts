import { z } from 'zod';
import {
  AnswerSubmitSchema,
  AudioDescriptorSchema,
  AudioReadySchema,
  AudioCompletedSchema,
  AudioFailedSchema,
  CategorySchema,
  DifficultySchema,
  MatchSetupSchema,
  MAX_ANSWER_LENGTH,
  ReplayUsedSchema,
  type AnswerAck,
  type GameplayEvent,
  type PreparedRound,
  type Scores,
} from '@typeduel/contracts';
import {
  completionFor,
  DEFAULT_RULES,
  engineError,
  fingerprintText,
  INITIAL_COUNTDOWN_MS,
  isSafeTime,
  nextLevel,
  normalizeAnswer,
  RECONNECT_GRACE_MS,
  PREFLIGHT_TIMEOUT_MS,
  safeAdd,
  toUtc,
} from './rules.js';
import type {
  CreateMatchOptions,
  GameCommand,
  MatchState,
  PrivateParticipant,
  ReceiptContext,
  RuleConfig,
  TickContext,
  TransitionResult,
} from './types.js';

const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive = time.refine((n) => n > 0);
const text = z
  .string()
  .min(1)
  .max(MAX_ANSWER_LENGTH)
  .refine((s) => s.trim().length > 0 && s.length <= MAX_ANSWER_LENGTH);
const descriptorSchema = z.strictObject({
  roundId: z.uuid(),
  wordId: z.uuid(),
  canonicalText: text,
  acceptedVariants: z.array(text),
  level: DifficultySchema,
  categorySlugs: z.array(CategorySchema),
  audio: AudioDescriptorSchema,
});
const configSchema = z.strictObject({
  laterCountdownMs: time,
  playbackMarginMs: time,
  typingDurationMsByLevel: z.strictObject({
    1: positive,
    2: positive,
    3: positive,
    4: positive,
    5: positive,
  }),
});
const createSchema = z
  .strictObject({
    matchId: z.uuid(),
    participants: z.tuple([z.uuid(), z.uuid()]),
    setup: MatchSetupSchema,
    clockAnchor: z.strictObject({ monoMs: time, utcEpochMs: time }),
    config: configSchema.partial().optional(),
  })
  .refine((v) => v.participants[0] !== v.participants[1]);

export function createMatch(options: CreateMatchOptions): MatchState {
  const parsed = createSchema.safeParse(options);
  if (!parsed.success) throw new Error('Invalid match configuration');
  const configResult = configSchema.safeParse({
    ...DEFAULT_RULES,
    ...parsed.data.config,
  });
  if (!configResult.success) throw new Error('Invalid match configuration');
  const { matchId, setup, participants, clockAnchor } = parsed.data;
  const participant = (playerId: string): PrivateParticipant => ({
    playerId,
    score: 0,
    connected: true,
    graceDeadlineMonoMs: null,
    ready: false,
    initialPlaybackCompleted: false,
    attemptsUsed: 0,
    replaySequences: [],
  });
  return {
    matchId,
    setup,
    clockAnchor,
    config: configResult.data as RuleConfig,
    phase: 'PREPARING_ROUND',
    participants: [participant(participants[0]), participant(participants[1])],
    currentLevel: setup.mode === 'classic' ? setup.difficulty : 1,
    roundNumber: 0,
    round: null,
    lastResult: null,
    completion: null,
    interruption: null,
    usedRoundIds: [],
    usedWordIds: [],
    countedAttempts: [],
    stateVersion: 0,
    lastInput: { atMonoMs: clockAnchor.monoMs, ingressSequence: 0 },
  };
}

const terminal = (state: MatchState) =>
  state.phase === 'COMPLETED' || state.phase === 'ABORTED';
const scores = (state: MatchState): Scores => [
  {
    playerId: state.participants[0].playerId,
    score: state.participants[0].score,
  },
  {
    playerId: state.participants[1].playerId,
    score: state.participants[1].score,
  },
];
function prepared(state: MatchState): PreparedRound {
  if (!state.round) throw new Error('Round unavailable');
  const { roundId, roundNumber, level, audio } = state.round;
  return { roundId, roundNumber, level, audio: structuredClone(audio) };
}
function commit(result: TransitionResult, events: GameplayEvent[] = []): void {
  result.state.stateVersion += 1;
  result.batches.push({
    stateVersion: result.state.stateVersion,
    events: structuredClone(events),
  });
}
function closeRound(result: TransitionResult, winnerId: string | null): void {
  const state = result.state;
  if (!state.round) throw new Error('Round unavailable');
  const winner = state.participants.find((p) => p.playerId === winnerId);
  if (winner) winner.score += 1;
  state.currentLevel = nextLevel(
    state.setup,
    state.round.level,
    winnerId !== null,
  );
  state.lastResult = {
    roundId: state.round.roundId,
    roundNumber: state.roundNumber,
    level: state.round.level,
    nextLevel: state.currentLevel,
    correctWord: state.round.canonicalText,
    winnerId,
    scores: scores(state),
  };
  state.completion = completionFor(state.roundNumber, scores(state));
  state.phase = state.completion ? 'COMPLETED' : 'ROUND_RESULT';
  const events: GameplayEvent[] = [
    { type: 'round.result', matchId: state.matchId, payload: state.lastResult },
  ];
  if (state.completion)
    events.push({
      type: 'match.complete',
      matchId: state.matchId,
      payload: state.completion,
    });
  commit(result, events);
}
function abort(
  result: TransitionResult,
  reason: 'DISCONNECT_TIMEOUT' | 'SOURCE_UNAVAILABLE' | 'AUDIO_UNAVAILABLE',
): void {
  result.state.phase = 'ABORTED';
  result.state.interruption = { reason };
  commit(result, [
    {
      type: 'match.interrupted',
      matchId: result.state.matchId,
      payload: { reason },
    },
  ]);
}

// Recovery only: a new process must never run elapsed old-process timers.
export function interruptForServerRestart(state: MatchState): TransitionResult {
  const result: TransitionResult = {
    state: structuredClone(state),
    batches: [],
    ack: null,
    error: null,
  };
  if (terminal(state)) return result;
  result.state.phase = 'ABORTED';
  result.state.interruption = { reason: 'SERVER_RESTART' };
  commit(result, [
    {
      type: 'match.interrupted',
      matchId: state.matchId,
      payload: { reason: 'SERVER_RESTART' },
    },
  ]);
  return result;
}

export function getNextWakeAt(state: MatchState): number | null {
  if (terminal(state)) return null;
  const due = state.participants.flatMap((p) =>
    p.graceDeadlineMonoMs === null ? [] : [p.graceDeadlineMonoMs],
  );
  if (
    state.phase === 'PREPARING_ROUND' &&
    state.round?.preflightDeadlineMonoMs != null
  )
    due.push(state.round.preflightDeadlineMonoMs);
  const schedule = state.round?.monoSchedule;
  if (schedule) {
    if (state.phase === 'COUNTDOWN') due.push(schedule.playbackAt);
    if (state.phase === 'PLAYING_WORD') due.push(schedule.typingStartAt);
    if (state.phase === 'ACTIVE_TYPING') due.push(schedule.deadlineAt);
  }
  return due.length ? Math.min(...due) : null;
}
function drainDue(result: TransitionResult, throughMonoMs: number): void {
  for (;;) {
    const at = getNextWakeAt(result.state);
    if (at === null || at > throughMonoMs) return;
    const state = result.state;
    // The earliest unresolved grace wins every equal-time collision.
    if (state.participants.some((p) => p.graceDeadlineMonoMs === at)) {
      abort(result, 'DISCONNECT_TIMEOUT');
    } else if (state.phase === 'PREPARING_ROUND') {
      abort(result, 'AUDIO_UNAVAILABLE');
    } else if (state.phase === 'COUNTDOWN') {
      state.phase = 'PLAYING_WORD';
      commit(result);
    } else if (state.phase === 'PLAYING_WORD') {
      if (!state.participants.every((p) => p.initialPlaybackCompleted))
        abort(result, 'AUDIO_UNAVAILABLE');
      else {
        state.phase = 'ACTIVE_TYPING';
        commit(result);
      }
    } else if (state.phase === 'ACTIVE_TYPING') {
      closeRound(result, null);
    }
  }
}
function begin(
  state: MatchState,
  atMonoMs: number,
  ingressSequence: number,
): TransitionResult {
  const result: TransitionResult = {
    state,
    batches: [],
    ack: null,
    error: null,
  };
  if (!isSafeTime(atMonoMs) || !isSafeTime(ingressSequence)) {
    result.error = engineError('INVALID_TIME');
    return result;
  }
  if (
    atMonoMs < state.lastInput.atMonoMs ||
    ingressSequence <= state.lastInput.ingressSequence
  ) {
    result.error = engineError('OUT_OF_ORDER');
    return result;
  }
  // Check UTC representability before accepting this input's ordering watermark.
  if (
    !isSafeTime(
      state.clockAnchor.utcEpochMs + (atMonoMs - state.clockAnchor.monoMs),
    )
  ) {
    result.error = engineError('TIME_OVERFLOW');
    return result;
  }
  result.state = structuredClone(state);
  drainDue(result, atMonoMs);
  result.state.lastInput = { atMonoMs, ingressSequence };
  return result;
}
export function advanceTime(
  state: MatchState,
  context: TickContext,
): TransitionResult {
  return begin(state, context.nowMonoMs, context.ingressSequence);
}
function rejectAnswer(
  result: TransitionResult,
  payload: { matchId: string; roundId: string; attemptId: string },
  status: Exclude<AnswerAck['status'], 'CORRECT' | 'INCORRECT'>,
  participant?: PrivateParticipant,
): void {
  result.ack = {
    matchId: payload.matchId,
    roundId: payload.roundId,
    attemptId: payload.attemptId,
    stateVersion: result.state.stateVersion,
    status,
    attemptsRemaining:
      participant && result.state.round?.roundId === payload.roundId
        ? 3 - participant.attemptsUsed
        : null,
  };
}
function answer(
  result: TransitionResult,
  playerId: string,
  input: unknown,
): void {
  const parsed = AnswerSubmitSchema.safeParse(input);
  if (!parsed.success) {
    const identity = AnswerSubmitSchema.pick({
      matchId: true,
      roundId: true,
      attemptId: true,
    }).safeParse(
      typeof input === 'object' && input !== null
        ? {
            matchId: Reflect.get(input, 'matchId'),
            roundId: Reflect.get(input, 'roundId'),
            attemptId: Reflect.get(input, 'attemptId'),
          }
        : null,
    );
    if (identity.success)
      rejectAnswer(result, identity.data, 'INVALID_COMMAND');
    else result.error = engineError('INVALID_COMMAND');
    return;
  }
  const payload = parsed.data;
  const state = result.state;
  const participant = state.participants.find((p) => p.playerId === playerId);
  if (!participant) {
    rejectAnswer(result, payload, 'UNAUTHORIZED');
    return;
  }
  if (payload.matchId !== state.matchId) {
    rejectAnswer(result, payload, 'WRONG_MATCH');
    return;
  }
  const previous = state.countedAttempts.find(
    (a) =>
      a.playerId === playerId &&
      a.ack.roundId === payload.roundId &&
      a.ack.attemptId === payload.attemptId,
  );
  const fingerprint = fingerprintText(payload.text);
  if (previous) {
    if (previous.fingerprint === fingerprint)
      result.ack = structuredClone(previous.ack);
    else rejectAnswer(result, payload, 'IDEMPOTENCY_CONFLICT', participant);
    return;
  }
  if (!state.usedRoundIds.includes(payload.roundId)) {
    rejectAnswer(result, payload, 'UNKNOWN_ROUND');
    return;
  }
  if (terminal(state)) {
    rejectAnswer(result, payload, 'MATCH_TERMINAL', participant);
    return;
  }
  if (
    payload.roundId !== state.round?.roundId ||
    state.phase === 'ROUND_RESULT'
  ) {
    rejectAnswer(result, payload, 'ROUND_CLOSED', participant);
    return;
  }
  if (!participant.connected) {
    rejectAnswer(result, payload, 'DISCONNECTED', participant);
    return;
  }
  if (state.phase !== 'ACTIVE_TYPING') {
    rejectAnswer(result, payload, 'NOT_TYPING', participant);
    return;
  }
  if (participant.attemptsUsed === 3) {
    rejectAnswer(result, payload, 'EXHAUSTED', participant);
    return;
  }
  const normalized = normalizeAnswer(payload.text);
  const correct = [
    state.round.canonicalText,
    ...state.round.acceptedVariants,
  ].some((v) => normalizeAnswer(v) === normalized);
  participant.attemptsUsed += 1;
  if (correct) closeRound(result, playerId);
  else commit(result);
  const ack = {
    matchId: state.matchId,
    roundId: payload.roundId,
    attemptId: payload.attemptId,
    stateVersion: state.stateVersion,
    status: correct ? ('CORRECT' as const) : ('INCORRECT' as const),
    attemptsRemaining: 3 - participant.attemptsUsed,
  };
  state.countedAttempts.push({
    playerId,
    fingerprint,
    ack: structuredClone(ack),
  });
  result.ack = ack;
}

export function applyCommand(
  state: MatchState,
  command: GameCommand,
  context: ReceiptContext,
): TransitionResult {
  const result = begin(
    state,
    context.receivedAtMonoMs,
    context.ingressSequence,
  );
  if (result.error) return result;
  state = result.state;
  if (command.type === 'answer.submit') {
    answer(result, command.playerId, command.payload);
    return result;
  }
  if (terminal(state)) {
    result.error = engineError('MATCH_TERMINAL');
    return result;
  }
  if (command.type === 'source.unavailable') {
    abort(result, 'SOURCE_UNAVAILABLE');
    return result;
  }
  if (command.type === 'round.prepare') {
    if (
      state.phase !== 'ROUND_RESULT' &&
      !(state.phase === 'PREPARING_ROUND' && state.round === null)
    ) {
      result.error = engineError('INVALID_PHASE');
      return result;
    }
    const parsed = descriptorSchema.safeParse(command.descriptor);
    if (
      !parsed.success ||
      parsed.data.level !== state.currentLevel ||
      (state.setup.categorySlug !== 'general' &&
        !parsed.data.categorySlugs.includes(state.setup.categorySlug)) ||
      state.usedWordIds.includes(parsed.data.wordId) ||
      state.usedRoundIds.includes(parsed.data.roundId) ||
      state.roundNumber >= 8
    ) {
      result.error = engineError('INVALID_DESCRIPTOR');
      return result;
    }
    const preflightDeadlineMonoMs = safeAdd(
      context.receivedAtMonoMs,
      PREFLIGHT_TIMEOUT_MS,
    );
    if (
      preflightDeadlineMonoMs === null ||
      !isSafeTime(
        state.clockAnchor.utcEpochMs +
          (preflightDeadlineMonoMs - state.clockAnchor.monoMs),
      )
    ) {
      result.error = engineError('TIME_OVERFLOW');
      return result;
    }
    state.roundNumber += 1;
    state.round = {
      ...parsed.data,
      roundNumber: state.roundNumber,
      monoSchedule: null,
      preflightDeadlineMonoMs,
    };
    state.usedWordIds.push(parsed.data.wordId);
    state.usedRoundIds.push(parsed.data.roundId);
    state.phase = 'PREPARING_ROUND';
    for (const p of state.participants) {
      p.ready = false;
      p.initialPlaybackCompleted = false;
      p.attemptsUsed = 0;
      p.replaySequences = [];
    }
    commit(result, [
      {
        type: 'round.prepare',
        matchId: state.matchId,
        payload: prepared(state),
      },
    ]);
    return result;
  }
  const participant = state.participants.find(
    (p) => p.playerId === command.playerId,
  );
  if (!participant) {
    result.error = engineError('UNAUTHORIZED');
    return result;
  }
  if (command.type === 'player.disconnect') {
    if (!participant.connected) return result;
    const deadline = safeAdd(context.receivedAtMonoMs, RECONNECT_GRACE_MS);
    if (
      deadline === null ||
      !isSafeTime(
        state.clockAnchor.utcEpochMs + (deadline - state.clockAnchor.monoMs),
      )
    ) {
      result.error = engineError('TIME_OVERFLOW');
      return result;
    }
    participant.connected = false;
    participant.graceDeadlineMonoMs = deadline;
    if (state.phase === 'PREPARING_ROUND') participant.ready = false;
    if (['PREPARING_ROUND', 'COUNTDOWN', 'PLAYING_WORD'].includes(state.phase))
      participant.initialPlaybackCompleted = false;
    commit(result);
    return result;
  }
  if (command.type === 'player.reconnect') {
    if (participant.connected) return result;
    participant.connected = true;
    participant.graceDeadlineMonoMs = null;
    commit(result);
    return result;
  }
  const parsed =
    command.type === 'round.audio_ready'
      ? AudioReadySchema.safeParse(command.payload)
      : command.type === 'round.audio_completed'
        ? AudioCompletedSchema.safeParse(command.payload)
        : command.type === 'round.audio_failed'
          ? AudioFailedSchema.safeParse(command.payload)
          : ReplayUsedSchema.safeParse(command.payload);
  if (!parsed.success) {
    result.error = engineError('INVALID_COMMAND');
    return result;
  }
  if (parsed.data.matchId !== state.matchId) {
    result.error = engineError('WRONG_MATCH');
    return result;
  }
  if (parsed.data.roundId !== state.round?.roundId) {
    result.error = engineError('UNKNOWN_ROUND');
    return result;
  }
  if (!participant.connected) {
    result.error = engineError('DISCONNECTED');
    return result;
  }
  if (
    'audioVersion' in parsed.data &&
    parsed.data.audioVersion !== state.round.audio.audioVersion
  ) {
    result.error = engineError('WRONG_ASSET');
    return result;
  }
  if (command.type === 'round.audio_failed') {
    if (state.phase === 'ROUND_RESULT')
      result.error = engineError('ROUND_CLOSED');
    else abort(result, 'AUDIO_UNAVAILABLE');
    return result;
  }
  if (command.type === 'round.audio_completed') {
    const schedule = state.round.monoSchedule;
    if (state.phase === 'ROUND_RESULT')
      result.error = engineError('ROUND_CLOSED');
    else if (
      participant.initialPlaybackCompleted &&
      state.phase === 'ACTIVE_TYPING'
    )
      return result;
    else if (
      !schedule ||
      state.phase !== 'PLAYING_WORD' ||
      context.receivedAtMonoMs <
        schedule.playbackAt + state.round.audio.clipDurationMs
    )
      result.error = engineError('INVALID_PHASE');
    else if (!participant.initialPlaybackCompleted) {
      participant.initialPlaybackCompleted = true;
      commit(result);
    }
    return result;
  }
  if (command.type === 'round.audio_ready' && 'audioVersion' in parsed.data) {
    if (state.phase !== 'PREPARING_ROUND') {
      // An acknowledged duplicate cannot restart an already scheduled round.
      if (
        participant.ready &&
        parsed.data.audioVersion === state.round.audio.audioVersion
      )
        return result;
      result.error = engineError('INVALID_PHASE');
      return result;
    }
    if (parsed.data.audioVersion !== state.round.audio.audioVersion) {
      result.error = engineError('WRONG_ASSET');
      return result;
    }
    if (participant.ready) return result;
    const bothReady = state.participants.every(
      (p) => p.connected && (p === participant || p.ready),
    );
    if (bothReady) {
      const countdown =
        state.roundNumber === 1
          ? INITIAL_COUNTDOWN_MS
          : state.config.laterCountdownMs;
      const playbackAt = safeAdd(context.receivedAtMonoMs, countdown);
      const typingStartAt =
        playbackAt === null
          ? null
          : safeAdd(
              playbackAt,
              state.round.audio.clipDurationMs,
              state.config.playbackMarginMs,
            );
      const duration =
        state.config.typingDurationMsByLevel[
          state.currentLevel as 1 | 2 | 3 | 4 | 5
        ];
      const deadlineAt =
        typingStartAt === null ? null : safeAdd(typingStartAt, duration);
      if (
        playbackAt === null ||
        typingStartAt === null ||
        deadlineAt === null ||
        !isSafeTime(
          state.clockAnchor.utcEpochMs +
            (deadlineAt - state.clockAnchor.monoMs),
        )
      ) {
        result.error = engineError('TIME_OVERFLOW');
        return result;
      }
      participant.ready = true;
      state.round.monoSchedule = { playbackAt, typingStartAt, deadlineAt };
      state.round.preflightDeadlineMonoMs = null;
      state.phase = 'COUNTDOWN';
      const schedule = {
        playbackAt: toUtc(state.clockAnchor, playbackAt),
        typingStartAt: toUtc(state.clockAnchor, typingStartAt),
        deadlineAt: toUtc(state.clockAnchor, deadlineAt),
      };
      commit(result, [
        {
          type: 'round.start',
          matchId: state.matchId,
          payload: { ...prepared(state), schedule },
        },
      ]);
      drainDue(result, context.receivedAtMonoMs);
    } else {
      participant.ready = true;
      commit(result);
    }
    return result;
  }
  if (state.phase !== 'ACTIVE_TYPING') {
    result.error = engineError('NOT_TYPING');
    return result;
  }
  if (
    'replaySequence' in parsed.data &&
    !participant.replaySequences.includes(parsed.data.replaySequence)
  ) {
    participant.replaySequences.push(parsed.data.replaySequence);
    commit(result);
  }
  return result;
}
