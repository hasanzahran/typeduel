import { MatchSnapshotSchema } from '@typeduel/contracts';
import { engineError, toUtc } from './rules.js';
import type { MatchState, SnapshotResult } from './types.js';

export function projectSnapshot(
  state: MatchState,
  viewerId: string,
): SnapshotResult {
  const viewer = state.participants.find((p) => p.playerId === viewerId);
  if (!viewer) return { ok: false, error: engineError('UNAUTHORIZED') };
  const base = {
    matchId: state.matchId,
    setup: { ...state.setup },
    participants: state.participants.map((p) => ({
      playerId: p.playerId,
      score: p.score,
      connected: p.connected,
      graceDeadlineAt:
        p.graceDeadlineMonoMs === null
          ? null
          : toUtc(state.clockAnchor, p.graceDeadlineMonoMs),
    })),
    currentLevel: state.currentLevel,
    roundNumber: state.roundNumber,
    stateVersion: state.stateVersion,
    viewer: {
      playerId: viewerId,
      attemptsRemaining: 3 - viewer.attemptsUsed,
      replaysRemaining: 2 - viewer.replaySequences.length,
      countedAttempts: state.countedAttempts
        .filter((a) => a.playerId === viewerId)
        .map((a) => ({ ...a.ack })),
    },
  };
  let projection: unknown;
  if (state.phase === 'ROUND_RESULT')
    projection = { ...base, phase: state.phase, result: state.lastResult };
  else if (state.phase === 'COMPLETED')
    projection = {
      ...base,
      phase: state.phase,
      result: state.lastResult,
      completion: state.completion,
    };
  else if (state.phase === 'ABORTED')
    projection = {
      ...base,
      phase: state.phase,
      lastResult: state.lastResult,
      interruption: state.interruption,
    };
  else {
    const round =
      state.round === null
        ? null
        : {
            roundId: state.round.roundId,
            roundNumber: state.round.roundNumber,
            level: state.round.level,
            audio: {
              assetId: state.round.audio.assetId,
              audioVersion: state.round.audio.audioVersion,
              url: state.round.audio.url,
              clipDurationMs: state.round.audio.clipDurationMs,
              sha256: state.round.audio.sha256,
            },
          };
    if (state.phase === 'PREPARING_ROUND')
      projection = { ...base, phase: state.phase, round };
    else {
      const schedule = state.round?.monoSchedule;
      if (!round || !schedule) throw new Error('Invalid snapshot state');
      projection = {
        ...base,
        phase: state.phase,
        round: {
          ...round,
          schedule: {
            playbackAt: toUtc(state.clockAnchor, schedule.playbackAt),
            typingStartAt: toUtc(state.clockAnchor, schedule.typingStartAt),
            deadlineAt: toUtc(state.clockAnchor, schedule.deadlineAt),
          },
        },
      };
    }
  }
  const parsed = MatchSnapshotSchema.safeParse(projection);
  if (!parsed.success) throw new Error('Invalid snapshot state');
  return { ok: true, snapshot: parsed.data };
}
