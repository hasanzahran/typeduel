import type {
  MatchSnapshot,
  PreparedRound,
  ScheduledRound,
} from '@typeduel/contracts';
import {
  AssetCache,
  AudioFailure,
  type AudioFailureCode,
  type VerifiedAsset,
} from './asset-cache';
import {
  nativeAudio,
  type NativeAudioPort,
  type PlayerPort,
  type PlayerStatus,
} from './native-player';
import { MatchCommands } from '../features/match/commands';
import { MatchConnection } from '../features/match/connection';

export type RoundAudioPhase =
  | 'idle'
  | 'downloading'
  | 'decoded'
  | 'scheduled'
  | 'playing'
  | 'ended'
  | 'failed';
export interface RoundAudioState {
  phase: RoundAudioPhase;
  failure: AudioFailureCode | null;
  replaying: boolean;
  replaysRemaining: number;
  roundKey: string | null;
}

const keyOf = (matchId: string, round: PreparedRound) =>
  `${matchId}:${round.roundId}:${round.audio.audioVersion}`;
const openRound = (
  snapshot: MatchSnapshot,
): PreparedRound | ScheduledRound | null =>
  'round' in snapshot ? snapshot.round : null;

/**
 * Owns one verified local file/player at a time. All callbacks are fenced by a
 * local generation and the committed match/round/version identity.
 */
