import { z } from 'zod';
import {
  AudioDescriptorSchema,
  CategorySchema,
  CountedAnswerAckSchema,
  MatchCompletionSchema,
  MatchInterruptionSchema,
  MatchSetupSchema,
  RoundResultSchema,
} from '@typeduel/contracts';
import { projectSnapshot } from '../game/snapshot.js';
import type { MatchState } from '../game/types.js';
import { StoreError } from './types.js';

const safe = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const word = z
  .string()
  .min(1)
  .max(120)
  .refine((s) => s.trim().length > 0);
const stateSchema = z.strictObject({
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
  participants: z.tuple([participant(), participant()]),
  currentLevel: safe.min(1).max(5),
  roundNumber: safe.max(8),
  round: z
    .strictObject({
      roundId: z.uuid(),
      wordId: z.uuid(),
      canonicalText: word,
      acceptedVariants: z.array(word),
      level: safe.min(1).max(5),
      categorySlugs: z.array(CategorySchema),
      audio: AudioDescriptorSchema,
      roundNumber: safe.min(1).max(8),
      monoSchedule: z
        .strictObject({
          playbackAt: safe,
          typingStartAt: safe,
          deadlineAt: safe,
        })
        .nullable(),
    })
    .nullable(),
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
function participant() {
  return z.strictObject({
    playerId: z.uuid(),
    score: safe.max(8),
    connected: z.boolean(),
    graceDeadlineMonoMs: safe.nullable(),
    ready: z.boolean(),
    attemptsUsed: safe.max(3),
    replaySequences: z.array(z.union([z.literal(1), z.literal(2)])).max(2),
  });
}
export const CheckpointSchema = z.strictObject({
  formatVersion: z.literal(1),
  state: stateSchema,
});
export interface Checkpoint {
  formatVersion: 1;
  state: MatchState;
}
export function decodeCheckpoint(input: unknown): MatchState {
  let parsed;
  try {
    parsed = CheckpointSchema.safeParse(input);
  } catch {
    throw new StoreError('INVALID_STATE');
  }
  if (!parsed.success) throw new StoreError('INVALID_STATE');
  const state: MatchState = parsed.data.state;
  try {
    const ids = state.participants.map((p) => p.playerId);
    if (
      state.usedRoundIds.length !== state.roundNumber ||
      state.usedWordIds.length !== state.roundNumber ||
      new Set(state.usedRoundIds).size !== state.roundNumber ||
      new Set(state.usedWordIds).size !== state.roundNumber
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
    for (const p of state.participants) {
      if (
        p.score !==
          state.countedAttempts.filter(
            (a) => a.playerId === p.playerId && a.ack.status === 'CORRECT',
          ).length ||
        new Set(p.replaySequences).size !== p.replaySequences.length
      )
        throw new Error();
      if (
        p.attemptsUsed !==
        state.countedAttempts.filter(
          (a) =>
            a.playerId === p.playerId && a.ack.roundId === state.round?.roundId,
        ).length
      )
        throw new Error();
      projectSnapshot(state, p.playerId);
    }
  } catch {
    throw new StoreError('INVALID_STATE');
  }
  return state;
}
export function encodeCheckpoint(state: MatchState): Checkpoint {
  return {
    formatVersion: 1,
    state: decodeCheckpoint({ formatVersion: 1, state }),
  };
}
