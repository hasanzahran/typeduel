import { useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { randomUUID } from 'expo-crypto';
import type {
  MatchSnapshot,
  RoundResult,
  SessionState,
} from '@typeduel/contracts';
import type { TokenProvider } from '../../auth/token-provider';
import {
  RoundAudioController,
  type RoundAudioState,
} from '../../audio/round-audio';
import { GameplayFailure, MatchCommands } from './commands';
import { MatchConnection, type ConnectionStatus } from './connection';
import { MatchLobby } from './lobby';

export interface MatchRuntimeView {
  status: ConnectionStatus;
  session: SessionState | null;
  snapshot: MatchSnapshot | null;
  audio: RoundAudioState;
  inputEnabled: boolean;
  results: RoundResult[];
}

export class MatchRuntime {
  readonly connection: MatchConnection;
  readonly commands: MatchCommands;
  readonly lobby: MatchLobby;
  readonly audio: RoundAudioController;
  private listeners = new Set<() => void>();
  private foreground = AppState.currentState === 'active';
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private readonly subscriptions: (() => void)[] = [];
  private cachedView!: MatchRuntimeView;
  private unresolvedSubmission: {
    roundId: string;
    matchId: string;
    text: string;
    id: string;
  } | null = null;

  constructor(baseUrl: string, tokenProvider: TokenProvider) {
    this.connection = new MatchConnection({
      baseUrl,
      tokenProvider,
      newRequestId: randomUUID,
      onChange: () => this.changed(),
    });
    this.commands = new MatchCommands(this.connection);
    this.lobby = new MatchLobby(this.connection);
    this.audio = new RoundAudioController(this.connection, this.commands);
    this.cachedView = this.buildView();
    this.subscriptions.push(
      this.connection.consumer.subscribe(() => this.changed()),
      this.audio.subscribe(() => this.emit()),
    );
    const appState = AppState.addEventListener('change', (status) =>
      this.onAppState(status),
    );
    this.subscriptions.push(() => appState.remove());
  }

  get view(): MatchRuntimeView {
    return this.cachedView;
  }
  private buildView(): MatchRuntimeView {
    const snapshot = this.connection.consumer.snapshot;
    return {
      status: this.connection.status,
      session: this.connection.consumer.state,
      snapshot,
      audio: this.audio.current,
      inputEnabled: this.audio.canType(snapshot),
      results: this.connection.consumer.receivedResults,
    };
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(): void {
    this.cachedView = this.buildView();
    for (const listener of this.listeners) listener();
  }
  private changed(): void {
    this.audio.update(this.connection.consumer.snapshot);
    if (this.connection.status === 'ready' && this.foreground)
      this.startClockSampling();
    else this.stopClockSampling();
    this.emit();
  }
  private startClockSampling(): void {
    if (this.clockTimer) return;
    void this.sampleClock();
    this.clockTimer = setInterval(() => void this.sampleClock(), 4000);
  }
  private stopClockSampling(): void {
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.clockTimer = null;
  }
  private async sampleClock(): Promise<void> {
    await this.connection.sampleClock();
    this.audio.update(this.connection.consumer.snapshot);
    this.emit();
  }
  private onAppState(status: AppStateStatus): void {
    const foreground = status === 'active';
    if (foreground === this.foreground) return;
    this.foreground = foreground;
    this.audio.setForeground(foreground);
    if (foreground && this.connection.status !== 'auth-required')
      void this.connection.connect();
    else this.stopClockSampling();
    this.emit();
  }

  async start(): Promise<void> {
    await this.connection.connect();
    if (this.connection.status === 'ready') return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => finish(new Error('Connection timed out')),
        10_000,
      );
      const unsubscribe = this.subscribe(() => {
        if (this.connection.status === 'ready') finish();
        else if (
          this.connection.status === 'auth-required' ||
          this.connection.status === 'replaced'
        )
          finish(new Error('Authentication required'));
      });
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        unsubscribe();
        if (error) reject(error);
        else resolve();
      };
    });
  }
  async joinDevelopmentQueue(): Promise<void> {
    await this.lobby.joinQueue({
      mode: 'classic',
      categorySlug: 'general',
      difficulty: 1,
    });
  }
  async submit(text: string) {
    const snapshot = this.connection.consumer.snapshot;
    if (
      !snapshot ||
      snapshot.phase !== 'ACTIVE_TYPING' ||
      !this.audio.canType(snapshot)
    )
      throw new Error('Typing is unavailable');
    let submission = this.unresolvedSubmission;
    if (
      !submission ||
      submission.matchId !== snapshot.matchId ||
      submission.roundId !== snapshot.round.roundId ||
      submission.text !== text
    ) {
      submission = {
        matchId: snapshot.matchId,
        roundId: snapshot.round.roundId,
        text,
        id: this.commands.createAnswer(text),
      };
      this.unresolvedSubmission = submission;
    }
    try {
      const ack = await this.commands.sendAnswer(submission.id);
      if (this.unresolvedSubmission === submission)
        this.unresolvedSubmission = null;
      return ack;
    } catch (error) {
      if (
        error instanceof GameplayFailure &&
        this.unresolvedSubmission === submission
      )
        this.unresolvedSubmission = null;
      throw error;
    }
  }
  stop(): void {
    this.stopClockSampling();
    this.connection.disconnect();
  }
  dispose(): void {
    this.unresolvedSubmission = null;
    this.stop();
    this.audio.dispose();
    this.commands.dispose();
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
    this.listeners.clear();
  }
}

let activeRuntime: MatchRuntime | null = null;
export function setActiveMatchRuntime(runtime: MatchRuntime | null): void {
  activeRuntime = runtime;
}
export function getActiveMatchRuntime(): MatchRuntime {
  if (!activeRuntime) throw new Error('No live match runtime is active');
  return activeRuntime;
}
export function useMatchRuntime(): [MatchRuntime, MatchRuntimeView] {
  const runtime = getActiveMatchRuntime();
  const view = useSyncExternalStore(
    (listener) => runtime.subscribe(listener),
    () => runtime.view,
    () => runtime.view,
  );
  return [runtime, view];
}