export class RoundAudioController {
  private state: RoundAudioState = {
    phase: 'idle',
    failure: null,
    replaying: false,
    replaysRemaining: 2,
    roundKey: null,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private foreground = true;
  private snapshot: MatchSnapshot | null = null;
  private asset: VerifiedAsset | null = null;
  private player: PlayerPort | null = null;
  private unsubscribePlayer: (() => void) | null = null;
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readyReported = false;
  private readyInFlight = false;
  private readyAttempts = 0;
  private initialEnded = false;
  private playbackKind: 'initial' | 'replay' | null = null;
  private failureReported = false;
  private failureAttempts = 0;
  private playerConnectionGeneration = -1;

  constructor(
    private readonly connection: MatchConnection,
    private readonly commands: MatchCommands,
    private readonly cache: AssetCache = new AssetCache(connection),
    private readonly audio: NativeAudioPort = nativeAudio,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  get current(): RoundAudioState {
    return { ...this.state };
  }
  private notify(): void {
    for (const listener of this.listeners) listener();
  }
  private patch(next: Partial<RoundAudioState>): void {
    this.state = { ...this.state, ...next };
    this.notify();
  }
  private isCurrent(generation: number, key: string): boolean {
    return (
      generation === this.generation &&
      key === this.state.roundKey &&
      this.foreground
    );
  }
  private stopResources(): void {
    this.abort?.abort();
    this.abort = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribePlayer?.();
    this.unsubscribePlayer = null;
    this.player?.dispose();
    this.player = null;
    this.asset?.remove();
    this.asset = null;
    this.playbackKind = null;
  }
  private reset(roundKey: string | null): void {
    ++this.generation;
    this.stopResources();
    this.readyReported = false;
    this.readyInFlight = false;
    this.readyAttempts = 0;
    this.initialEnded = false;
    this.failureReported = false;
    this.failureAttempts = 0;
    this.playerConnectionGeneration = -1;
    this.state = {
      phase: 'idle',
      failure: null,
      replaying: false,
      replaysRemaining: this.commands.replaysRemaining,
      roundKey,
    };
    this.notify();
  }

  update(snapshot: MatchSnapshot | null): void {
    this.snapshot = snapshot;
    if (!snapshot) {
      if (this.state.roundKey) this.reset(null);
      return;
    }
    const round = openRound(snapshot);
    if (!round) {
      if (this.state.roundKey) this.reset(null);
      return;
    }
    const key = keyOf(snapshot.matchId, round);
    if (key !== this.state.roundKey) {
      this.reset(key);
      if (snapshot.phase !== 'PREPARING_ROUND') {
        // The process has no proof that this open round's initial clip ended.
        void this.fail('APP_INACTIVE');
        return;
      }
      void this.prepare(snapshot.matchId, round, this.generation, key);
      return;
    }
    if (
      this.playerConnectionGeneration !== -1 &&
      this.playerConnectionGeneration !== this.connection.connectionGeneration
    ) {
      if (this.playbackKind !== null || !this.initialEnded) {
        void this.fail('APP_INACTIVE');
        return;
      }
      // A completed initial ledger survives an ordinary reconnect. Future
      // replay callbacks bind to the newly synchronized connection generation.
      this.playerConnectionGeneration = this.connection.connectionGeneration;
    }
    if (this.state.phase === 'failed') {
      void this.reportFailure();
      return;
    }
    this.patch({ replaysRemaining: this.commands.replaysRemaining });
    // A committed schedule proves that both readiness commands were accepted,
    // even when our readiness ACK was lost. Keep the local decoded-file proof.
    if (
      this.state.phase === 'decoded' &&
      'schedule' in round &&
      this.readyAttempts > 0
    )
      this.readyReported = true;
    if (this.state.phase === 'decoded') this.tryReady(round);
    if (
      (snapshot.phase === 'COUNTDOWN' || snapshot.phase === 'PLAYING_WORD') &&
      this.readyReported &&
      !this.initialEnded &&
      this.state.phase !== 'scheduled' &&
      this.state.phase !== 'playing'
    )
      this.schedule(snapshot.round);
  }

  private async prepare(
    matchId: string,
    round: PreparedRound,
    generation: number,
    key: string,
  ): Promise<void> {
    if (!this.foreground) return this.fail('APP_INACTIVE');
    this.patch({ phase: 'downloading' });
    const abort = new AbortController();
    this.abort = abort;
    try {
      const asset = await this.cache.prepare(matchId, round, abort.signal);
      if (!this.isCurrent(generation, key)) {
        asset.remove();
        return;
      }
      this.asset = asset;
      const player = await this.audio.prepare(asset.uri, abort.signal);
      if (!this.isCurrent(generation, key)) {
        player.dispose();
        return;
      }
      this.player = player;
      const duration = player.status().durationMs;
      if (
        !Number.isFinite(duration) ||
        Math.abs(duration - round.audio.clipDurationMs) > 100
      ) {
        throw new AudioFailure('DECODE_FAILED');
      }
      this.playerConnectionGeneration = this.connection.connectionGeneration;
      this.unsubscribePlayer = player.subscribe((status) =>
        this.onStatus(status, generation, key),
      );
      this.patch({ phase: 'decoded' });
      this.tryReady(round);
    } catch (error) {
      if (this.isCurrent(generation, key))
        await this.fail(
          error instanceof AudioFailure ? error.code : 'DECODE_FAILED',
        );
    }
  }

  private tryReady(round: PreparedRound): void {
    if (
      this.readyReported ||
      this.readyInFlight ||
      this.readyAttempts >= 3 ||
      !this.foreground ||
      !this.connection.clock.usable() ||
      this.connection.status !== 'ready'
    )
      return;
    this.readyInFlight = true;
    this.readyAttempts++;
    const generation = this.generation;
    const key = this.state.roundKey!;
    const connectionGeneration = this.connection.connectionGeneration;
    const payload = {
      matchId: this.snapshot!.matchId,
      roundId: round.roundId,
      audioVersion: round.audio.audioVersion,
    };
    void this.commands
      .reportDecodedAudio(payload)
      .then((reply) => {
        if (
          !this.isCurrent(generation, key) ||
          connectionGeneration !== this.connection.connectionGeneration
        )
          return;
        if (!reply.error) {
          this.readyReported = true;
          this.update(this.snapshot);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (this.isCurrent(generation, key)) this.readyInFlight = false;
      });
  }

  private schedule(round: ScheduledRound): void {
    const quality = this.connection.clock.quality();
    if (!quality || quality.uncertaintyMs > 100) return;
    const delay = round.schedule.playbackAt - quality.serverNow;
    if (delay < -150) {
      void this.fail('LATE_PLAYBACK');
      return;
    }
    const generation = this.generation;
    const key = this.state.roundKey!;
    const connectionGeneration = this.connection.connectionGeneration;
    this.patch({ phase: 'scheduled' });
    this.timer = setTimeout(
      () => {
        this.timer = null;
        if (!this.isCurrent(generation, key)) return;
        if (connectionGeneration !== this.connection.connectionGeneration) {
          void this.fail('APP_INACTIVE');
          return;
        }
        const now = this.connection.clock.now();
        if (now === null || now - round.schedule.playbackAt > 150) {
          void this.fail('LATE_PLAYBACK');
          return;
        }
        this.playbackKind = 'initial';
        this.patch({ phase: 'playing' });
        try {
          this.player!.play();
        } catch {
          void this.fail('PLAYBACK_FAILED');
        }
      },
      Math.max(0, delay),
    );
  }

  private onStatus(
    status: PlayerStatus,
    generation: number,
    key: string,
  ): void {
    if (
      !this.isCurrent(generation, key) ||
      this.playerConnectionGeneration !== this.connection.connectionGeneration
    )
      return;
    if (status.failed || status.reset) {
      void this.fail('PLAYBACK_FAILED');
      return;
    }
    if (!status.ended) return;
    if (this.playbackKind === 'replay') {
      this.playbackKind = null;
      this.patch({ replaying: false });
      return;
    }
    if (this.playbackKind !== 'initial' || this.initialEnded) return;
    this.playbackKind = null;
    this.initialEnded = true;
    this.patch({ phase: 'ended' });
    void this.reportCompletion(generation, key, 0);
  }

  private async reportCompletion(
    generation: number,
    key: string,
    attempt: number,
  ): Promise<void> {
    if (
      !this.isCurrent(generation, key) ||
      !this.snapshot ||
      !this.initialEnded ||
      this.state.failure ||
      this.connection.status !== 'ready'
    )
      return;
    const round = openRound(this.snapshot);
    if (!round) return;
    try {
      const reply = await this.commands.reportAudioCompleted({
        matchId: this.snapshot.matchId,
        roundId: round.roundId,
        audioVersion: round.audio.audioVersion,
      });
      if (!reply.error || reply.error.code !== 'INVALID_TIME') return;
    } catch {
      return;
    }
    if (
      !this.isCurrent(generation, key) ||
      !('schedule' in round) ||
      attempt >= 12
    )
      return;
    const now = this.connection.clock.now();
    if (now === null || now >= round.schedule.typingStartAt) return;
    setTimeout(
      () => void this.reportCompletion(generation, key, attempt + 1),
      Math.min(100, round.schedule.typingStartAt - now),
    );
  }

  async replay(): Promise<void> {
    const snapshot = this.snapshot;
    const roundKey = this.state.roundKey;
    const generation = this.generation;
    if (
      !snapshot ||
      snapshot.phase !== 'ACTIVE_TYPING' ||
      !this.canType(snapshot) ||
      this.state.replaying ||
      !this.player
    )
      throw new AudioFailure('PLAYBACK_FAILED');
    const sequence = this.commands.reserveReplay();
    this.patch({
      replaying: true,
      replaysRemaining: this.commands.replaysRemaining,
    });
    try {
      await this.player.seekStart();
      const currentRound = this.snapshot && openRound(this.snapshot);
      if (
        !this.foreground ||
        generation !== this.generation ||
        !this.canType() ||
        !currentRound ||
        roundKey !== keyOf(this.snapshot!.matchId, currentRound)
      )
        throw new AudioFailure('APP_INACTIVE');
      this.playbackKind = 'replay';
      this.player.play();
      void this.commands.reportReplay(sequence).catch(() => {});
    } catch (error) {
      if (generation !== this.generation) throw error;
      this.playbackKind = null;
      this.patch({ replaying: false });
      await this.fail(
        error instanceof AudioFailure ? error.code : 'PLAYBACK_FAILED',
      );
      throw error;
    }
  }

  canType(snapshot = this.snapshot): boolean {
    if (!snapshot || snapshot.phase !== 'ACTIVE_TYPING') return false;
    const now = this.connection.clock.now();
    return (
      this.foreground &&
      this.connection.status === 'ready' &&
      this.connection.clock.usable() &&
      this.initialEnded &&
      this.state.failure === null &&
      now !== null &&
      now >= snapshot.round.schedule.typingStartAt &&
      now < snapshot.round.schedule.deadlineAt
    );
  }

  setForeground(foreground: boolean): void {
    if (foreground === this.foreground) return;
    this.foreground = foreground;
    this.connection.clock.invalidate();
    if (!foreground && this.state.roundKey) {
      this.player?.pause();
      void this.fail('APP_INACTIVE');
    }
  }

  private async fail(code: AudioFailureCode): Promise<void> {
    if (this.state.failure) return;
    const snapshot = this.snapshot;
    const round = snapshot && openRound(snapshot);
    this.stopResources();
    this.patch({ phase: 'failed', failure: code, replaying: false });
    if (!snapshot || !round) return;
    await this.reportFailure();
  }

  private async reportFailure(): Promise<void> {
    const snapshot = this.snapshot;
    const round = snapshot && openRound(snapshot);
    const code = this.state.failure;
    if (
      !snapshot ||
      !round ||
      !code ||
      this.failureReported ||
      this.failureAttempts >= 3 ||
      this.connection.status !== 'ready'
    )
      return;
    this.failureAttempts++;
    const generation = this.generation;
    const key = this.state.roundKey!;
    try {
      const reply = await this.commands.reportAudioFailed({
        matchId: snapshot.matchId,
        roundId: round.roundId,
        audioVersion: round.audio.audioVersion,
        reason: code,
      });
      if (this.isCurrent(generation, key) && !reply.error)
        this.failureReported = true;
    } catch {
      // Failure reports are scoped best effort and never buffered offline.
    }
  }

  dispose(): void {
    this.snapshot = null;
    this.reset(null);
    this.listeners.clear();
  }
}
