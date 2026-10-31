import {
  AudioDescriptorSchema,
  CategorySchema,
  CountedAnswerAckSchema,
  MatchCompletionSchema,
  MatchInterruptionSchema,
  MatchSetupSchema,
  RoundResultSchema,
} from '@typeduel/contracts';
import { z } from 'zod';
import { projectSnapshot } from '../game/snapshot.js';
import type { MatchState } from '../game/types.js';
import { StoreError } from './types.js';

const safe = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const word = z
  .string()
  .min(1)
  .max(120)
  .refine((value) => value.trim().length > 0 && value.length <= 120);
const legacyParticipant = z.strictObject({
  playerId: z.uuid(),
  score: safe.max(8),
  connected: z.boolean(),
  graceDeadlineMonoMs: safe.nullable(),
  ready: z.boolean(),
  attemptsUsed: safe.max(3),
  replaySequences: z.array(z.union([z.literal(1), z.literal(2)])).max(2),
});
const schedule = z
  .strictObject({
    playbackAt: safe,
    typingStartAt: safe,
    deadlineAt: safe,
  })
  .nullable();
const legacyRound = z.strictObject({
  roundId: z.uuid(),
  wordId: z.uuid(),
  canonicalText: word,
  acceptedVariants: z.array(word),
  level: safe.min(1).max(5),
  categorySlugs: z.array(CategorySchema),
  audio: AudioDescriptorSchema,
  roundNumber: safe.min(1).max(8),
  monoSchedule: schedule,
});
const legacyStateSchema = z.strictObject({
  matchId: z.uuid(),
  setup: MatchSetupSchema,
  clockAnchor: z.strictObject({ monoMs: safe, utcEpochMs: safe }),
  config: z.strictObject({
    laterCountdownMs: safe,
    playbackMarginMs: safe,
    typingDurationMsByLevel: z.strictObject({
      1: safe.positive(),
      2: safe.positive(),
      3: safe.positive(),
      4: safe.positive(),
      5: safe.positive(),
    }),
  }),
  phase: z.enum([
    'PREPARING_ROUND',
    'COUNTDOWN',
    'PLAYING_WORD',
    'ACTIVE_TYPING',
    'ROUND_RESULT',
    'COMPLETED',
    'ABORTED',
  ]),
  participants: z.tuple([legacyParticipant, legacyParticipant]),
  currentLevel: safe.min(1).max(5),
  roundNumber: safe.max(8),
  round: legacyRound.nullable(),
  lastResult: RoundResultSchema.nullable(),
  completion: MatchCompletionSchema.nullable(),
  interruption: MatchInterruptionSchema.nullable(),
  usedRoundIds: z.array(z.uuid()).max(8),
  usedWordIds: z.array(z.uuid()).max(8),
  countedAttempts: z
    .array(
      z.strictObject({
        playerId: z.uuid(),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        ack: CountedAnswerAckSchema,
      }),
    )
    .max(48),
  stateVersion: safe,
  lastInput: z.strictObject({ atMonoMs: safe, ingressSequence: safe }),
});
const currentParticipant = legacyParticipant.extend({
  initialPlaybackCompleted: z.boolean(),
});
const currentStateSchema = legacyStateSchema.extend({
  legacyTerminal: z.literal(true).optional(),
  participants: z.tuple([currentParticipant, currentParticipant]),
  round: legacyRound
    .extend({ preflightDeadlineMonoMs: safe.nullable() })
    .nullable(),
});

export const CheckpointSchema = z.strictObject({
  formatVersion: z.literal(2),
  state: currentStateSchema,
});
const LegacyCheckpointSchema = z.strictObject({
  formatVersion: z.literal(1),
  state: legacyStateSchema,
});

export interface Checkpoint {
  formatVersion: 2;
  state: MatchState;
}

function upgradeLegacy(
  state: z.infer<typeof legacyStateSchema>,
): z.input<typeof currentStateSchema> {
  return {
    ...state,
    ...(['COMPLETED', 'ABORTED'].includes(state.phase)
      ? { legacyTerminal: true as const }
      : {}),
    participants: state.participants.map((participant) => ({
      ...participant,
      initialPlaybackCompleted: false,
    })) as z.input<typeof currentStateSchema>['participants'],
    round: state.round
      ? { ...state.round, preflightDeadlineMonoMs: null }
      : null,
  };
}

