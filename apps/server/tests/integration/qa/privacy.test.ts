import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MatchSnapshotSchema,
  TransitionBatchSchema,
} from '@typeduel/contracts';
import { createMatchActor } from '../../../src/game/actor.js';
import { createRoundDescriptor } from '../../game/fixtures.js';
import {
  barrier,
  createScenario,
  prepareRound,
  settle,
  winRound,
  type Scenario,
} from './support/harness.js';

let scenario: Scenario | undefined;
afterEach(async () => {
  await scenario?.testDb.dispose();
  scenario = undefined;
});

const privateKeys = new Set([
  'canonicalText',
  'acceptedVariants',
  'wordId',
  'usedWordIds',
  'fingerprint',
  'checkpoint',
  'clockAnchor',
  'monoSchedule',
  'ingressSequence',
  'lastInput',
  'ownerId',
  'ownerEpoch',
  'storeRevision',
  'lastOperationId',
  'text',
  'state',
]);
function assertPublic(value: unknown, secrets: string[]) {
  const encoded = JSON.stringify(value);
  for (const secret of secrets) expect(encoded).not.toContain(secret);
  function walk(item: unknown) {
    if (Array.isArray(item)) {
      for (const child of item) walk(child);
    } else if (item !== null && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        expect(
          privateKeys.has(key),
          `Private key ${key} crossed a public boundary`,
        ).toBe(false);
        walk(child);
      }
    }
  }
  walk(value);
}

