import { describe, expect, it } from 'vitest';
import {
  AnswerSubmitSchema,
  AudioReadySchema,
  ReplayUsedSchema,
  AnswerAckSchema,
  AudioDescriptorSchema,
  RoundScheduleSchema,
  ScheduledRoundSchema,
  MatchSnapshotSchema,
  MatchCompletionSchema,
  RoundResultSchema,
  TransitionBatchSchema,
  MAX_COUNTED_ATTEMPTS,
} from '../src/index.js';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const matchId = id(1),
  roundId = id(2),
  a = id(3),
  b = id(4);
const answer = { matchId, roundId, attemptId: id(5), text: ' Sample ' };
const audio = {
  assetId: id(6),
  audioVersion: id(7),
  url: 'https://audio.invalid/opaque',
  clipDurationMs: 500,
  sha256: 'a'.repeat(64),
};
const schedule = { playbackAt: 3000, typingStartAt: 3600, deadlineAt: 11600 };
const round = { roundId, roundNumber: 1, level: 1, audio, schedule };
const participants: [
  {
    playerId: string;
    score: number;
    connected: boolean;
    graceDeadlineAt: null;
  },
  {
    playerId: string;
    score: number;
    connected: boolean;
    graceDeadlineAt: null;
  },
] = [
  { playerId: a, score: 0, connected: true, graceDeadlineAt: null },
  { playerId: b, score: 0, connected: true, graceDeadlineAt: null },
];
const snapshot = {
  matchId,
  setup: { mode: 'classic', categorySlug: 'general', difficulty: 1 },
  participants,
  currentLevel: 1,
  roundNumber: 1,
  stateVersion: 1,
  viewer: {
    playerId: a,
    attemptsRemaining: 3,
    replaysRemaining: 2,
    countedAttempts: [],
  },
  phase: 'ACTIVE_TYPING',
  round,
};
const scores = [
  { playerId: a, score: 3 },
  { playerId: b, score: 2 },
];
const result = {
  roundId,
  roundNumber: 5,
  level: 1,
  nextLevel: 1,
  correctWord: 'closed-fixture',
  winnerId: a,
  scores,
};
const completion = { winnerId: a, draw: false, roundCount: 5, scores };

