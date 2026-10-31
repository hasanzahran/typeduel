jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(),
  setAudioModeAsync: jest.fn(),
}));

import {
  MatchSnapshotSchema,
  type MatchSnapshot,
  type PreparedRound,
  type ScheduledRound,
} from '@typeduel/contracts';
import type { AssetCache } from './asset-cache';
import type {
  NativeAudioPort,
  PlayerPort,
  PlayerStatus,
} from './native-player';
import { RoundAudioController } from './round-audio';
import type { MatchCommands } from '../features/match/commands';
import type { MatchConnection } from '../features/match/connection';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const prepared: PreparedRound = {
  roundId: id(4),
  roundNumber: 1,
  level: 1,
  audio: {
    assetId: id(5),
    audioVersion: id(6),
    url: `https://game.test/v1/audio/${id(5)}/${id(6)}`,
    clipDurationMs: 500,
    sha256: 'a'.repeat(64),
  },
};
const scheduled: ScheduledRound = {
  ...prepared,
  schedule: { playbackAt: 1000, typingStartAt: 1500, deadlineAt: 9500 },
};
const base = {
  matchId: id(3),
  setup: {
    mode: 'classic' as const,
    categorySlug: 'general' as const,
    difficulty: 1 as const,
  },
  participants: [
    { playerId: id(10), score: 0, connected: true, graceDeadlineAt: null },
    { playerId: id(11), score: 0, connected: true, graceDeadlineAt: null },
  ],
  currentLevel: 1 as const,
  roundNumber: 1,
  stateVersion: 1,
  viewer: {
    playerId: id(10),
    attemptsRemaining: 3,
    replaysRemaining: 2,
    countedAttempts: [],
  },
};
const snapshot = (
  phase: 'PREPARING_ROUND' | 'COUNTDOWN' | 'PLAYING_WORD' | 'ACTIVE_TYPING',
): MatchSnapshot =>
  MatchSnapshotSchema.parse(
    phase === 'PREPARING_ROUND'
      ? { ...base, phase, round: prepared }
      : { ...base, phase, round: scheduled },
  );
const flush = async () => {
  for (let index = 0; index < 8; index++) await Promise.resolve();
};

let serverNow: number;
let connectionGeneration: number;
let listener: ((status: PlayerStatus) => void) | null;
let player: PlayerPort;
let commands: {
  replaysRemaining: number;
  reportDecodedAudio: jest.Mock;
  reportAudioCompleted: jest.Mock;
  reportAudioFailed: jest.Mock;
  reserveReplay: jest.Mock;
  reportReplay: jest.Mock;
};
let controller: RoundAudioController;

beforeEach(() => {
  jest.useFakeTimers();
  serverNow = 1000;
  connectionGeneration = 1;
  listener = null;
  player = {
    status: () => ({
      loaded: true,
      playing: false,
      ended: false,
      failed: false,
      reset: false,
      durationMs: 500,
      positionMs: 0,
    }),
    subscribe: jest.fn((next) => {
      listener = next;
      return () => {
        listener = null;
      };
    }),
    play: jest.fn(),
    pause: jest.fn(),
    seekStart: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn(),
  };
  commands = {
    replaysRemaining: 2,
    reportDecodedAudio: jest.fn().mockResolvedValue({ ack: null, error: null }),
    reportAudioCompleted: jest
      .fn()
      .mockResolvedValue({ ack: null, error: null }),
    reportAudioFailed: jest.fn().mockResolvedValue({ ack: null, error: null }),
    reserveReplay: jest.fn(() => {
      commands.replaysRemaining--;
      return 2 - commands.replaysRemaining;
    }),
    reportReplay: jest.fn().mockResolvedValue({ ack: null, error: null }),
  };
  const connection = {
    status: 'ready',
    get connectionGeneration() {
      return connectionGeneration;
    },
    clock: {
      usable: () => true,
      quality: () => ({ ageMs: 0, uncertaintyMs: 20, serverNow }),
      now: () => serverNow,
      invalidate: jest.fn(),
    },
  } as unknown as MatchConnection;
  const cache = {
    prepare: jest
      .fn()
      .mockResolvedValue({ uri: 'file:///verified.mp3', remove: jest.fn() }),
  } as unknown as AssetCache;
  const audio = {
    prepare: jest.fn().mockResolvedValue(player),
  } as NativeAudioPort;
  controller = new RoundAudioController(
    connection,
    commands as unknown as MatchCommands,
    cache,
    audio,
  );
});
afterEach(() => {
  controller.dispose();
  jest.useRealTimers();
});

