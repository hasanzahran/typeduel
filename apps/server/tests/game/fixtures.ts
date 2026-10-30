import {
  applyCommand,
  advanceTime,
  createMatch,
} from '../../src/game/engine.js';
import type {
  CreateMatchOptions,
  MatchState,
  MonoSchedule,
  ReceiptContext,
  RoundDescriptor,
  TransitionResult,
} from '../../src/game/types.js';

export const fixtureId = (n: number): string =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export function createFixtureMatch(
  overrides: Partial<CreateMatchOptions> = {},
): MatchState {
  return createMatch({
    matchId: fixtureId(1),
    participants: [fixtureId(2), fixtureId(3)],
    setup: { mode: 'classic', categorySlug: 'general', difficulty: 1 },
    clockAnchor: { monoMs: 1_000, utcEpochMs: 1_800_000_000_000 },
    ...overrides,
  });
}
export function createRoundDescriptor(
  state: MatchState,
  overrides: Partial<RoundDescriptor> = {},
): RoundDescriptor {
  const n = state.roundNumber + 1;
  return {
    roundId: fixtureId(100 + n),
    wordId: fixtureId(200 + n),
    canonicalText: `synthetic-${n}`,
    acceptedVariants: [],
    level: state.currentLevel,
    categorySlugs: ['animals', 'food', 'sports', 'technology'],
    audio: {
      assetId: fixtureId(300 + n),
      audioVersion: fixtureId(400 + n),
      url: `https://audio.invalid/${fixtureId(500 + n)}`,
      clipDurationMs: 500,
      sha256: 'a'.repeat(64),
    },
    ...overrides,
  };
}
export const receiptAt = (
  state: MatchState,
  atMonoMs: number,
): ReceiptContext => ({
  receivedAtMonoMs: atMonoMs,
  ingressSequence: state.lastInput.ingressSequence + 1,
});
export const tickAt = (state: MatchState, atMonoMs: number): TransitionResult =>
  advanceTime(state, {
    nowMonoMs: atMonoMs,
    ingressSequence: state.lastInput.ingressSequence + 1,
  });
export function prepareReadyRound(
  state: MatchState,
  options: { descriptor?: RoundDescriptor; atMonoMs?: number } = {},
): {
  state: MatchState;
  descriptor: RoundDescriptor;
  monoSchedule: MonoSchedule;
  steps: TransitionResult[];
} {
  const descriptor = options.descriptor ?? createRoundDescriptor(state);
  const at = options.atMonoMs ?? state.lastInput.atMonoMs;
  const steps: TransitionResult[] = [];
  const run = (result: TransitionResult) => {
    if (result.error)
      throw new Error(`Fixture setup failed: ${result.error.code}`);
    state = result.state;
    steps.push(result);
  };
  run(
    applyCommand(
      state,
      { type: 'round.prepare', descriptor },
      receiptAt(state, at),
    ),
  );
  for (const p of state.participants)
    run(
      applyCommand(
        state,
        {
          type: 'round.audio_ready',
          playerId: p.playerId,
          payload: {
            matchId: state.matchId,
            roundId: descriptor.roundId,
            audioVersion: descriptor.audio.audioVersion,
          },
        },
        receiptAt(state, at),
      ),
    );
  if (!state.round?.monoSchedule)
    throw new Error('Fixture round was not scheduled');
  return {
    state,
    descriptor,
    monoSchedule: structuredClone(state.round.monoSchedule),
    steps,
  };
}
export function submit(
  state: MatchState,
  playerId: string,
  options: {
    attemptId: string;
    text: string;
    atMonoMs: number;
    roundId?: string;
  },
): TransitionResult {
  return applyCommand(
    state,
    {
      type: 'answer.submit',
      playerId,
      payload: {
        matchId: state.matchId,
        roundId: options.roundId ?? state.round?.roundId,
        attemptId: options.attemptId,
        text: options.text,
      },
    },
    receiptAt(state, options.atMonoMs),
  );
}