describe('strict gameplay contracts', () => {
  it('rejects impossible Challenge progression and mixed terminal batches', () => {
    expect(
      MatchSnapshotSchema.safeParse({
        ...snapshot,
        setup: { mode: 'challenge', categorySlug: 'general' },
        currentLevel: 5,
        round: { ...round, level: 5 },
      }).success,
    ).toBe(false);
    const events = [
      { type: 'round.result', matchId, payload: result },
      { type: 'match.complete', matchId, payload: completion },
    ];
    for (const extra of [
      events[0],
      {
        type: 'match.interrupted',
        matchId,
        payload: { reason: 'DISCONNECT_TIMEOUT' },
      },
      {
        type: 'round.prepare',
        matchId,
        payload: { roundId, roundNumber: 1, level: 1, audio },
      },
    ])
      expect(
        TransitionBatchSchema.safeParse({
          stateVersion: 30,
          events: [...events, extra],
        }).success,
      ).toBe(false);
    expect(
      MatchCompletionSchema.safeParse({
        ...completion,
        roundCount: 6,
        scores: [
          { playerId: a, score: 5 },
          { playerId: b, score: 0 },
        ],
      }).success,
    ).toBe(false);
  });

  it('preserves exact input for idempotency and counts UTF-16 units before normalization', () => {
    expect(AnswerSubmitSchema.parse(answer)).toEqual(answer);
    for (const length of [119, 120])
      expect(
        AnswerSubmitSchema.safeParse({ ...answer, text: 'x'.repeat(length) })
          .success,
      ).toBe(true);
    for (const text of ['', '  \t\n', 'x'.repeat(121), 'e\u0301'.repeat(61)])
      expect(AnswerSubmitSchema.safeParse({ ...answer, text }).success).toBe(
        false,
      );
    expect(
      AnswerSubmitSchema.parse({ ...answer, text: 'e\u0301'.repeat(60) }).text
        .length,
    ).toBe(120);
  });
  it('rejects client authority, malformed identity and unknown fields', () => {
    for (const extra of [
      { playerId: a },
      { score: 1 },
      { receivedAt: 1 },
      { correct: true },
      { deadlineAt: 1 },
      { level: 5 },
    ])
      expect(
        AnswerSubmitSchema.safeParse({ ...answer, ...extra }).success,
      ).toBe(false);
    expect(
      AnswerSubmitSchema.safeParse({ ...answer, attemptId: 'invalid' }).success,
    ).toBe(false);
    expect(
      AudioReadySchema.safeParse({
        matchId,
        roundId,
        audioVersion: audio.audioVersion,
      }).success,
    ).toBe(true);
    expect(
      AudioReadySchema.safeParse({ matchId, roundId, audioVersion: 'spelling' })
        .success,
    ).toBe(false);
    for (const replaySequence of [1, 2])
      expect(
        ReplayUsedSchema.safeParse({ matchId, roundId, replaySequence })
          .success,
      ).toBe(true);
    for (const replaySequence of [0, 3, 1.5])
      expect(
        ReplayUsedSchema.safeParse({ matchId, roundId, replaySequence })
          .success,
      ).toBe(false);
  });
  it('requires contextual ACKs and does not echo guesses or expected answers', () => {
    const ack = {
      matchId,
      roundId,
      attemptId: id(5),
      stateVersion: 2,
      status: 'INCORRECT',
      attemptsRemaining: 2,
    };
    expect(AnswerAckSchema.safeParse(ack).success).toBe(true);
    expect(
      AnswerAckSchema.safeParse({ ...ack, attemptsRemaining: 3 }).success,
    ).toBe(false);
    expect(AnswerAckSchema.safeParse({ ...ack, text: 'guess' }).success).toBe(
      false,
    );
    expect(
      AnswerAckSchema.safeParse({ ...ack, correctWord: 'answer' }).success,
    ).toBe(false);
    expect(
      AnswerAckSchema.safeParse({
        ...ack,
        status: 'NOT_TYPING',
        attemptsRemaining: null,
      }).success,
    ).toBe(true);
  });
  it('validates audio integrity metadata and ordered after-audio schedules', () => {
    expect(AudioDescriptorSchema.safeParse(audio).success).toBe(true);
    for (const patch of [
      { wordId: id(8) },
      { canonicalText: 'secret' },
      { clipDurationMs: 0 },
      { clipDurationMs: 1.2 },
      { sha256: 'bad' },
    ])
      expect(
        AudioDescriptorSchema.safeParse({ ...audio, ...patch }).success,
      ).toBe(false);
    expect(RoundScheduleSchema.safeParse(schedule).success).toBe(true);
    for (const patch of [
      { typingStartAt: 3000 },
      { deadlineAt: 3600 },
      { playbackAt: -1 },
      { deadlineAt: Number.MAX_SAFE_INTEGER + 1 },
    ])
      expect(
        RoundScheduleSchema.safeParse({ ...schedule, ...patch }).success,
      ).toBe(false);
    expect(
      ScheduledRoundSchema.safeParse({
        ...round,
        schedule: { ...schedule, typingStartAt: 3100 },
      }).success,
    ).toBe(false);
  });
  it('discriminates phases and keeps live snapshots free of answer fields', () => {
    expect(MatchSnapshotSchema.safeParse(snapshot).success).toBe(true);
    for (const phase of ['COUNTDOWN', 'PLAYING_WORD'])
      expect(
        MatchSnapshotSchema.safeParse({ ...snapshot, phase }).success,
      ).toBe(true);
    for (const patch of [
      { phase: 'COMPLETED' },
      { phase: 'ROUND_RESULT' },
      { phase: 'ABORTED' },
      { correctWord: 'secret' },
      { roundNumber: 2 },
      { currentLevel: 2 },
    ])
      expect(
        MatchSnapshotSchema.safeParse({ ...snapshot, ...patch }).success,
      ).toBe(false);
    expect(
      MatchSnapshotSchema.safeParse({
        ...snapshot,
        round: { ...round, acceptedVariants: ['secret'] },
      }).success,
    ).toBe(false);
  });
  it('checks participant, viewer, counter and retained-history consistency', () => {
    expect(MAX_COUNTED_ATTEMPTS).toBe(48);
    for (const patch of [
      { playerId: id(90) },
      { attemptsRemaining: 4 },
      { replaysRemaining: 3 },
    ])
      expect(
        MatchSnapshotSchema.safeParse({
          ...snapshot,
          viewer: { ...snapshot.viewer, ...patch },
        }).success,
      ).toBe(false);
    expect(
      MatchSnapshotSchema.safeParse({
        ...snapshot,
        participants: [participants[0], participants[0]],
      }).success,
    ).toBe(false);
    expect(
      MatchSnapshotSchema.safeParse({
        ...snapshot,
        participants: [
          { ...participants[0], connected: false },
          participants[1],
        ],
      }).success,
    ).toBe(false);
    const ack = {
      matchId,
      roundId,
      attemptId: id(9),
      stateVersion: 1,
      status: 'INCORRECT',
      attemptsRemaining: 2,
    };
    for (const countedAttempts of [
      [ack, ack],
      [{ ...ack, matchId: id(90) }],
      [{ ...ack, stateVersion: 2 }],
    ])
      expect(
        MatchSnapshotSchema.safeParse({
          ...snapshot,
          viewer: { ...snapshot.viewer, countedAttempts },
        }).success,
      ).toBe(false);
  });
  it('rejects points already awarded to an unclosed first round', () => {
    expect(
      MatchSnapshotSchema.safeParse({
        ...snapshot,
        participants: [{ ...participants[0], score: 1 }, participants[1]],
      }).success,
    ).toBe(false);
  });
  it('requires a member winner, score consistency and an eight-round draw', () => {
    expect(MatchCompletionSchema.safeParse(completion).success).toBe(true);
    for (const patch of [
      { winnerId: b },
      { winnerId: id(90) },
      { draw: true },
      { roundCount: 4 },
      { roundCount: 9 },
    ])
      expect(
        MatchCompletionSchema.safeParse({ ...completion, ...patch }).success,
      ).toBe(false);
    const tie = {
      winnerId: null,
      draw: true,
      roundCount: 8,
      scores: [
        { playerId: a, score: 0 },
        { playerId: b, score: 0 },
      ],
    };
    expect(MatchCompletionSchema.safeParse(tie).success).toBe(true);
    expect(
      MatchCompletionSchema.safeParse({ ...tie, roundCount: 5 }).success,
    ).toBe(false);
    expect(RoundResultSchema.safeParse(result).success).toBe(true);
    expect(
      RoundResultSchema.safeParse({ ...result, winnerId: id(90) }).success,
    ).toBe(false);
  });
  it('requires matching atomic final round/result events in order', () => {
    const events = [
      { type: 'round.result', matchId, payload: result },
      { type: 'match.complete', matchId, payload: completion },
    ];
    expect(
      TransitionBatchSchema.safeParse({ stateVersion: 30, events }).success,
    ).toBe(true);
    expect(
      TransitionBatchSchema.safeParse({ stateVersion: 30, events: [events[1]] })
        .success,
    ).toBe(false);
    expect(
      TransitionBatchSchema.safeParse({
        stateVersion: 30,
        events: [...events].reverse(),
      }).success,
    ).toBe(false);
    expect(
      TransitionBatchSchema.safeParse({
        stateVersion: 30,
        events: [events[0], { ...events[1], matchId: id(90) }],
      }).success,
    ).toBe(false);
  });
});
