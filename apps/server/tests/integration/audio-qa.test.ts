import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { applyCommand } from '../../src/game/engine.js';
import { StoreError } from '../../src/db/types.js';
import { createRoundDescriptor, receiptAt } from '../game/fixtures.js';
import {
  createScenario,
  drive,
  durableRows,
  persistCandidate,
  type Scenario,
} from './qa/support/harness.js';

let scenario: Scenario | undefined;
afterEach(async () => {
  await scenario?.testDb.dispose();
  scenario = undefined;
});

async function scheduleRound(s: Scenario) {
  const descriptor = createRoundDescriptor(s.record.state, {
    roundId: randomUUID(),
  });
  await drive(s, { type: 'round.prepare', descriptor });
  for (const participant of s.record.state.participants)
    await drive(s, {
      type: 'round.audio_ready',
      playerId: participant.playerId,
      payload: {
        matchId: s.record.state.matchId,
        roundId: descriptor.roundId,
        audioVersion: descriptor.audio.audioVersion,
      },
    });
  const round = s.record.state.round;
  if (!round?.monoSchedule) throw new Error('Expected a scheduled round');
  return { descriptor, schedule: round.monoSchedule };
}

describe('real PostgreSQL audio-gate QA', () => {
  it('interrupts at the fixed typing gate when a committed completion is missing', async () => {
    const s = (scenario = await createScenario());
    const { schedule } = await scheduleRound(s);
    const actor = s.actor();

    s.clock.set(schedule.playbackAt);
    await actor.wake();
    s.clock.set(schedule.typingStartAt);
    await actor.wake();

    const committed = await s.store.readCommitted(s.record.state.matchId);
    expect(committed?.state).toMatchObject({
      phase: 'ABORTED',
      interruption: { reason: 'AUDIO_UNAVAILABLE' },
    });
    expect(committed?.state.participants.map((player) => player.score)).toEqual(
      [0, 0],
    );
  });

  it('keeps completion proof durable and private while opening typing only after both receipts', async () => {
    const s = (scenario = await createScenario());
    const { descriptor, schedule } = await scheduleRound(s);
    const actor = s.actor();
    const [a, b] = s.record.state.participants;

    s.clock.set(schedule.playbackAt);
    await actor.wake();
    s.clock.set(schedule.playbackAt + descriptor.audio.clipDurationMs);
    for (const player of [a, b]) {
      const result = await actor.acceptPlayerCommand(
        { playerId: player.playerId },
        {
          type: 'round.audio_completed',
          payload: {
            matchId: s.record.state.matchId,
            roundId: descriptor.roundId,
            audioVersion: descriptor.audio.audioVersion,
          },
        },
      );
      expect(result).toEqual({ ack: null, error: null });
    }
    const beforeTyping = await s.store.readCommitted(s.record.state.matchId);
    expect(
      beforeTyping?.state.participants.map(
        (player) => player.initialPlaybackCompleted,
      ),
    ).toEqual([true, true]);
    for (const { update } of s.publications) {
      const encoded = JSON.stringify(update);
      expect(encoded).not.toContain('initialPlaybackCompleted');
      expect(encoded).not.toContain('preflightDeadlineMonoMs');
    }

    s.clock.set(schedule.typingStartAt);
    await actor.wake();
    expect(
      (await s.store.readCommitted(s.record.state.matchId))?.state.phase,
    ).toBe('ACTIVE_TYPING');
  });

  it('rolls back an audio-completion write without leaving partial proof', async () => {
    const s = (scenario = await createScenario());
    const { descriptor, schedule } = await scheduleRound(s);
    const player = s.record.state.participants[0]!;
    const candidate = applyCommand(
      s.record.state,
      {
        type: 'round.audio_completed',
        playerId: player.playerId,
        payload: {
          matchId: s.record.state.matchId,
          roundId: descriptor.roundId,
          audioVersion: descriptor.audio.audioVersion,
        },
      },
      receiptAt(
        s.record.state,
        schedule.playbackAt + descriptor.audio.clipDurationMs,
      ),
    );
    expect(candidate.error).toBeNull();
    const before = await durableRows(s.testDb.pool);
    s.setFault((point) => {
      if (point === 'after_dml')
        throw new Error('qa-audio-completion-rollback');
    });
    await expect(persistCandidate(s, candidate)).rejects.toMatchObject({
      code: 'ROLLED_BACK',
    } satisfies Partial<StoreError>);
    expect(await durableRows(s.testDb.pool)).toEqual(before);
    expect(
      (await s.store.readCommitted(s.record.state.matchId))?.state
        .participants[0].initialPlaybackCompleted,
    ).toBe(false);
  });

  it('clears a replaced connection’s completion proof and fails closed at typing', async () => {
    const s = (scenario = await createScenario());
    const { descriptor, schedule } = await scheduleRound(s);
    const actor = s.actor();
    const [replaced, retained] = s.record.state.participants;

    s.clock.set(schedule.playbackAt);
    await actor.wake();
    s.clock.set(schedule.playbackAt + descriptor.audio.clipDurationMs);
    for (const player of [replaced, retained])
      await actor.acceptPlayerCommand(
        { playerId: player.playerId },
        {
          type: 'round.audio_completed',
          payload: {
            matchId: s.record.state.matchId,
            roundId: descriptor.roundId,
            audioVersion: descriptor.audio.audioVersion,
          },
        },
      );

    await actor.replaceConnection(replaced.playerId);
    const afterReplacement = await s.store.readCommitted(
      s.record.state.matchId,
    );
    expect(
      afterReplacement?.state.participants.map(
        (player) => player.initialPlaybackCompleted,
      ),
    ).toEqual([false, true]);

    s.clock.set(schedule.typingStartAt);
    await actor.wake();
    expect(
      (await s.store.readCommitted(s.record.state.matchId))?.state,
    ).toMatchObject({
      phase: 'ABORTED',
      interruption: { reason: 'AUDIO_UNAVAILABLE' },
    });
  });
});
