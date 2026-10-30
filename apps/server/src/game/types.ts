import type {
  AnswerAck,
  AudioDescriptor,
  Category,
  CountedAnswerAck,
  MatchCompletion,
  MatchInterruption,
  MatchSetup,
  MatchSnapshot,
  RoundResult,
  TransitionBatch,
} from '@typeduel/contracts';

export interface ClockAnchor {
  monoMs: number;
  utcEpochMs: number;
}
export interface ReceiptContext {
  receivedAtMonoMs: number;
  ingressSequence: number;
}
export interface TickContext {
  nowMonoMs: number;
  ingressSequence: number;
}
export interface RuleConfig {
  laterCountdownMs: number;
  playbackMarginMs: number;
  typingDurationMsByLevel: Record<1 | 2 | 3 | 4 | 5, number>;
}
export interface CreateMatchOptions {
  matchId: string;
  participants: [string, string];
  setup: MatchSetup;
  clockAnchor: ClockAnchor;
  config?: Partial<RuleConfig>;
}
export interface RoundDescriptor {
  roundId: string;
  wordId: string;
  canonicalText: string;
  acceptedVariants: string[];
  level: number;
  categorySlugs: Category[];
  audio: AudioDescriptor;
}
export interface MonoSchedule {
  playbackAt: number;
  typingStartAt: number;
  deadlineAt: number;
}
export interface PrivateRound extends RoundDescriptor {
  roundNumber: number;
  monoSchedule: MonoSchedule | null;
}
export interface PrivateParticipant {
  playerId: string;
  score: number;
  connected: boolean;
  graceDeadlineMonoMs: number | null;
  ready: boolean;
  attemptsUsed: number;
  replaySequences: (1 | 2)[];
}
export interface CountedAttempt {
  playerId: string;
  fingerprint: string;
  ack: CountedAnswerAck;
}
// Private candidate state. Reducers clone it before editing; it is never a wire packet.
export interface MatchState {
  matchId: string;
  setup: MatchSetup;
  clockAnchor: ClockAnchor;
  config: RuleConfig;
  phase: MatchSnapshot['phase'];
  participants: [PrivateParticipant, PrivateParticipant];
  currentLevel: number;
  roundNumber: number;
  round: PrivateRound | null;
  lastResult: RoundResult | null;
  completion: MatchCompletion | null;
  interruption: MatchInterruption | null;
  usedRoundIds: string[];
  usedWordIds: string[];
  countedAttempts: CountedAttempt[];
  stateVersion: number;
  lastInput: { atMonoMs: number; ingressSequence: number };
}
export type GameCommand =
  | { type: 'round.prepare'; descriptor: RoundDescriptor }
  | { type: 'source.unavailable' }
  | { type: 'answer.submit'; playerId: string; payload: unknown }
  | { type: 'round.audio_ready'; playerId: string; payload: unknown }
  | { type: 'round.replay_used'; playerId: string; payload: unknown }
  | { type: 'player.disconnect'; playerId: string }
  | { type: 'player.reconnect'; playerId: string };
export type EngineErrorCode =
  | 'INVALID_COMMAND'
  | 'INVALID_TIME'
  | 'OUT_OF_ORDER'
  | 'UNAUTHORIZED'
  | 'WRONG_MATCH'
  | 'UNKNOWN_ROUND'
  | 'ROUND_CLOSED'
  | 'MATCH_TERMINAL'
  | 'NOT_TYPING'
  | 'DISCONNECTED'
  | 'INVALID_DESCRIPTOR'
  | 'INVALID_PHASE'
  | 'WRONG_ASSET'
  | 'TIME_OVERFLOW';
export interface EngineError {
  code: EngineErrorCode;
  message: string;
}
export interface TransitionResult {
  state: MatchState;
  batches: TransitionBatch[];
  ack: AnswerAck | null;
  error: EngineError | null;
}
export type SnapshotResult =
  { ok: true; snapshot: MatchSnapshot } | { ok: false; error: EngineError };
