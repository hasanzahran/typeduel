import { fireEvent, render, screen } from '@testing-library/react-native';
import type { MatchSnapshot } from '@typeduel/contracts';

const mockReplace = jest.fn();
const mockRuntime = {
  connection: { clock: { remaining: jest.fn().mockReturnValue(7200) } },
  audio: { replay: jest.fn().mockResolvedValue(undefined) },
  submit: jest
    .fn()
    .mockResolvedValue({ status: 'INCORRECT', attemptsRemaining: 2 }),
};
let mockView: Record<string, unknown>;
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));
jest.mock('./runtime', () => ({
  useMatchRuntime: () => [mockRuntime, mockView],
}));

import { GameScreen } from './GameScreen';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const active: MatchSnapshot = {
  matchId: id(1),
  setup: { mode: 'classic', categorySlug: 'general', difficulty: 1 },
  participants: [
    { playerId: id(2), score: 1, connected: true, graceDeadlineAt: null },
    { playerId: id(3), score: 0, connected: true, graceDeadlineAt: null },
  ],
  currentLevel: 1,
  roundNumber: 2,
  stateVersion: 10,
  viewer: {
    playerId: id(2),
    attemptsRemaining: 3,
    replaysRemaining: 2,
    countedAttempts: [],
  },
  phase: 'ACTIVE_TYPING',
  round: {
    roundId: id(4),
    roundNumber: 2,
    level: 1,
    audio: {
      assetId: id(5),
      audioVersion: id(6),
      url: 'https://game.test/audio',
      clipDurationMs: 500,
      sha256: 'a'.repeat(64),
    },
    schedule: { playbackAt: 1000, typingStartAt: 1500, deadlineAt: 9500 },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockView = {
    status: 'ready',
    snapshot: active,
    audio: { failure: null, replaying: false, replaysRemaining: 2 },
    inputEnabled: true,
    results: [],
  };
});

test('binds the composer to committed attempts and sends deliberate text through the runtime', async () => {
  await render(<GameScreen />);
  expect(screen.getByText('Round 2 · Level 1')).toBeTruthy();
  expect(screen.queryByText('secret-answer')).toBeNull();
  await fireEvent.changeText(
    screen.getByLabelText('Your spelling'),
    'typed word',
  );
  await fireEvent.press(screen.getByLabelText('Submit'));
  expect(mockRuntime.submit).toHaveBeenCalledWith('typed word');
  expect(await screen.findByText('Not quite · 2 attempts left')).toBeTruthy();
});

test('keeps input disabled until the audio runtime supplies completion proof', async () => {
  mockView = { ...mockView, inputEnabled: false };
  await render(<GameScreen />);
  expect(screen.getByLabelText('Your spelling').props.editable).toBe(false);
  expect(
    screen.getByText('Waiting for verified playback completion…'),
  ).toBeTruthy();
});
