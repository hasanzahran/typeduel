import {
  type MatchSnapshot,
  type SessionState,
  type GameplayEvent,
} from '@typeduel/contracts';
import { MatchConsumer } from './consumer';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = {
  serverInstanceId: id(1),
  sessionId: id(2),
  admissionRevision: 3,
};
const round = {
  roundId: id(5),
  roundNumber: 1,
  level: 1,
  audio: {
    assetId: id(6),
    audioVersion: id(7),
    url: 'https://example.test/opaque',
    clipDurationMs: 500,
    sha256: 'a'.repeat(64),
  },
  schedule: { playbackAt: 1000, typingStartAt: 1500, deadlineAt: 9500 },
};
const initial = (
  stateVersion = 3,
): Extract<MatchSnapshot, { phase: 'ACTIVE_TYPING' }> => ({
  matchId: id(3),
  setup: { mode: 'classic', categorySlug: 'general', difficulty: 1 },
  participants: [
    { playerId: id(10), score: 0, connected: true, graceDeadlineAt: null },
    { playerId: id(11), score: 0, connected: true, graceDeadlineAt: null },
  ],
  currentLevel: 1,
  roundNumber: 1,
  stateVersion,
  viewer: {
    playerId: id(10),
    attemptsRemaining: 3,
    replaysRemaining: 2,
    countedAttempts: [],
  },
  phase: 'ACTIVE_TYPING',
  round,
});
const update = (snapshot: MatchSnapshot, events: GameplayEvent[] = []) => ({
  ...scope,
  matchId: snapshot.matchId,
  stateVersion: snapshot.stateVersion,
  snapshot,
  batches: [{ stateVersion: snapshot.stateVersion, events }],
});
const session = (snapshot: MatchSnapshot): SessionState => ({
  ...scope,
  admission: {
    kind: 'match',
    update: {
      matchId: snapshot.matchId,
      stateVersion: snapshot.stateVersion,
      snapshot,
      batches: [],
    },
  },
});
let consumer: MatchConsumer;
beforeEach(() => {
  consumer = new MatchConsumer();
  consumer.beginGeneration(1);
  consumer.acceptSession(session(initial()), 1, true);
});
test('atomic full snapshots tolerate private version gaps; older snapshots cannot roll back', () => {
  const next = initial(9);
  next.viewer.attemptsRemaining = 1;
  expect(consumer.acceptUpdate(update(next), 1)).toBe('applied');
  consumer.acceptUpdate(update(initial(4)), 1);
  expect(consumer.snapshot?.stateVersion).toBe(9);
  expect(consumer.snapshot?.viewer.attemptsRemaining).toBe(1);
  const leaked = consumer.snapshot!;
  leaked.viewer.attemptsRemaining = 3;
  expect(consumer.snapshot?.viewer.attemptsRemaining).toBe(1);
});
test('same-version result after snapshot still produces one presentation effect', () => {
  const base = initial(10);
  const snapshot: MatchSnapshot = {
    ...base,
    phase: 'ROUND_RESULT',
    result: {
      roundId: round.roundId,
      roundNumber: 1,
      level: 1,
      nextLevel: 1,
      correctWord: 'example',
      winnerId: null,
      scores: base.participants.map(({ playerId, score }) => ({
        playerId,
        score,
      })) as [
        { playerId: string; score: number },
        { playerId: string; score: number },
      ],
    },
  };
  // Remove fields belonging exclusively to the previous phase.
  delete (snapshot as unknown as Record<string, unknown>).round;
  consumer.acceptSession(session(snapshot), 1);
  const packet = update(snapshot, [
    {
      type: 'round.result',
      matchId: snapshot.matchId,
      payload: snapshot.result,
    },
  ]);
  consumer.acceptUpdate(packet, 1);
  expect(consumer.takeEffects().map((event) => event.type)).toEqual([
    'round.result',
  ]);
  consumer.acceptUpdate(packet, 1);
  expect(consumer.takeEffects()).toEqual([]);
  expect(consumer.receivedResults.map((result) => result.roundId)).toEqual([
    snapshot.result.roundId,
  ]);
});
test('final result and completion stay together and are independently deduplicated', () => {
  const base = initial(20);
  const snapshot: MatchSnapshot = {
    ...base,
    roundNumber: 5,
    phase: 'COMPLETED',
    participants: [{ ...base.participants[0], score: 1 }, base.participants[1]],
    result: {
      roundId: id(50),
      roundNumber: 5,
      level: 1,
      nextLevel: 1,
      correctWord: 'example',
      winnerId: id(10),
      scores: [
        { playerId: id(10), score: 1 },
        { playerId: id(11), score: 0 },
      ],
    },
    completion: {
      winnerId: id(10),
      draw: false,
      roundCount: 5,
      scores: [
        { playerId: id(10), score: 1 },
        { playerId: id(11), score: 0 },
      ],
    },
  };
  delete (snapshot as unknown as Record<string, unknown>).round;
  const packet = update(snapshot, [
    {
      type: 'round.result',
      matchId: snapshot.matchId,
      payload: snapshot.result,
    },
    {
      type: 'match.complete',
      matchId: snapshot.matchId,
      payload: snapshot.completion,
    },
  ]);
  expect(consumer.acceptUpdate(packet, 1)).toBe('applied');
  expect(consumer.snapshot?.phase).toBe('COMPLETED');
  expect(consumer.takeEffects().map((event) => event.type)).toEqual([
    'round.result',
    'match.complete',
  ]);
  consumer.acceptUpdate(packet, 1);
  expect(consumer.takeEffects()).toEqual([]);
  expect(consumer.receivedResults).toHaveLength(1);
});
test('superseded effects and old-round playback are discarded', () => {
  const countdown: MatchSnapshot = { ...initial(4), phase: 'COUNTDOWN', round };
  consumer.acceptUpdate(
    update(countdown, [
      { type: 'round.start', matchId: countdown.matchId, payload: round },
    ]),
    1,
  );
  consumer.acceptUpdate(update(initial(5)), 1);
  expect(consumer.takeEffects()).toEqual([]);
  consumer.acceptUpdate(
    update(countdown, [
      { type: 'round.start', matchId: countdown.matchId, payload: round },
    ]),
    1,
  );
  expect(consumer.takeEffects()).toEqual([]);
});
test('malformed or cross-match updates require sync without partial application', () => {
  expect(
    consumer.acceptUpdate({ ...update(initial(9)), matchId: id(999) }, 1),
  ).toBe('resync');
  expect(
    consumer.acceptUpdate(
      { ...update(initial(9)), secretAnswer: 'private' },
      1,
    ),
  ).toBe('resync');
  expect(consumer.snapshot?.stateVersion).toBe(3);
});
test('late HTTP/session/found cannot replace newer admission; scopes reset only through sync', () => {
  const idle = {
    ...scope,
    admissionRevision: 4,
    admission: { kind: 'idle' as const },
  };
  consumer.acceptSession(idle, 1);
  expect(consumer.acceptSession(session(initial(20)), 1)).toBe('ignored');
  const replacement = {
    ...idle,
    serverInstanceId: id(99),
    sessionId: id(98),
    admissionRevision: 0,
  };
  expect(consumer.acceptSession(replacement, 1)).toBe('resync');
  consumer.beginGeneration(2);
  expect(consumer.acceptSession(replacement, 1, true)).toBe('ignored');
  expect(consumer.acceptSession(replacement, 2)).toBe('ignored');
  expect(consumer.acceptSession(replacement, 2, true)).toBe('applied');
  expect(consumer.state?.admission.kind).toBe('idle');
});
test('reconnection waits for canonical sync and ignores pre-sync packets', () => {
  consumer.beginGeneration(2);
  expect(consumer.ready).toBe(false);
  expect(consumer.acceptUpdate(update(initial(30)), 2)).toBe('ignored');
  expect(consumer.acceptSession(session(initial(8)), 2, true)).toBe('applied');
  expect(consumer.ready).toBe(true);
});
test('ordinary reconnect retains the committed result ledger for the same match', () => {
  const base = initial(10);
  const result = {
    roundId: round.roundId,
    roundNumber: 1,
    level: 1 as const,
    nextLevel: 1 as const,
    correctWord: 'example',
    winnerId: null,
    scores: [
      { playerId: id(10), score: 0 },
      { playerId: id(11), score: 0 },
    ] as [
      { playerId: string; score: number },
      { playerId: string; score: number },
    ],
  };
  const closed: MatchSnapshot = { ...base, phase: 'ROUND_RESULT', result };
  delete (closed as unknown as Record<string, unknown>).round;
  consumer.acceptUpdate(
    update(closed, [
      { type: 'round.result', matchId: closed.matchId, payload: result },
    ]),
    1,
  );
  consumer.beginGeneration(2);
  const reconnected = session(closed);
  reconnected.sessionId = id(99);
  consumer.acceptSession(reconnected, 2, true);
  expect(consumer.receivedResults).toEqual([result]);
});
test('missed intermediate result is not replayed after advancement; latest interruption stays authoritative', () => {
  const nextRound = { ...round, roundId: id(80), roundNumber: 2 };
  const next: MatchSnapshot = {
    ...initial(12),
    roundNumber: 2,
    round: nextRound,
  };
  consumer.acceptUpdate(update(next), 1);
  expect(consumer.snapshot?.roundNumber).toBe(2);
  expect(consumer.takeEffects()).toEqual([]);
  const interrupted: MatchSnapshot = {
    ...next,
    stateVersion: 15,
    phase: 'ABORTED',
    lastResult: null,
    interruption: { reason: 'SERVER_RESTART' },
  };
  delete (interrupted as unknown as Record<string, unknown>).round;
  consumer.acceptSession(session(interrupted), 1);
  expect(consumer.snapshot?.phase).toBe('ABORTED');
  expect(consumer.takeEffects()).toEqual([]);
  consumer.acceptUpdate(
    update(next, [
      { type: 'round.start', matchId: next.matchId, payload: nextRound },
    ]),
    1,
  );
  expect(consumer.takeEffects()).toEqual([]);
});
