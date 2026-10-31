import { createHash } from 'node:crypto';
import type { MatchCompletion, MatchSetup, Scores } from '@typeduel/contracts';
import type {
  ClockAnchor,
  EngineError,
  EngineErrorCode,
  RuleConfig,
} from './types.js';

export const INITIAL_COUNTDOWN_MS = 3_000;
export const PREFLIGHT_TIMEOUT_MS = 20_000;
export const RECONNECT_GRACE_MS = 10_000;
export const DEFAULT_RULES: RuleConfig = {
  laterCountdownMs: 1_500,
  playbackMarginMs: 1_000,
  typingDurationMsByLevel: {
    1: 8_000,
    2: 8_000,
    3: 10_000,
    4: 12_000,
    5: 15_000,
  },
};
export const normalizeAnswer = (text: string): string =>
  text.normalize('NFC').trim().toLowerCase().normalize('NFC');
// UTF-16 preserves exact JS code units, including distinct unpaired surrogates.
export const fingerprintText = (text: string): string =>
  createHash('sha256').update(Buffer.from(text, 'utf16le')).digest('hex');
export const isSafeTime = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;
export function safeAdd(...values: number[]): number | null {
  const result = values.reduce((sum, value) => sum + value, 0);
  return values.every(isSafeTime) && isSafeTime(result) ? result : null;
}
export function toUtc(anchor: ClockAnchor, monoMs: number): number {
  const value = anchor.utcEpochMs + (monoMs - anchor.monoMs);
  if (!isSafeTime(value)) throw new Error('Invalid public schedule');
  return value;
}
export function nextLevel(
  setup: MatchSetup,
  level: number,
  won: boolean,
): number {
  return setup.mode === 'classic'
    ? setup.difficulty
    : Math.min(5, level + Number(won));
}
export function completionFor(
  roundNumber: number,
  scores: Scores,
): MatchCompletion | null {
  if (roundNumber < 5) return null;
  const [a, b] = scores;
  if (a.score !== b.score)
    return {
      winnerId: a.score > b.score ? a.playerId : b.playerId,
      draw: false,
      roundCount: roundNumber,
      scores,
    };
  return roundNumber === 8
    ? { winnerId: null, draw: true, roundCount: 8, scores }
    : null;
}
export function engineError(code: EngineErrorCode): EngineError {
  // Deliberately static: never attach validation issues or received values.
  return { code, message: 'Game command could not be applied.' };
}
