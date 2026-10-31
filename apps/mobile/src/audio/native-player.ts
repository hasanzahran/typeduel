import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { AudioFailure } from './asset-cache';
export interface PlayerStatus {
  loaded: boolean;
  playing: boolean;
  ended: boolean;
  failed: boolean;
  reset: boolean;
  durationMs: number;
  positionMs: number;
}
export interface PlayerPort {
  status(): PlayerStatus;
  subscribe(listener: (status: PlayerStatus) => void): () => void;
  play(): void;
  pause(): void;
  seekStart(): Promise<void>;
  dispose(): void;
}
export interface NativeAudioPort {
  prepare(uri: string, signal: AbortSignal): Promise<PlayerPort>;
}
/** Expo readiness/status is observable playback state, not proof of audible output. */
export const nativeAudio: NativeAudioPort = {
  async prepare(uri, signal) {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'doNotMix',
    });
    if (signal.aborted) throw new AudioFailure('DECODE_FAILED');
    const player = createAudioPlayer({ uri }, { updateInterval: 100 });
    const map = (s: typeof player.currentStatus): PlayerStatus => ({
      loaded: s.isLoaded,
      playing: s.playing,
      ended: s.didJustFinish,
      failed: s.error !== null,
      reset: s.mediaServicesDidReset === true,
      durationMs: s.duration * 1000,
      positionMs: s.currentTime * 1000,
    });
    const port: PlayerPort = {
      status: () => map(player.currentStatus),
      subscribe(listener) {
        const subscription = player.addListener('playbackStatusUpdate', (s) =>
          listener(map(s)),
        );
        return () => subscription.remove();
      },
      play: () => player.play(),
      pause: () => player.pause(),
      seekStart: () => player.seekTo(0, 0, 0),
      dispose: () => {
        player.pause();
        player.remove();
      },
    };
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let unsubscribe = () => {};
        const finish = (failed: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          signal.removeEventListener('abort', cancel);
          unsubscribe();
          if (failed) reject(new AudioFailure('DECODE_FAILED'));
          else resolve();
        };
        const cancel = () => finish(true);
        const check = (status: PlayerStatus) => {
          if (signal.aborted || status.failed || status.reset) finish(true);
          else if (status.loaded && status.durationMs > 0) finish(false);
        };
        const timeout = setTimeout(cancel, 10_000);
        signal.addEventListener('abort', cancel);
        unsubscribe = port.subscribe(check);
        check(port.status());
      });
      return port;
    } catch {
      port.dispose();
      throw new AudioFailure('DECODE_FAILED');
    }
  },
};