test('prepares exact audio, follows the absolute schedule and gates typing on a real local end', async () => {
  controller.update(snapshot('PREPARING_ROUND'));
  await flush();
  expect(commands.reportDecodedAudio).toHaveBeenCalledWith({
    matchId: id(3),
    roundId: id(4),
    audioVersion: id(6),
  });
  controller.update(snapshot('COUNTDOWN'));
  jest.runOnlyPendingTimers();
  expect(player.play).toHaveBeenCalledTimes(1);
  expect(controller.canType(snapshot('ACTIVE_TYPING'))).toBe(false);
  listener?.({
    loaded: true,
    playing: false,
    ended: true,
    failed: false,
    reset: false,
    durationMs: 500,
    positionMs: 500,
  });
  await flush();
  serverNow = 1600;
  controller.update(snapshot('ACTIVE_TYPING'));
  expect(commands.reportAudioCompleted).toHaveBeenCalledTimes(1);
  expect(controller.canType(snapshot('ACTIVE_TYPING'))).toBe(true);
});

test('retains an early genuine end and retries only the completion report', async () => {
  commands.reportAudioCompleted
    .mockResolvedValueOnce({
      ack: null,
      error: {
        code: 'INVALID_TIME',
        message: 'Game command could not be applied.',
      },
    })
    .mockResolvedValueOnce({ ack: null, error: null });
  controller.update(snapshot('PREPARING_ROUND'));
  await flush();
  controller.update(snapshot('COUNTDOWN'));
  jest.runOnlyPendingTimers();
  serverNow = 1400;
  listener?.({
    loaded: true,
    playing: false,
    ended: true,
    failed: false,
    reset: false,
    durationMs: 500,
    positionMs: 500,
  });
  await flush();
  expect(player.play).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(100);
  await flush();
  expect(commands.reportAudioCompleted).toHaveBeenCalledTimes(2);
  expect(player.play).toHaveBeenCalledTimes(1);
});

test('reserves replay before seek and never refunds uncertainty or permits overlap', async () => {
  controller.update(snapshot('PREPARING_ROUND'));
  await flush();
  controller.update(snapshot('COUNTDOWN'));
  jest.runOnlyPendingTimers();
  listener?.({
    loaded: true,
    playing: false,
    ended: true,
    failed: false,
    reset: false,
    durationMs: 500,
    positionMs: 500,
  });
  await flush();
  serverNow = 1600;
  controller.update(snapshot('ACTIVE_TYPING'));
  let finishSeek!: () => void;
  jest
    .mocked(player.seekStart)
    .mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishSeek = resolve)),
    );
  const replay = controller.replay();
  expect(commands.reserveReplay).toHaveBeenCalledTimes(1);
  expect(controller.current.replaysRemaining).toBe(1);
  await expect(controller.replay()).rejects.toMatchObject({
    code: 'PLAYBACK_FAILED',
  });
  finishSeek();
  await replay;
  expect(commands.reportReplay).toHaveBeenCalledWith(1);
});

test('a cold-process open round fails closed and reports no autoplay', async () => {
  controller.update(snapshot('ACTIVE_TYPING'));
  await flush();
  expect(controller.current).toMatchObject({
    phase: 'failed',
    failure: 'APP_INACTIVE',
  });
  expect(player.play).not.toHaveBeenCalled();
  expect(commands.reportAudioFailed).toHaveBeenCalledWith({
    matchId: id(3),
    roundId: id(4),
    audioVersion: id(6),
    reason: 'APP_INACTIVE',
  });
  expect(controller.canType(snapshot('ACTIVE_TYPING'))).toBe(false);
});

