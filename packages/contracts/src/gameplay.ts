import { z } from 'zod';
import { DifficultySchema, MatchSetupSchema } from './setup.js';

// These schemas contain protocol structure only. Word catalogs remain server-only.
export const MAX_ANSWER_LENGTH = 120;
export const MAX_COUNTED_ATTEMPTS = 2 * 3 * 8;
const Id = z.uuid();
const Time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Version = Time;
const Attempts = z.number().int().min(0).max(3);
const Replays = z.number().int().min(0).max(2);
const RoundNumber = z.number().int().min(1).max(8);
const Text = z
  .string()
  .min(1)
  .max(MAX_ANSWER_LENGTH)
  .refine(
    (text) => text.length <= MAX_ANSWER_LENGTH,
    'Maximum UTF-16 length exceeded',
  )
  .refine((text) => text.trim().length > 0, 'Nonblank text required');
const identity = { matchId: Id, roundId: Id };
export const AnswerSubmitSchema = z.strictObject({
  ...identity,
  attemptId: Id,
  text: Text,
});
export const AudioReadySchema = z.strictObject({
  ...identity,
  audioVersion: Id,
});
// Reports carry no client timestamp: ingress time and the fixed schedule are authoritative.
export const AudioCompletedSchema = AudioReadySchema;
export const AudioFailedSchema = AudioReadySchema.extend({
  reason: z.enum([
    'DOWNLOAD_FAILED',
    'INTEGRITY_FAILED',
    'DECODE_FAILED',
    'PLAYBACK_FAILED',
    'LATE_PLAYBACK',
    'APP_INACTIVE',
  ]),
});
export const ReplayUsedSchema = z.strictObject({
  ...identity,
  replaySequence: z.union([z.literal(1), z.literal(2)]),
});