export function decodeCheckpoint(input: unknown): MatchState {
  let parsed: ReturnType<typeof CheckpointSchema.safeParse>;
  let legacy: boolean;
  try {
    const old = LegacyCheckpointSchema.safeParse(input);
    legacy = old.success;
    parsed = CheckpointSchema.safeParse(
      old.success
        ? { formatVersion: 2, state: upgradeLegacy(old.data.state) }
        : input,
    );
  } catch {
    throw new StoreError('INVALID_STATE');
  }
  if (!parsed.success) throw new StoreError('INVALID_STATE');
  const state: MatchState = parsed.data.state;
  try {
    const terminal = state.phase === 'COMPLETED' || state.phase === 'ABORTED';
    if (state.legacyTerminal && !terminal) throw new Error();
    if (!legacy && !state.legacyTerminal) {
      if (state.round) {
        const scheduled = state.round.monoSchedule !== null;
        if (scheduled === (state.round.preflightDeadlineMonoMs !== null))
          throw new Error();
        if (state.phase === 'PREPARING_ROUND' && scheduled) throw new Error();
        if (
          [
            'COUNTDOWN',
            'PLAYING_WORD',
            'ACTIVE_TYPING',
            'ROUND_RESULT',
            'COMPLETED',
          ].includes(state.phase) &&
          !scheduled
        )
          throw new Error();
        if (scheduled && !state.participants.every((p) => p.ready))
          throw new Error();
      }
      if (
        ['ACTIVE_TYPING', 'ROUND_RESULT', 'COMPLETED'].includes(state.phase) &&
        !state.participants.every((p) => p.initialPlaybackCompleted)
      )
        throw new Error();
      if (
        state.participants.some((p) => p.initialPlaybackCompleted && !p.ready)
      )
        throw new Error();
    }
    const ids = state.participants.map((participant) => participant.playerId);
    if (
      state.usedRoundIds.length !== state.roundNumber ||
      state.usedWordIds.length !== state.roundNumber ||
      new Set(state.usedRoundIds).size !== state.roundNumber ||
      new Set(state.usedWordIds).size !== state.roundNumber ||
      (state.round === null) !== (state.roundNumber === 0)
    )
      throw new Error();
    if (
      state.round &&
      (state.round.roundNumber !== state.roundNumber ||
        state.usedRoundIds.at(-1) !== state.round.roundId ||
        state.usedWordIds.at(-1) !== state.round.wordId)
    )
      throw new Error();
    if (
      state.lastInput.atMonoMs < state.clockAnchor.monoMs ||
      (state.phase === 'COMPLETED') !== (state.completion !== null) ||
      (state.phase === 'ABORTED') !== (state.interruption !== null)
    )
      throw new Error();
    const wins = new Set<string>();
    const counts = new Map<string, number>();
    let previousVersion = -1;
    for (const attempt of state.countedAttempts) {
      if (
        !ids.includes(attempt.playerId) ||
        !state.usedRoundIds.includes(attempt.ack.roundId)
      )
        throw new Error();
      const key = `${attempt.playerId}:${attempt.ack.roundId}`;
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      if (
        attempt.ack.attemptsRemaining !== 3 - count ||
        attempt.ack.stateVersion <= previousVersion
      )
        throw new Error();
      previousVersion = attempt.ack.stateVersion;
      if (attempt.ack.status === 'CORRECT') {
        if (wins.has(attempt.ack.roundId)) throw new Error();
        wins.add(attempt.ack.roundId);
      }
    }
    for (const participant of state.participants) {
      if (
        participant.score !==
          state.countedAttempts.filter(
            (attempt) =>
              attempt.playerId === participant.playerId &&
              attempt.ack.status === 'CORRECT',
          ).length ||
        new Set(participant.replaySequences).size !==
          participant.replaySequences.length ||
        participant.attemptsUsed !==
          state.countedAttempts.filter(
            (attempt) =>
              attempt.playerId === participant.playerId &&
              attempt.ack.roundId === state.round?.roundId,
          ).length
      )
        throw new Error();
      projectSnapshot(state, participant.playerId);
    }
    if (legacy && !terminal) state.legacyCheckpoint = true;
  } catch {
    throw new StoreError('INVALID_STATE');
  }
  return state;
}

export function encodeCheckpoint(state: MatchState): Checkpoint {
  if (state.legacyCheckpoint && !['ABORTED', 'COMPLETED'].includes(state.phase))
    throw new StoreError('INVALID_STATE');
  const current = structuredClone(state);
  if (current.legacyCheckpoint) current.legacyTerminal = true;
  delete current.legacyCheckpoint;
  return {
    formatVersion: 2,
    state: decodeCheckpoint({ formatVersion: 2, state: current }),
  };
}