test('a reconnect during pending playback invalidates the old player callback', async () => {
  controller.update(snapshot('PREPARING_ROUND'));
  await flush();
  controller.update(snapshot('COUNTDOWN'));
  connectionGeneration++;
  controller.update(snapshot('COUNTDOWN'));
  await flush();
  expect(controller.current.failure).toBe('APP_INACTIVE');
  listener?.({
    loaded: true,
    playing: false,
    ended: true,
    failed: false,
    reset: false,
    durationMs: 500,
    positionMs: 500,
  });
  expect(commands.reportAudioCompleted).not.toHaveBeenCalled();
});

test('a committed schedule recovers a lost readiness ACK without replaying or moving time', async () => {
  commands.reportDecodedAudio.mockRejectedValueOnce(new Error('ACK lost'));
  controller.update(snapshot('PREPARING_ROUND'));
  await flush();
  controller.update(snapshot('COUNTDOWN'));
  jest.runOnlyPendingTimers();
  expect(player.play).toHaveBeenCalledTimes(1);
});

test('old readiness ACK cannot skip readiness for the next round', async () => {
  let resolveOld!: (value: unknown) => void;
  commands.reportDecodedAudio.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  controller.update(snapshot('PREPARING_ROUND'));
  await flush();
  const next = snapshot('PREPARING_ROUND');
  if (!('round' in next)) throw new Error('fixture');
  next.round = { ...prepared, roundId: id(20), roundNumber: 2 };
  next.roundNumber = 2;
  controller.update(next);
  resolveOld({ ack: null, error: null });
  await flush();
  expect(commands.reportDecodedAudio).toHaveBeenCalledTimes(2);
  expect(commands.reportDecodedAudio).toHaveBeenLastCalledWith(
    expect.objectContaining({ roundId: id(20) }),
  );
});

test('native duration inconsistent with reviewed bytes never reports readiness', async () => {
  player.status = () => ({
    loaded: true,
    playing: false,
    ended: false,
    failed: false,
    reset: false,
    durationMs: 1500,
    positionMs: 0,
  });
  controller.update(snapshot('PREPARING_ROUND'));
  await flush();
  expect(controller.current.failure).toBe('DECODE_FAILED');
  expect(commands.reportDecodedAudio).not.toHaveBeenCalled();
  expect(player.dispose).toHaveBeenCalled();
});

test('a seek finishing after the fixed deadline never starts a replay', async () => {
  controller.update(snapshot('PREPARING_ROUND'));
  await flush();
  controller.update(snapshot('COUNTDOWN'));
  jest.runOnlyPendingTimers();
  listener?.({
    loaded: true,
    playing: false,
    ended: true,
    failed: false,
    reset: false,
    durationMs: 500,
    positionMs: 500,
  });
  await flush();
  serverNow = 1600;
  controller.update(snapshot('ACTIVE_TYPING'));
  let finishSeek!: () => void;
  jest.mocked(player.seekStart).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishSeek = resolve;
      }),
  );
  const replay = controller.replay();
  serverNow = 9500;
  finishSeek();
  await expect(replay).rejects.toMatchObject({ code: 'APP_INACTIVE' });
  expect(player.play).toHaveBeenCalledTimes(1);
  expect(commands.reportReplay).not.toHaveBeenCalled();
});

test('a new round fences an old pending replay without poisoning the new round', async () => {
  controller.update(snapshot('PREPARING_ROUND'));
  await flush();
  controller.update(snapshot('COUNTDOWN'));
  jest.runOnlyPendingTimers();
  listener?.({
    loaded: true,
    playing: false,
    ended: true,
    failed: false,
    reset: false,
    durationMs: 500,
    positionMs: 500,
  });
  await flush();
  serverNow = 1600;
  controller.update(snapshot('ACTIVE_TYPING'));
  let finishSeek!: () => void;
  jest.mocked(player.seekStart).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishSeek = resolve;
      }),
  );
  const replay = controller.replay();
  controller.update(null);
  controller.update(snapshot('PREPARING_ROUND'));
  await flush();
  finishSeek();
  await expect(replay).rejects.toMatchObject({ code: 'APP_INACTIVE' });
  expect(controller.current.failure).toBeNull();
  expect(player.play).toHaveBeenCalledTimes(1);
});
