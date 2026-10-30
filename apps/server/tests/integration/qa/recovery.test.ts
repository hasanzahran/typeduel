import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireOwner } from '../../../src/db/owner.js';
import { createDatabase } from '../../../src/db/client.js';
import { migrateDatabase } from '../../../src/db/migrate.js';
import { createMatchStore } from '../../../src/db/match-store.js';
import { createMatchActor } from '../../../src/game/actor.js';
import type { PersistedMatch } from '../../../src/db/types.js';
import {
  createFixtureMatch,
  createRoundDescriptor,
  prepareReadyRound,
  tickAt,
} from '../../game/fixtures.js';
import {
  barrier,
  createScenario,
  createTestDatabase,
  drive,
  durableRows,
  eventually,
  ManualClock,
  prepareRound,
  persistCandidate,
  settle,
  spawnActorChild,
  winRound,
  type Scenario,
  type TestDatabase,
} from './support/harness.js';

let scenario: Scenario | undefined;
let standalone: TestDatabase | undefined;
afterEach(async () => {
  await scenario?.testDb.dispose();
  scenario = undefined;
  await standalone?.dispose();
  standalone = undefined;
});

async function takeOver(s: Scenario) {
  const owner = await acquireOwner({
    connectionString: s.testDb.config.connectionString!,
    schemaName: s.testDb.schema,
    ownerId: randomUUID(),
  });
  s.testDb.cleanupWith(() => owner.release());
  return owner;
}

