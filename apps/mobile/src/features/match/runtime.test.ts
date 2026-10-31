jest.mock('expo-audio', () => ({}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('./connection', () => ({ MatchConnection: jest.fn() }));
jest.mock('./commands', () => ({
  MatchCommands: jest.fn(),
  GameplayFailure: class extends Error {},
}));
jest.mock('./lobby', () => ({ MatchLobby: jest.fn() }));
jest.mock('../../audio/round-audio', () => ({
  RoundAudioController: jest.fn(),
}));

import { AppState } from 'react-native';
import { MatchRuntime } from './runtime';
import { MatchConnection } from './connection';
import { MatchCommands } from './commands';
import { RoundAudioController } from '../../audio/round-audio';

const snapshot = {
  phase: 'ACTIVE_TYPING',
  matchId: 'match',
  round: {
    roundId: 'round',
    schedule: { typingStartAt: 1000, deadlineAt: 9000 },
  },
};
const send = jest.fn();
const create = jest.fn();
let runtime: MatchRuntime;
let changed: () => void;
let currentSnapshot = { ...snapshot };
const actualAudio = jest.requireActual<
  typeof import('../../audio/round-audio')
>('../../audio/round-audio');
beforeEach(() => {
  AppState.currentState = 'active';
  jest.useFakeTimers();
  jest.setSystemTime(950);
  currentSnapshot = { ...snapshot };
  jest.clearAllMocks();
  create.mockReset();
  send.mockReset();
  jest.mocked(MatchConnection).mockImplementation(
    () =>
      ({
        status: 'ready',
        clock: { now: () => Date.now(), usable: () => true },
        sampleClock: () => new Promise(() => {}),
        consumer: {
          get snapshot() {
            return currentSnapshot;
          },
          state: null,
          receivedResults: [],
          subscribe: (listener: () => void) => {
            changed = listener;
            return () => {};
          },
        },
        disconnect: jest.fn(),
      }) as unknown as MatchConnection,
  );
  jest.mocked(MatchCommands).mockImplementation(
    () =>
      ({
        createAnswer: create,
        sendAnswer: send,
        dispose: jest.fn(),
      }) as unknown as MatchCommands,
  );
  jest.mocked(RoundAudioController).mockImplementation(
    () =>
      ({
        canType: () => true,
        update: jest.fn(),
        current: {},
        subscribe: () => () => {},
        dispose: jest.fn(),
      }) as unknown as RoundAudioController,
  );
  runtime = new MatchRuntime('https://game.test', {
    getAccessToken: async () => 'unused',
  });
  create.mockReturnValueOnce('first').mockReturnValueOnce('second');
});
afterEach(() => {
  runtime.dispose();
  jest.useRealTimers();
});

function useRealTimeGate() {
  const proof = {
    foreground: true,
    initialEnded: true,
    state: { failure: null },
    connection: runtime.connection,
  } as unknown as RoundAudioController;
  jest
    .spyOn(runtime.audio, 'canType')
    .mockImplementation((value) =>
      actualAudio.RoundAudioController.prototype.canType.call(proof, value),
    );
  changed();
}

test('rejects plaintext phone backends before creating an authenticated connection', () => {
  const calls = jest.mocked(MatchConnection).mock.calls.length;
  expect(
    () =>
      new MatchRuntime('http://192.168.1.2:3000', {
        getAccessToken: async () => 'unused',
      }),
  ).toThrow('Live phone matches require HTTPS');
  expect(jest.mocked(MatchConnection).mock.calls).toHaveLength(calls);
});

test('deliberate retry after a lost ACK sends the original attempt ID', async () => {
  send
    .mockRejectedValueOnce(new Error('timeout'))
    .mockResolvedValueOnce({ status: 'INCORRECT' });
  await expect(runtime.submit('guess')).rejects.toThrow('timeout');
  await expect(runtime.submit('guess')).resolves.toEqual({
    status: 'INCORRECT',
  });
  expect(create).toHaveBeenCalledTimes(1);
  expect(send.mock.calls).toEqual([['first'], ['first']]);
});

test('a new deliberate submission after a counted ACK costs a new attempt, even with identical spelling', async () => {
  send.mockResolvedValue({ status: 'INCORRECT' });
  await runtime.submit('guess');
  await runtime.submit('guess');
  expect(create).toHaveBeenCalledTimes(2);
  expect(send.mock.calls).toEqual([['first'], ['second']]);
});

test('no answer is sent without the local playback and current clock gate', async () => {
  jest.spyOn(runtime.audio, 'canType').mockReturnValue(false);
  await expect(runtime.submit('guess')).rejects.toThrow(
    'Typing is unavailable',
  );
  expect(send).not.toHaveBeenCalled();
});

test('lagging estimate unlocks at start and disables at deadline without network or clock responses', () => {
  useRealTimeGate();
  const notified = jest.fn();
  runtime.subscribe(notified);
  expect(runtime.view.inputEnabled).toBe(false);
  jest.advanceTimersByTime(49);
  expect(runtime.view.inputEnabled).toBe(false);
  jest.advanceTimersByTime(1);
  expect(runtime.view.inputEnabled).toBe(true);
  expect(notified).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(7999);
  expect(runtime.view.inputEnabled).toBe(true);
  jest.advanceTimersByTime(1);
  expect(runtime.view.inputEnabled).toBe(false);
  expect(notified).toHaveBeenCalledTimes(2);
});

test('a stale boundary wake cannot unlock a round that has left ACTIVE_TYPING', () => {
  useRealTimeGate();
  currentSnapshot = { ...snapshot, phase: 'COUNTDOWN' };
  changed();
  jest.advanceTimersByTime(500);
  expect(runtime.view.inputEnabled).toBe(false);
});

test('boundary rechecks a corrected clock instead of granting permission from the original delay', () => {
  useRealTimeGate();
  jest.setSystemTime(900);
  jest.advanceTimersByTime(50);
  expect(runtime.view.inputEnabled).toBe(false);
  jest.advanceTimersByTime(50);
  expect(runtime.view.inputEnabled).toBe(true);
});

test('disposal cancels a pending eligibility boundary notification', () => {
  useRealTimeGate();
  const notified = jest.fn();
  runtime.subscribe(notified);
  runtime.dispose();
  jest.advanceTimersByTime(9000);
  expect(notified).not.toHaveBeenCalled();
});
