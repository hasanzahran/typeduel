import {
  type MatchSnapshot,
  type AnswerAck,
  type GameplayReplyData,
} from '@typeduel/contracts';
import { MatchCommands } from './commands';
import { MatchConsumer } from './consumer';
import { MatchConnection } from './connection';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = {
  serverInstanceId: id(1),
  sessionId: id(2),
  admissionRevision: 1,
};
const round = {
  roundId: id(4),
  roundNumber: 1,
  level: 1,
  audio: {
    assetId: id(5),
    audioVersion: id(6),
    url: 'https://example.test/opaque',
    clipDurationMs: 500,
    sha256: 'a'.repeat(64),
  },
  schedule: { playbackAt: 1000, typingStartAt: 1500, deadlineAt: 9500 },
};
let snapshot: MatchSnapshot;
let consumer: MatchConsumer;
let commands: MatchCommands;
let request: jest.Mock;
let sequence: number;
const ack = (
  attemptId: string,
  status: AnswerAck['status'] = 'INCORRECT',
): AnswerAck => ({
  matchId: id(3),
  roundId: id(4),
  attemptId,
  stateVersion: 2,
  status,
  attemptsRemaining: 2,
});
function apply() {
  consumer.acceptSession(
    {
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
    },
    1,
    true,
  );
}
beforeEach(() => {
  snapshot = {
    matchId: id(3),
    setup: { mode: 'classic', categorySlug: 'general', difficulty: 1 },
    participants: [
      { playerId: id(10), score: 0, connected: true, graceDeadlineAt: null },
      { playerId: id(11), score: 0, connected: true, graceDeadlineAt: null },
    ],
    currentLevel: 1,
    roundNumber: 1,
    stateVersion: 1,
    viewer: {
      playerId: id(10),
      attemptsRemaining: 3,
      replaysRemaining: 2,
      countedAttempts: [],
    },
    phase: 'ACTIVE_TYPING',
    round,
  };
  consumer = new MatchConsumer();
  consumer.beginGeneration(1);
  apply();
  request = jest.fn();
  sequence = 100;
  commands = new MatchCommands({
    consumer,
    status: 'ready',
    newRequestId: () => id(sequence++),
    request,
  } as unknown as MatchConnection);
});
test('lost ACK retries retain the exact ID and untrimmed payload', async () => {
  const attemptId = commands.createAnswer('  Example  ');
  request
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ ack: ack(attemptId), error: null });
  await expect(commands.sendAnswer(attemptId)).rejects.toThrow('offline');
  await commands.sendAnswer(attemptId);
  expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
  expect(request.mock.calls[0]![1].text).toBe('  Example  ');
  expect(consumer.snapshot?.viewer.attemptsRemaining).toBe(3);
});
test('counted snapshot resolves a lost ACK without resubmitting or restoring counters', async () => {
  const attemptId = commands.createAnswer('example');
  request.mockRejectedValueOnce(new Error('timeout'));
  await expect(commands.sendAnswer(attemptId)).rejects.toThrow();
  snapshot.stateVersion = 9;
  snapshot.viewer.countedAttempts = [ack(attemptId) as never];
  snapshot.viewer.attemptsRemaining = 1;
  apply();
  expect(await commands.sendAnswer(attemptId)).toEqual(ack(attemptId));
  expect(request).toHaveBeenCalledTimes(1);
  expect(consumer.snapshot?.viewer.attemptsRemaining).toBe(1);
});
test('delayed rejected ACK cannot replace counted snapshot outcome', async () => {
  const attemptId = commands.createAnswer('example');
  let resolve!: (value: GameplayReplyData) => void;
  request.mockImplementationOnce(
    () =>
      new Promise<GameplayReplyData>((done) => {
        resolve = done;
      }),
  );
  const pending = commands.sendAnswer(attemptId);
  snapshot.stateVersion = 3;
  snapshot.viewer.countedAttempts = [ack(attemptId) as never];
  apply();
  resolve({ ack: ack(attemptId, 'NOT_TYPING'), error: null });
  expect((await pending).status).toBe('INCORRECT');
});
test('definitive rejected IDs are not retried automatically; deliberate submissions get new IDs', async () => {
  const attemptId = commands.createAnswer('example');
  request.mockResolvedValue({ ack: ack(attemptId, 'NOT_TYPING'), error: null });
  await commands.sendAnswer(attemptId);
  await commands.sendAnswer(attemptId);
  expect(request).toHaveBeenCalledTimes(1);
  expect(commands.createAnswer('example')).not.toBe(attemptId);
});
test('concurrent retries share one request and wrong-attempt ACKs do not resolve it', async () => {
  const attemptId = commands.createAnswer('example');
  request.mockResolvedValue({ ack: ack(id(999)), error: null });
  const one = commands.sendAnswer(attemptId);
  const two = commands.sendAnswer(attemptId);
  expect(one).toBe(two);
  await expect(one).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  expect(commands.outcome(attemptId)).toBeNull();
});
test('superseding a round clears unresolved raw input and cannot reopen submissions', async () => {
  const attemptId = commands.createAnswer('sensitive guess');
  snapshot = {
    ...snapshot,
    phase: 'ABORTED',
    stateVersion: 8,
    lastResult: null,
    interruption: { reason: 'SERVER_RESTART' },
  };
  delete (snapshot as unknown as Record<string, unknown>).round;
  apply();
  await expect(commands.sendAnswer(attemptId)).rejects.toMatchObject({
    code: 'INVALID_REQUEST',
  });
  expect(() => commands.createAnswer('again')).toThrow();
  expect(request).not.toHaveBeenCalled();
});
test('120 UTF-16 limit and nonblank text are validated before any transport', () => {
  expect(() => commands.createAnswer('a'.repeat(121))).toThrow();
  expect(() => commands.createAnswer('😀'.repeat(61))).toThrow();
  expect(() => commands.createAnswer('  ')).toThrow();
  expect(request).not.toHaveBeenCalled();
});
test('replay recovery is conservative when telemetry ACK is lost', async () => {
  request.mockRejectedValue(new Error('offline'));
  await expect(commands.reportReplay(1)).rejects.toThrow();
  expect(commands.replaysRemaining).toBe(1);
  snapshot.stateVersion = 3;
  apply();
  expect(commands.replaysRemaining).toBe(1);
  await expect(commands.reportReplay(2)).rejects.toThrow();
  expect(commands.replaysRemaining).toBe(0);
});
test('audio readiness is explicit and bound to the current decoded version', async () => {
  const payload = { matchId: id(3), roundId: id(4), audioVersion: id(6) };
  await expect(commands.reportDecodedAudio(payload)).rejects.toMatchObject({
    code: 'INVALID_REQUEST',
  });
  const prepared = { ...round };
  delete (prepared as unknown as Record<string, unknown>).schedule;
  snapshot = {
    ...snapshot,
    phase: 'PREPARING_ROUND',
    stateVersion: 3,
    round: prepared,
  };
  apply();
  await expect(
    commands.reportDecodedAudio({ ...payload, audioVersion: id(99) }),
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  request.mockResolvedValue({ ack: null, error: null });
  await commands.reportDecodedAudio(payload);
  expect(request.mock.calls).toEqual([['round.audio_ready', payload]]);
});
test('valid engine errors stay distinct from malformed replies and do not retry rejected text', async () => {
  const attemptId = commands.createAnswer('example');
  request.mockResolvedValue({
    ack: null,
    error: {
      code: 'UNAUTHORIZED',
      message: 'Game command could not be applied.',
    },
  });
  await expect(commands.sendAnswer(attemptId)).rejects.toMatchObject({
    name: 'GameplayFailure',
    code: 'UNAUTHORIZED',
  });
  await expect(commands.sendAnswer(attemptId)).rejects.toMatchObject({
    code: 'INVALID_REQUEST',
  });
  expect(request).toHaveBeenCalledTimes(1);
});