const ackIdentity = { ...identity, attemptId: Id, stateVersion: Version };
export const CountedAnswerAckSchema = z.strictObject({
  ...ackIdentity,
  status: z.enum(['INCORRECT', 'CORRECT']),
  attemptsRemaining: z.number().int().min(0).max(2),
});
export const RejectedAnswerAckSchema = z.strictObject({
  ...ackIdentity,
  status: z.enum([
    'NOT_TYPING',
    'ROUND_CLOSED',
    'UNKNOWN_ROUND',
    'EXHAUSTED',
    'DISCONNECTED',
    'MATCH_TERMINAL',
    'INVALID_COMMAND',
    'UNAUTHORIZED',
    'WRONG_MATCH',
    'IDEMPOTENCY_CONFLICT',
  ]),
  attemptsRemaining: Attempts.nullable(),
});
export const AnswerAckSchema = z.union([
  CountedAnswerAckSchema,
  RejectedAnswerAckSchema,
]);
export const AudioDescriptorSchema = z.strictObject({
  assetId: Id,
  audioVersion: Id,
  url: z.url(),
  clipDurationMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const RoundScheduleSchema = z
  .strictObject({
    playbackAt: Time,
    typingStartAt: Time,
    deadlineAt: Time,
  })
  .refine(
    (s) => s.playbackAt < s.typingStartAt && s.typingStartAt < s.deadlineAt,
    'Schedule must be ordered',
  );
export const PreparedRoundSchema = z.strictObject({
  roundId: Id,
  roundNumber: RoundNumber,
  level: DifficultySchema,
  audio: AudioDescriptorSchema,
});
export const ScheduledRoundSchema = PreparedRoundSchema.extend({
  schedule: RoundScheduleSchema,
}).refine(
  (round) =>
    round.schedule.typingStartAt >=
    round.schedule.playbackAt + round.audio.clipDurationMs,
  'Typing cannot start before the initial clip ends',
);
const Score = z.strictObject({
  playerId: Id,
  score: z.number().int().min(0).max(8),
});
export const ScoresSchema = z
  .tuple([Score, Score])
  .refine(
    (s) => s[0].playerId !== s[1].playerId,
    'Distinct participants required',
  );
export const RoundResultSchema = z
  .strictObject({
    roundId: Id,
    roundNumber: RoundNumber,
    level: DifficultySchema,
    nextLevel: DifficultySchema,
    correctWord: Text,
    winnerId: Id.nullable(),
    scores: ScoresSchema,
  })
  .refine(
    (r) =>
      (r.winnerId === null ||
        r.scores.some((s) => s.playerId === r.winnerId && s.score > 0)) &&
      r.scores[0].score + r.scores[1].score <= r.roundNumber,
    'Inconsistent round result',
  );
// A scoreless round cannot advance; a winning round advances at most one level.
const validNextLevel = (r: {
  level: number;
  nextLevel: number;
  winnerId: string | null;
}) =>
  r.nextLevel === r.level ||
  (r.winnerId !== null && r.nextLevel === Math.min(r.level + 1, 5));
export const MatchCompletionSchema = z
  .strictObject({
    winnerId: Id.nullable(),
    draw: z.boolean(),
    roundCount: z.number().int().min(5).max(8),
    scores: ScoresSchema,
  })
  .refine((r) => {
    const [a, b] = r.scores;
    if (a.score + b.score > r.roundCount) return false;
    if (
      r.roundCount > 5 &&
      (a.score + b.score > 5 || (!r.draw && Math.abs(a.score - b.score) !== 1))
    )
      return false;
    if (r.draw)
      return r.winnerId === null && a.score === b.score && r.roundCount === 8;
    return (
      r.winnerId === (a.score > b.score ? a.playerId : b.playerId) &&
      a.score !== b.score
    );
  }, 'Inconsistent completed outcome');
export const MatchInterruptionSchema = z.strictObject({
  reason: z.enum([
    'DISCONNECT_TIMEOUT',
    'SOURCE_UNAVAILABLE',
    'AUDIO_UNAVAILABLE',
    'SERVER_RESTART',
  ]),
});
export const ParticipantSchema = Score.extend({
  connected: z.boolean(),
  graceDeadlineAt: Time.nullable(),
}).refine(
  (p) => p.connected === (p.graceDeadlineAt === null),
  'Connection and grace must agree',
);
const ViewerSchema = z.strictObject({
  playerId: Id,
  attemptsRemaining: Attempts,
  replaysRemaining: Replays,
  countedAttempts: z
    .array(CountedAnswerAckSchema)
    .max(MAX_COUNTED_ATTEMPTS / 2),
});
const base = {
  matchId: Id,
  setup: MatchSetupSchema,
  participants: z.tuple([ParticipantSchema, ParticipantSchema]),
  currentLevel: DifficultySchema,
  roundNumber: z.number().int().min(0).max(8),
  stateVersion: Version,
  viewer: ViewerSchema,
};
export const MatchSnapshotSchema = z
  .discriminatedUnion('phase', [
    z.strictObject({
      ...base,
      phase: z.literal('PREPARING_ROUND'),
      round: PreparedRoundSchema.nullable(),
    }),
    z.strictObject({
      ...base,
      phase: z.literal('COUNTDOWN'),
      round: ScheduledRoundSchema,
    }),
    z.strictObject({
      ...base,
      phase: z.literal('PLAYING_WORD'),
      round: ScheduledRoundSchema,
    }),
    z.strictObject({
      ...base,
      phase: z.literal('ACTIVE_TYPING'),
      round: ScheduledRoundSchema,
    }),
    z.strictObject({
      ...base,
      phase: z.literal('ROUND_RESULT'),
      result: RoundResultSchema,
    }),
    z.strictObject({
      ...base,
      phase: z.literal('COMPLETED'),
      result: RoundResultSchema,
      completion: MatchCompletionSchema,
    }),
    z.strictObject({
      ...base,
      phase: z.literal('ABORTED'),
      lastResult: RoundResultSchema.nullable(),
      interruption: MatchInterruptionSchema,
    }),
  ])
  .superRefine((s, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    const ids = s.participants.map((p) => p.playerId);
    if (ids[0] === ids[1] || !ids.includes(s.viewer.playerId))
      fail('Invalid viewer or participants');
    if (s.setup.mode === 'classic' && s.currentLevel !== s.setup.difficulty)
      fail('Classic level must remain fixed');
    if (s.participants[0].score + s.participants[1].score > s.roundNumber)
      fail('Invalid cumulative score');
    if (
      s.setup.mode === 'challenge' &&
      s.currentLevel !==
        Math.min(1 + s.participants[0].score + s.participants[1].score, 5)
    )
      fail('Challenge level must follow awarded rounds');
    const seen = new Set<string>();
    for (const ack of s.viewer.countedAttempts) {
      const key = `${ack.roundId}:${ack.attemptId}`;
      if (
        ack.matchId !== s.matchId ||
        ack.stateVersion > s.stateVersion ||
        seen.has(key)
      )
        fail('Invalid counted history');
      seen.add(key);
    }
    const histories = new Map<
      string,
      z.infer<typeof CountedAnswerAckSchema>[]
    >();
    for (const ack of s.viewer.countedAttempts)
      histories.set(ack.roundId, [...(histories.get(ack.roundId) ?? []), ack]);
    for (const history of histories.values()) {
      if (
        history.length > 3 ||
        new Set(history.map((ack) => ack.attemptsRemaining)).size !==
          history.length ||
        history.filter((ack) => ack.status === 'CORRECT').length > 1
      )
        fail('Invalid per-round history');
    }
    if ('round' in s) {
      if (
        s.round !== null &&
        s.participants[0].score + s.participants[1].score >= s.roundNumber
      )
        fail('Unclosed round cannot have an awarded point');
      if (s.round === null) {
        if (s.roundNumber !== 0)
          fail('Only an initial preparation can omit the round');
      } else if (
        s.round.roundNumber !== s.roundNumber ||
        s.round.level !== s.currentLevel
      )
        fail('Round identity or level mismatch');
    }
    const result =
      'result' in s ? s.result : 'lastResult' in s ? s.lastResult : null;
    const equalScores = (scores: z.infer<typeof ScoresSchema>) =>
      scores.every(
        (score, i) =>
          score.playerId === s.participants[i]?.playerId &&
          score.score === s.participants[i]?.score,
      );
    if (result !== null) {
      if (!validNextLevel(result)) fail('Invalid next level');
      if (
        s.setup.mode === 'challenge' &&
        result.level !==
          Math.min(
            1 +
              result.scores[0].score +
              result.scores[1].score -
              (result.winnerId === null ? 0 : 1),
            5,
          )
      )
        fail('Invalid Challenge played level');
      if (
        result.roundNumber > s.roundNumber ||
        result.nextLevel !== s.currentLevel ||
        !equalScores(result.scores)
      )
        fail('Inconsistent closed result');
      if (s.phase !== 'ABORTED' && result.roundNumber !== s.roundNumber)
        fail('Closed round number mismatch');
      if (s.setup.mode === 'classic' && result.level !== s.setup.difficulty)
        fail('Invalid played level');
    }
    if (
      s.phase === 'COMPLETED' &&
      (s.completion.roundCount !== s.roundNumber ||
        !equalScores(s.completion.scores))
    )
      fail('Inconsistent completion snapshot');
  });

export const GameplayEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('round.prepare'),
    matchId: Id,
    payload: PreparedRoundSchema,
  }),
  z.strictObject({
    type: z.literal('round.start'),
    matchId: Id,
    payload: ScheduledRoundSchema,
  }),
  z.strictObject({
    type: z.literal('round.result'),
    matchId: Id,
    payload: RoundResultSchema,
  }),
  z.strictObject({
    type: z.literal('match.complete'),
    matchId: Id,
    payload: MatchCompletionSchema,
  }),
  z.strictObject({
    type: z.literal('match.interrupted'),
    matchId: Id,
    payload: MatchInterruptionSchema,
  }),
]);
// An empty event list is possible for private bookkeeping/phase transitions.
// Future transports must retain atomic batch delivery, not deduplicate each event by version.
export const TransitionBatchSchema = z
  .strictObject({ stateVersion: Version, events: z.array(GameplayEventSchema) })
  .superRefine((batch, ctx) => {
    const types = batch.events.map((event) => event.type);
    const legal =
      types.length === 0 ||
      (types.length === 1 && types[0] !== 'match.complete') ||
      (types.length === 2 &&
        types[0] === 'round.result' &&
        types[1] === 'match.complete');
    if (!legal)
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid atomic event combination',
      });
    if (new Set(batch.events.map((event) => event.matchId)).size > 1)
      ctx.addIssue({ code: 'custom', message: 'One match per transition' });
    const completion = batch.events.find(
      (event) => event.type === 'match.complete',
    );
    if (completion) {
      const result = batch.events.find(
        (event) => event.type === 'round.result',
      );
      if (
        !result ||
        batch.events.indexOf(result) > batch.events.indexOf(completion) ||
        result.payload.roundNumber !== completion.payload.roundCount ||
        JSON.stringify(result.payload.scores) !==
          JSON.stringify(completion.payload.scores)
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Completion requires its atomic final round result',
        });
    }
  });
