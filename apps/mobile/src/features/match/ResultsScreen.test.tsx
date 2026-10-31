import { fireEvent, render, screen } from '@testing-library/react-native';
import type { MatchSnapshot } from '@typeduel/contracts';

const mockReplace = jest.fn();
const mockDispose = jest.fn();
const mockSetActiveMatchRuntime = jest.fn();
let mockSnapshot: MatchSnapshot;
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));
jest.mock('./runtime', () => ({
  useMatchRuntime: () => [{ dispose: mockDispose }, { snapshot: mockSnapshot }],
  setActiveMatchRuntime: (...args: unknown[]) =>
    mockSetActiveMatchRuntime(...args),
}));

import { ResultsScreen } from './ResultsScreen';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
beforeEach(() => {
  jest.clearAllMocks();
  mockSnapshot = {
    matchId: id(1),
    setup: { mode: 'classic', categorySlug: 'general', difficulty: 1 },
    participants: [
      { playerId: id(2), score: 3, connected: true, graceDeadlineAt: null },
      { playerId: id(3), score: 1, connected: true, graceDeadlineAt: null },
    ],
    currentLevel: 1,
    roundNumber: 5,
    stateVersion: 20,
    viewer: {
      playerId: id(2),
      attemptsRemaining: 0,
      replaysRemaining: 0,
      countedAttempts: [],
    },
    phase: 'COMPLETED',
    result: {
      roundId: id(4),
      roundNumber: 5,
      level: 1,
      nextLevel: 1,
      correctWord: 'revealed',
      winnerId: id(2),
      scores: [
        { playerId: id(2), score: 3 },
        { playerId: id(3), score: 1 },
      ],
    },
    completion: {
      winnerId: id(2),
      draw: false,
      roundCount: 5,
      scores: [
        { playerId: id(2), score: 3 },
        { playerId: id(3), score: 1 },
      ],
    },
  };
});

test('renders only committed outcome data and returns to the playtest lobby without simulating rematch', async () => {
  await render(<ResultsScreen />);
  expect(screen.getByText('You win!')).toBeTruthy();
  expect(screen.queryByLabelText('Rematch')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Back to playtest lobby'));
  expect(mockDispose).toHaveBeenCalledTimes(1);
  expect(mockSetActiveMatchRuntime).toHaveBeenCalledWith(null);
  expect(mockReplace).toHaveBeenCalledWith('/playtest');
});