describe('real PostgreSQL owner fencing and restart', () => {
  it('rejects a healthy overlapping process without changing the live owner or match', async () => {
    const s = (scenario = await createScenario());
    await prepareRound(s);
    const before = await durableRows(s.testDb.pool);
    await expect(takeOver(s)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(s.owner.isActive()).toBe(true);
    expect(await durableRows(s.testDb.pool)).toEqual(before);
    expect(
      (
        await drive(s, {
          type: 'player.disconnect',
          playerId: s.record.state.participants[0].playerId,
        })
      ).error,
    ).toBeNull();
  });

  it('rejects a lease whose lock session dies between takeover COMMIT and activation', async () => {
    const s = (scenario = await createScenario());
    await s.owner.release();
    await expect(
      acquireOwner({
        connectionString: s.testDb.config.connectionString!,
        schemaName: s.testDb.schema,
        ownerId: randomUUID(),
        hooks: async (point, context) => {
          if (point === 'after_commit') {
            expect(context.backendPid).toBeTypeOf('number');
            const result = await s.testDb.pool.query<{ terminated: boolean }>(
              'SELECT pg_terminate_backend($1, 1000) AS terminated',
              [context.backendPid],
            );
            expect(result.rows[0]?.terminated).toBe(true);
            // Flush the pg error/end event before acquisition can claim authority.
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
        },
      }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const next = await takeOver(s);
    expect(next.isActive()).toBe(true);
    expect(await s.store.interruptOrphans(next)).toBe(1);
  });

  it('waits for the previous guarded transaction and rejects its stale writer before aborting orphans', async () => {
    const s = (scenario = await createScenario());
    const prepared = await prepareRound(s);
    const actor = s.actor();
    const held = barrier(s.testDb);
    let hold = true;
    s.setFault(async (point) => {
      if (point === 'before_commit' && hold) {
        hold = false;
        await held.pause();
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
    await held.reached;
    await s.testDb.pool.query('SELECT pg_terminate_backend($1, 1000)', [
      s.owner.backendPid,
    ]);
    await eventually(
      async () => !s.owner.isActive(),
      'loss of advisory-lock session',
    );
    let acquired = false;
    const takeover = takeOver(s).then((owner) => {
      acquired = true;
      return owner;
    });
    await eventually(async () => {
      const rows = await s.testDb.pool.query<{ waiting: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE 'SELECT id FROM owner_control%') AS waiting",
      );
      return rows.rows[0]?.waiting === true;
    }, 'takeover waiting for the previous owner-row guard');
    expect(acquired).toBe(false);
    held.release();
    expect((await pending).ok).toBe(false);
    const next = await takeover;
    expect(await s.store.interruptOrphans(next)).toBe(1);
    const durable = await s.store.readCommitted(s.record.state.matchId);
    expect(durable?.state.phase).toBe('ABORTED');
    expect(durable?.state.interruption?.reason).toBe('SERVER_RESTART');
    expect(durable?.state.participants.map((p) => p.score)).toEqual([0, 0]);
    expect(durable?.state.countedAttempts).toEqual([]);
    expect(s.publications).toEqual([]);
  });

  it('can restart again after advancing the owner epoch but before the orphan sweep', async () => {
    const s = (scenario = await createScenario());
    await winRound(s);
    await prepareRound(s);
    await drive(s, {
      type: 'player.disconnect',
      playerId: s.record.state.participants[0].playerId,
    });
    const before = s.record;
    await s.owner.release();
    const interruptedOwner = await takeOver(s);
    await expect(
      s.store.createMatch({
        owner: interruptedOwner,
        operationId: randomUUID(),
        state: createFixtureMatch({ matchId: randomUUID() }),
      }),
    ).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    await interruptedOwner.release();
    const next = await takeOver(s);
    expect(next.token.epoch).toBe(interruptedOwner.token.epoch + 1n);
    expect(await s.store.interruptOrphans(next)).toBe(1);
    const after = (await s.store.readCommitted(before.state.matchId))!;
    expect(after.state.phase).toBe('ABORTED');
    expect(after.state.interruption?.reason).toBe('SERVER_RESTART');
    expect(after.state.stateVersion).toBe(before.state.stateVersion + 1);
    expect(after.state.lastInput).toEqual(before.state.lastInput);
    expect(after.state.lastResult).toEqual(before.state.lastResult);
    expect(after.state.countedAttempts).toEqual(before.state.countedAttempts);
    expect(after.state.participants.map((p) => p.score)).toEqual([1, 0]);
    const stable = await durableRows(s.testDb.pool);
    expect(await s.store.interruptOrphans(next)).toBe(0);
    expect(await durableRows(s.testDb.pool)).toEqual(stable);
  });

  it('recovers all 48 original ACKs after takeover and preserves another match history independently', async () => {
    const s = (scenario = await createScenario());
    const packets: {
      playerId: string;
      payload: {
        matchId: string;
        roundId: string;
        attemptId: string;
        text: string;
      };
      ack: unknown;
    }[] = [];
    for (let round = 0; round < 8; round += 1) {
      const prepared = await prepareRound(s);
      for (const player of s.record.state.participants) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const payload = {
            matchId: s.record.state.matchId,
            roundId: prepared.descriptor.roundId,
            attemptId: randomUUID(),
            text: `qa-wrong-${round}-${attempt}`,
          };
          const result = await drive(s, {
            type: 'answer.submit',
            playerId: player.playerId,
            payload,
          });
          expect(result.ack?.status).toBe('INCORRECT');
          packets.push({ playerId: player.playerId, payload, ack: result.ack });
        }
      }
      expect(s.record.state.phase).toBe('ACTIVE_TYPING');
      await persistCandidate(
        s,
        tickAt(s.record.state, prepared.monoSchedule.deadlineAt),
      );
    }
    const completed = s.record;
    expect(completed.state.phase).toBe('COMPLETED');
    expect(completed.state.completion?.draw).toBe(true);
    expect(completed.state.countedAttempts).toHaveLength(48);
    s.record = await s.store.createMatch({
      owner: s.owner,
      operationId: randomUUID(),
      state: createFixtureMatch({ matchId: randomUUID() }),
    });
    const otherRound = await prepareRound(s);
    await drive(s, {
      type: 'answer.submit',
      playerId: s.record.state.participants[1].playerId,
      payload: {
        matchId: s.record.state.matchId,
        roundId: otherRound.descriptor.roundId,
        attemptId: randomUUID(),
        text: 'qa-other-match-wrong',
      },
    });
    const other = s.record;
    await s.owner.release();
    const next = await takeOver(s);
    expect(await s.store.interruptOrphans(next)).toBe(1);
    const reloaded = (await s.store.readCommitted(completed.state.matchId))!;
    expect(reloaded).toEqual(completed);
    const otherReloaded = (await s.store.readCommitted(other.state.matchId))!;
    expect(otherReloaded.state.phase).toBe('ABORTED');
    expect(otherReloaded.state.countedAttempts).toEqual(
      other.state.countedAttempts,
    );
    const beforeRetry = await durableRows(s.testDb.pool);
    const actor = createMatchActor({
      store: s.store,
      owner: next,
      initial: reloaded,
      clock: new ManualClock(0),
      publish: () => {},
    });
    s.testDb.cleanupWith(() => actor.close());
    for (const packet of packets) {
      const result = await actor.acceptPlayerCommand(
        { playerId: packet.playerId },
        { type: 'answer.submit', payload: packet.payload },
      );
      expect(result.ack).toEqual(packet.ack);
    }
    for (const participant of completed.state.participants) {
      const snapshot = actor.getSnapshot(participant.playerId);
      expect(snapshot.ok).toBe(true);
      if (!snapshot.ok) throw new Error('Terminal snapshot unavailable');
      expect(snapshot.snapshot.viewer.countedAttempts).toHaveLength(24);
      expect(snapshot.snapshot.phase).toBe('COMPLETED');
    }
    expect(await durableRows(s.testDb.pool)).toEqual(beforeRetry);
  }, 30_000);

  it.each([9_999, 10_000])(
    'enforces disconnect grace on the trusted reconnect receipt at +%i ms',
    async (offset) => {
      const s = (scenario = await createScenario());
      const actor = s.actor();
      const playerId = s.record.state.participants[0].playerId;
      const disconnectedAt = s.clock.monoNow();
      await actor.acceptTrustedCommand({ type: 'player.disconnect', playerId });
      s.clock.set(disconnectedAt + offset);
      await actor.acceptTrustedCommand({ type: 'player.reconnect', playerId });
      const durable = (await s.store.readCommitted(s.record.state.matchId))!;
      expect(durable.state.phase).toBe(
        offset === 9_999 ? 'PREPARING_ROUND' : 'ABORTED',
      );
      expect(durable.state.participants.map((p) => p.score)).toEqual([0, 0]);
      expect(durable.state.completion).toBeNull();
      if (offset === 10_000) {
        expect(durable.state.interruption?.reason).toBe('DISCONNECT_TIMEOUT');
        const terminal = durable.state;
        s.clock.set(disconnectedAt + 20_000);
        await actor.wake();
        expect((await s.store.readCommitted(terminal.matchId))?.state).toEqual(
          terminal,
        );
      }
    },
  );
});

describe('real PostgreSQL process death boundaries', () => {
  it('fences an old process that remains alive while the new process waits for its guarded transaction', async () => {
    const testDb = (standalone = await createTestDatabase());
    const connectionString = testDb.config.connectionString!;
    await migrateDatabase({ connectionString, schemaName: testDb.schema });
    const database = createDatabase({
      connectionString,
      schemaName: testDb.schema,
    });
    testDb.cleanupWith(() => database.close());
    const store = createMatchStore({ database });
    const child = spawnActorChild(testDb);
    const initial = createFixtureMatch();
    const boot = await child.request<{ backendPid: number }>('boot', {
      schemaName: testDb.schema,
      state: initial,
    });
    await expect(
      acquireOwner({
        connectionString,
        schemaName: testDb.schema,
        ownerId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const original = (await store.readCommitted(initial.matchId))!;
    expect(original.state.phase).toBe('PREPARING_ROUND');
    await child.request('fault', { point: 'before_commit', action: 'pause' });
    const descriptor = createRoundDescriptor(initial);
    const oldWrite = settle(
      child.request('trusted', {
        command: { type: 'round.prepare', descriptor },
      }),
    );
    await child.reached('before_commit');
    await testDb.pool.query('SELECT pg_terminate_backend($1, 1000)', [
      boot.backendPid,
    ]);
    let acquired = false;
    const takingOver = acquireOwner({
      connectionString,
      schemaName: testDb.schema,
      ownerId: randomUUID(),
    }).then((owner) => {
      acquired = true;
      testDb.cleanupWith(() => owner.release());
      return owner;
    });
    await eventually(async () => {
      const result = await testDb.pool.query<{ waiting: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE 'SELECT id FROM owner_control%') AS waiting",
      );
      return result.rows[0]?.waiting === true;
    }, 'new process waiting for the live old process transaction guard');
    expect(acquired).toBe(false);
    expect(await store.readCommitted(initial.matchId)).toEqual(original);
    // This reply requires the original process to remain alive after lease loss.
    await child.request('release', { point: 'before_commit' });
    expect((await oldWrite).ok).toBe(false);
    const owner = await takingOver;
    expect(owner.token.epoch).toBe(original.owner.epoch + 1n);
    expect(await store.readCommitted(initial.matchId)).toEqual(original);
    expect(await store.interruptOrphans(owner)).toBe(1);
    const recovered = (await store.readCommitted(initial.matchId))!;
    expect(recovered.state.phase).toBe('ABORTED');
    expect(recovered.state.interruption?.reason).toBe('SERVER_RESTART');
    expect(recovered.state.roundNumber).toBe(0);
    expect(recovered.state.round).toBeNull();
    expect(recovered.state.countedAttempts).toEqual([]);
    expect(recovered.state.participants.map((p) => p.score)).toEqual([0, 0]);
    expect(
      (
        await testDb.pool.query(
          'SELECT 1 FROM match_rounds WHERE match_id = $1',
          [initial.matchId],
        )
      ).rows,
    ).toEqual([]);
    expect(child.publications).toEqual([]);
    await expect(
      child.request('snapshot', { playerId: initial.participants[0].playerId }),
    ).rejects.toThrow('Actor child operation failed');
    await expect(
      child.request('trusted', {
        command: { type: 'round.prepare', descriptor },
      }),
    ).rejects.toThrow('Actor child operation failed');
    expect(await store.readCommitted(initial.matchId)).toEqual(recovered);
  });

  it.each(['before_commit', 'after_commit', 'before_publish'] as const)(
    'recovers honestly after SIGKILL at %s of the deciding answer',
    async (point) => {
      const testDb = (standalone = await createTestDatabase());
      const connectionString = testDb.config.connectionString!;
      await migrateDatabase({ connectionString, schemaName: testDb.schema });
      const database = createDatabase({
        connectionString,
        schemaName: testDb.schema,
      });
      testDb.cleanupWith(() => database.close());
      const store = createMatchStore({ database });
      const child = spawnActorChild(testDb);
      const initial = createFixtureMatch();
      const boot = await child.request<{ backendPid: number }>('boot', {
        schemaName: testDb.schema,
        state: initial,
      });
      let saved: PersistedMatch = (await store.readCommitted(initial.matchId))!;
      let finalPacket:
        | { matchId: string; roundId: string; attemptId: string; text: string }
        | undefined;
      for (let round = 0; round < 5; round += 1) {
        const descriptor = createRoundDescriptor(saved.state);
        const scheduled = prepareReadyRound(saved.state, { descriptor });
        await child.request('trusted', {
          command: { type: 'round.prepare', descriptor },
        });
        for (const participant of saved.state.participants) {
          await child.request('player', {
            playerId: participant.playerId,
            command: {
              type: 'round.audio_ready',
              payload: {
                matchId: initial.matchId,
                roundId: descriptor.roundId,
                audioVersion: descriptor.audio.audioVersion,
              },
            },
          });
        }
        await child.request('wake', {
          at: scheduled.monoSchedule.typingStartAt,
        });
        finalPacket = {
          matchId: initial.matchId,
          roundId: descriptor.roundId,
          attemptId: randomUUID(),
          text: descriptor.canonicalText,
        };
        if (round === 4) break;
        await child.request('player', {
          playerId: initial.participants[0].playerId,
          command: { type: 'answer.submit', payload: finalPacket },
        });
        saved = (await store.readCommitted(initial.matchId))!;
      }
      const before = (await store.readCommitted(initial.matchId))!;
      const delivered = child.publications.length;
      await child.request('fault', { point, action: 'pause' });
      const pending = settle(
        child.request('player', {
          playerId: initial.participants[0].playerId,
          command: { type: 'answer.submit', payload: finalPacket },
        }),
      );
      await child.reached(point);
      expect(child.publications).toHaveLength(delivered);
      await child.kill();
      expect((await pending).ok).toBe(false);
      await eventually(
        async () =>
          (
            await testDb.pool.query(
              'SELECT 1 FROM pg_stat_activity WHERE pid = $1',
              [boot.backendPid],
            )
          ).rowCount === 0,
        'terminated child ownership session',
      );
      const next = await acquireOwner({
        connectionString,
        schemaName: testDb.schema,
        ownerId: randomUUID(),
      });
      testDb.cleanupWith(() => next.release());
      const afterKill = (await store.readCommitted(initial.matchId))!;
      if (point === 'before_commit') expect(afterKill).toEqual(before);
      else {
        expect(afterKill.state.phase).toBe('COMPLETED');
        expect(afterKill.state.participants.map((p) => p.score)).toEqual([
          5, 0,
        ]);
      }
      expect(await store.interruptOrphans(next)).toBe(
        point === 'before_commit' ? 1 : 0,
      );
      const recovered = (await store.readCommitted(initial.matchId))!;
      expect(recovered.state.phase).toBe(
        point === 'before_commit' ? 'ABORTED' : 'COMPLETED',
      );
      expect(recovered.state.participants.map((p) => p.score)).toEqual(
        point === 'before_commit' ? [4, 0] : [5, 0],
      );
      if (point === 'before_commit') {
        expect(recovered.state.completion).toBeNull();
        expect(recovered.state.lastResult).toEqual(before.state.lastResult);
        expect(recovered.state.interruption?.reason).toBe('SERVER_RESTART');
      } else {
        expect(recovered).toEqual(afterKill);
        const terminal = createMatchActor({
          store,
          owner: next,
          initial: recovered,
          clock: new ManualClock(0),
          publish: () => {},
        });
        testDb.cleanupWith(() => terminal.close());
        const original = recovered.state.countedAttempts.at(-1)!.ack;
        expect(
          (
            await terminal.acceptPlayerCommand(
              { playerId: initial.participants[0].playerId },
              { type: 'answer.submit', payload: finalPacket },
            )
          ).ack,
        ).toEqual(original);
      }
    },
    30_000,
  );
});