export type AnswerSubmit = z.infer<typeof AnswerSubmitSchema>;
export type AudioCompleted = z.infer<typeof AudioCompletedSchema>;
export type AudioFailed = z.infer<typeof AudioFailedSchema>;
export type AudioReady = z.infer<typeof AudioReadySchema>;
export type ReplayUsed = z.infer<typeof ReplayUsedSchema>;
export type CountedAnswerAck = z.infer<typeof CountedAnswerAckSchema>;
export type AnswerAck = z.infer<typeof AnswerAckSchema>;
export type AudioDescriptor = z.infer<typeof AudioDescriptorSchema>;
export type RoundSchedule = z.infer<typeof RoundScheduleSchema>;
export type PreparedRound = z.infer<typeof PreparedRoundSchema>;
export type ScheduledRound = z.infer<typeof ScheduledRoundSchema>;
export type Scores = z.infer<typeof ScoresSchema>;
export type RoundResult = z.infer<typeof RoundResultSchema>;
export type MatchCompletion = z.infer<typeof MatchCompletionSchema>;
export type MatchInterruption = z.infer<typeof MatchInterruptionSchema>;
export type Participant = z.infer<typeof ParticipantSchema>;
export type MatchSnapshot = z.infer<typeof MatchSnapshotSchema>;
export type GameplayEvent = z.infer<typeof GameplayEventSchema>;
export type TransitionBatch = z.infer<typeof TransitionBatchSchema>;