describe('committed actor payload privacy and version coherence', () => {
  it('exposes viewer-only counted ACKs and no answer material throughout scheduling, play and interruption', async () => {
    const s = (scenario = await createScenario());
    const descriptor = createRoundDescriptor(s.record.state, {
      canonicalText: 'qa-private-canonical',
      acceptedVariants: ['qa-private-alias'],
      wordId: randomUUID(),
    });
    const actor = s.actor();
    const [a, b] = s.record.state.participants;
    const secrets = [
      descriptor.canonicalText,
      ...descriptor.acceptedVariants,
      descriptor.wordId,
      'qa-private-wrong',
    ];
    const inspect = () => {
      for (const { viewerId, update } of s.publications) {
        assertPublic(update, secrets);
        expect(MatchSnapshotSchema.safeParse(update.snapshot).success).toBe(
          true,
        );
        expect(update.snapshot.viewer.playerId).toBe(viewerId);
        const versions = update.batches.map((batch) => batch.stateVersion);
        expect(versions).toEqual([...versions].sort((x, y) => x - y));
        expect(new Set(versions).size).toBe(versions.length);
        for (const batch of update.batches) {
          expect(TransitionBatchSchema.safeParse(batch).success).toBe(true);
          expect(batch.stateVersion).toBeLessThanOrEqual(
            update.snapshot.stateVersion,
          );
        }
      }
    };
    expect(
      Object.keys(
        await actor.acceptTrustedCommand({ type: 'round.prepare', descriptor }),
      ).sort(),
    ).toEqual(['ack', 'error']);
    for (const player of [a, b]) {
      await actor.acceptPlayerCommand(
        { playerId: player.playerId },
        {
          type: 'round.audio_ready',
          payload: {
            matchId: s.record.state.matchId,
            roundId: descriptor.roundId,
            audioVersion: descriptor.audio.audioVersion,
          },
        },
      );
    }
    const scheduled = (await s.store.readCommitted(s.record.state.matchId))!;
    const schedule = scheduled.state.round!.monoSchedule!;
    s.clock.set(schedule.playbackAt);
    await actor.wake();
    s.clock.set(schedule.typingStartAt);
    await actor.wake();
    const attemptA = randomUUID();
    const attemptB = randomUUID();
    for (const [player, attemptId] of [
      [a, attemptA],
      [b, attemptB],
    ] as const) {
      const result = await actor.acceptPlayerCommand(
        { playerId: player.playerId },
        {
          type: 'answer.submit',
          payload: {
            matchId: s.record.state.matchId,
            roundId: descriptor.roundId,
            attemptId,
            text: 'qa-private-wrong',
          },
        },
      );
      expect(Object.keys(result).sort()).toEqual(['ack', 'error']);
      assertPublic(result, secrets);
    }
    for (const [player, ownId, opponentId] of [
      [a, attemptA, attemptB],
      [b, attemptB, attemptA],
    ] as const) {
      const projected = actor.getSnapshot(player.playerId);
      expect(projected.ok).toBe(true);
      if (!projected.ok) throw new Error('Participant snapshot unavailable');
      expect(
        projected.snapshot.viewer.countedAttempts.map((ack) => ack.attemptId),
      ).toEqual([ownId]);
      expect(JSON.stringify(projected)).not.toContain(opponentId);
      assertPublic(projected, secrets);
    }
    const intruder = actor.getSnapshot(randomUUID());
    expect(intruder.ok).toBe(false);
    assertPublic(intruder, secrets);
    await actor.acceptTrustedCommand({ type: 'source.unavailable' });
    const persisted = (await s.store.readCommitted(s.record.state.matchId))!;
    secrets.push(
      ...persisted.state.countedAttempts.map((entry) => entry.fingerprint),
    );
    inspect();
    expect(
      new Set(s.publications.map(({ update }) => update.snapshot.phase)),
    ).toEqual(
      new Set([
        'PREPARING_ROUND',
        'COUNTDOWN',
        'PLAYING_WORD',
        'ACTIVE_TYPING',
        'ABORTED',
      ]),
    );
  });

  it('publishes final round result and completion together with the committed final viewer snapshot', async () => {
    const s = (scenario = await createScenario());
    for (let round = 0; round < 4; round += 1) await winRound(s);
    const prepared = await prepareRound(s);
    const actor = s.actor();
    const rawGuess = ` ${prepared.descriptor.canonicalText.toUpperCase()} `;
    const beforeVersion = s.record.state.stateVersion;
    const result = await actor.acceptPlayerCommand(
      { playerId: s.record.state.participants[0].playerId },
      {
        type: 'answer.submit',
        payload: {
          matchId: s.record.state.matchId,
          roundId: prepared.descriptor.roundId,
          attemptId: randomUUID(),
          text: rawGuess,
        },
      },
    );
    const durable = (await s.store.readCommitted(s.record.state.matchId))!;
    expect(result.ack?.stateVersion).toBe(beforeVersion + 1);
    expect(durable.state.phase).toBe('COMPLETED');
    expect(s.publications).toHaveLength(2);
    for (const { update } of s.publications) {
      expect(update.snapshot.phase).toBe('COMPLETED');
      expect(MatchSnapshotSchema.safeParse(update.snapshot).success).toBe(true);
      if (update.snapshot.phase !== 'COMPLETED')
        throw new Error('Expected completed snapshot');
      expect(update.snapshot.result.correctWord).toBe(
        prepared.descriptor.canonicalText,
      );
      expect(update.snapshot.stateVersion).toBe(durable.state.stateVersion);
      expect(update.batches).toHaveLength(1);
      expect(update.batches[0]?.events.map((event) => event.type)).toEqual([
        'round.result',
        'match.complete',
      ]);
      expect(update.batches[0]?.stateVersion).toBe(
        update.snapshot.stateVersion,
      );
      expect(TransitionBatchSchema.safeParse(update.batches[0]).success).toBe(
        true,
      );
      assertPublic(update, [rawGuess, prepared.descriptor.wordId]);
    }
  });

  it('does not publish a rolled-back candidate and advances private revision for a valid public no-op', async () => {
    const s = (scenario = await createScenario());
    const prepared = await prepareRound(s);
    const actor = s.actor();
    let failures = 0;
    const exhausted = barrier(s.testDb);
    s.setFault(async (point) => {
      if (point === 'before_commit') {
        failures += 1;
        if (failures === 2) await exhausted.pause();
        throw new Error('qa-private-database-error');
      }
    });
    const pending = settle(
      actor.acceptPlayerCommand(
        { playerId: s.record.state.participants[0].playerId },
        {
          type: 'answer.submit',
          payload: {
            matchId: s.record.state.matchId,
            roundId: prepared.descriptor.roundId,
            attemptId: randomUUID(),
            text: prepared.descriptor.canonicalText,
          },
        },
      ),
    );
    await exhausted.reached;
    expect(s.publications).toEqual([]);
    expect(await s.store.readCommitted(s.record.state.matchId)).toEqual(
      s.record,
    );
    actor.close();
    exhausted.release();
    expect((await pending).ok).toBe(false);
    s.setFault(() => {});
    const next = s.actor();
    const before = (await s.store.readCommitted(s.record.state.matchId))!;
    await next.acceptTrustedCommand({
      type: 'player.reconnect',
      playerId: before.state.participants[0].playerId,
    });
    const after = (await s.store.readCommitted(before.state.matchId))!;
    expect(after.state.stateVersion).toBe(before.state.stateVersion);
    expect(after.storeRevision).toBe(before.storeRevision + 1n);
    expect(after.state.lastInput.ingressSequence).toBe(
      before.state.lastInput.ingressSequence + 1,
    );
  });

  it('captures raw input on admission and isolates returned snapshots from internal mutable state', async () => {
    const s = (scenario = await createScenario());
    const prepared = await prepareRound(s);
    const actor = s.actor();
    const gate = barrier(s.testDb);
    let hold = true;
    s.setFault(async (point) => {
      if (point === 'before_commit' && hold) {
        hold = false;
        await gate.pause();
      }
    });
    const [a, b] = s.record.state.participants;
    const first = settle(
      actor.acceptTrustedCommand({
        type: 'player.reconnect',
        playerId: a.playerId,
      }),
    );
    await gate.reached;
    const payload = {
      matchId: s.record.state.matchId,
      roundId: prepared.descriptor.roundId,
      attemptId: randomUUID(),
      text: prepared.descriptor.canonicalText,
    };
    const acceptedId = payload.attemptId;
    const answer = actor.acceptPlayerCommand(
      { playerId: b.playerId },
      { type: 'answer.submit', payload },
    );
    payload.text = 'qa-mutated-after-receipt';
    payload.attemptId = randomUUID();
    gate.release();
    expect((await first).ok).toBe(true);
    expect((await answer).ack).toMatchObject({
      attemptId: acceptedId,
      status: 'CORRECT',
    });
    const publicResult = actor.getSnapshot(b.playerId);
    expect(publicResult.ok).toBe(true);
    if (!publicResult.ok) throw new Error('Snapshot unavailable');
    publicResult.snapshot.participants[1].score = 8;
    publicResult.snapshot.viewer.countedAttempts.length = 0;
    const again = actor.getSnapshot(b.playerId);
    expect(again.ok && again.snapshot.participants[1].score).toBe(1);
    expect(again.ok && again.snapshot.viewer.countedAttempts).toHaveLength(1);
  });

  it('isolates a rejected subscriber while retaining the durable win and the other viewer update', async () => {
    const s = (scenario = await createScenario());
    const prepared = await prepareRound(s);
    const seen: string[] = [];
    let secondScore: number | undefined;
    let secondBatchCount: number | undefined;
    s.clock.set(prepared.monoSchedule.typingStartAt);
    const actor = createMatchActor({
      store: s.store,
      owner: s.owner,
      initial: s.record,
      clock: s.clock,
      publish: async (viewerId, update) => {
        seen.push(viewerId);
        if (viewerId === s.record.state.participants[0].playerId) {
          update.snapshot.participants[0].score = 8;
          update.batches.length = 0;
          throw new Error('qa-private-subscriber-error');
        }
        secondScore = update.snapshot.participants[0].score;
        secondBatchCount = update.batches.length;
      },
    });
    s.testDb.cleanupWith(() => actor.close());
    s.clock.set(prepared.monoSchedule.typingStartAt);
    const result = await actor.acceptPlayerCommand(
      { playerId: s.record.state.participants[0].playerId },
      {
        type: 'answer.submit',
        payload: {
          matchId: s.record.state.matchId,
          roundId: prepared.descriptor.roundId,
          attemptId: randomUUID(),
          text: prepared.descriptor.canonicalText,
        },
      },
    );
    expect(result.ack?.status).toBe('CORRECT');
    expect(secondScore).toBe(1);
    expect(secondBatchCount).toBe(1);
    expect(seen).toEqual(s.record.state.participants.map((p) => p.playerId));
    expect(
      (await s.store.readCommitted(s.record.state.matchId))?.state
        .participants[0].score,
    ).toBe(1);
    assertPublic(result, ['qa-private-subscriber-error']);
  });
});
