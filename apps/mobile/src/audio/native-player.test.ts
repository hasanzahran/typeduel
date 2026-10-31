const mockSetAudioModeAsync = jest.fn().mockResolvedValue(undefined);
const mockCreateAudioPlayer = jest.fn();
jest.mock('expo-audio', () => ({
  setAudioModeAsync: (...args: unknown[]) => mockSetAudioModeAsync(...args),
  createAudioPlayer: (...args: unknown[]) => mockCreateAudioPlayer(...args),
}));

import { nativeAudio } from './native-player';

function fakePlayer(overrides: Record<string, unknown> = {}) {
  let status = {
    isLoaded: true,
    playing: false,
    didJustFinish: false,
    error: null,
    mediaServicesDidReset: false,
    duration: 0.5,
    currentTime: 0,
    ...overrides,
  };
  let listener: ((next: typeof status) => void) | null = null;
  return {
    get currentStatus() {
      return status;
    },
    addListener: jest.fn((_event, next) => {
      listener = next;
      return { remove: jest.fn(() => (listener = null)) };
    }),
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn(),
    publish(next: Partial<typeof status>) {
      status = { ...status, ...next };
      listener?.(status);
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('configures foreground-only exclusive playback and maps native status in milliseconds', async () => {
  const player = fakePlayer();
  mockCreateAudioPlayer.mockReturnValue(player);
  const port = await nativeAudio.prepare(
    'file:///verified.mp3',
    new AbortController().signal,
  );
  expect(mockSetAudioModeAsync).toHaveBeenCalledWith({
    allowsRecording: false,
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    interruptionMode: 'doNotMix',
  });
  expect(port.status()).toMatchObject({
    loaded: true,
    durationMs: 500,
    positionMs: 0,
  });
  await port.seekStart();
  expect(player.seekTo).toHaveBeenCalledWith(0, 0, 0);
  port.play();
  expect(player.play).toHaveBeenCalledTimes(1);
  port.dispose();
  expect(player.pause).toHaveBeenCalledTimes(1);
  expect(player.remove).toHaveBeenCalledTimes(1);
});

test('rejects a native decode error and removes the uncertain player', async () => {
  const player = fakePlayer({
    error: 'decode failed',
    isLoaded: false,
    duration: 0,
  });
  mockCreateAudioPlayer.mockReturnValue(player);
  await expect(
    nativeAudio.prepare('file:///invalid.mp3', new AbortController().signal),
  ).rejects.toMatchObject({ code: 'DECODE_FAILED' });
  expect(player.pause).toHaveBeenCalledTimes(1);
  expect(player.remove).toHaveBeenCalledTimes(1);
});
