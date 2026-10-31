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

import { MatchRuntime } from './runtime';
import { MatchConnection } from './connection';
import { MatchCommands } from './commands';
import { RoundAudioController } from '../../audio/round-audio';

const snapshot = {
  phase: 'ACTIVE_TYPING',
  matchId: 'match',
  round: { roundId: 'round' },
};
const send = jest.fn();
const create = jest.fn();
let runtime: MatchRuntime;
beforeEach(() => {
  jest.clearAllMocks();
  create.mockReset();
  send.mockReset();
  jest.mocked(MatchConnection).mockImplementation(
    () =>
      ({
        status: 'ready',
        consumer: {
          snapshot: { ...snapshot },
          state: null,
          receivedResults: [],
          subscribe: () => () => {},
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
afterEach(() => runtime.dispose());

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
