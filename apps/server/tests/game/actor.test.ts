import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createMatchActor } from '../../src/game/actor.js';
import { interruptForServerRestart } from '../../src/game/engine.js';
import {
  StoreError,
  type CommitInput,
  type MatchStore,
  type OwnerLease,
  type PersistedMatch,
} from '../../src/db/types.js';
import type { MatchState } from '../../src/game/types.js';
import {
  createFixtureMatch,
  prepareReadyRound,
  submit,
  tickAt,
} from './fixtures.js';

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function harness(state?: MatchState) {
  const prepared = prepareReadyRound(createFixtureMatch());
  let record: PersistedMatch = {
    state:
      state ??
      tickAt(prepared.state, prepared.monoSchedule.typingStartAt).state,
    storeRevision: 1n,
    lastOperationId: randomUUID(),
    owner: { ownerId: randomUUID(), epoch: 1n },
  };
  let now = record.state.lastInput.atMonoMs;
  let active = true;
  const listeners = new Set<() => void>();
  const owner: OwnerLease = {
    token: { ...record.owner },
    schemaName: 'test_only',
    backendPid: 0,
    isActive: () => active,
    onLost(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async release() {
      active = false;
      for (const listener of listeners) listener();
    },
  };
  const save = async (input: CommitInput) => {
    record = {
      state: structuredClone(input.candidate.state),
      storeRevision: input.expectedRevision + 1n,
      lastOperationId: input.operationId,
      owner: { ...owner.token },
    };
    return structuredClone(record);
  };
  const store: MatchStore = {
    createMatch: vi.fn(async () => {
      throw new Error('Unused fixture path');
    }),
    commitTransition: vi.fn(save),
    readCommitted: vi.fn(async () => structuredClone(record)),
    resolveOperation: vi.fn(async () => ({
      status: 'committed' as const,
      match: structuredClone(record),
    })),
    interruptOrphans: vi.fn(async () => 0),
  };
  const timers = new Set<() => void>();
  const clock = {
    monoNow: () => now,
    utcNow: () =>
      record.state.clockAnchor.utcEpochMs +
      now -
      record.state.clockAnchor.monoMs,
    schedule(_at: number, callback: () => void) {
      timers.add(callback);
      return () => {
        timers.delete(callback);
      };
    },
  };
  const publish = vi.fn();
  const actor = () =>
    createMatchActor({ store, owner, initial: record, clock, publish });
  return {
    prepared,
    owner,
    store,
    clock,
    timers,
    publish,
    save,
    actor,
    get record() {
      return record;
    },
    set now(value: number) {
      now = value;
    },
    packet(text = 'private-guess') {
      return {
        type: 'answer.submit' as const,
        payload: {
          matchId: record.state.matchId,
          roundId: record.state.round!.roundId,
          attemptId: randomUUID(),
          text,
        },
      };
    },
  };
}

describe('serialized authoritative actor', () => {
  it('keeps queued input detached and hides a point until its transaction commits', async () => {
    const h = harness();
    const gate = deferred();
    vi.mocked(h.store.commitTransition).mockImplementationOnce(
      async (input) => {
        await gate.promise;
        return h.save(input);
      },
    );
    const actor = h.actor();
    const packet = h.packet(h.prepared.descriptor.canonicalText);
    const result = actor.acceptPlayerCommand(
      { playerId: h.record.state.participants[0].playerId },
      packet,
    );
    packet.payload.text = 'mutated-after-admission';
    expect(h.publish).not.toHaveBeenCalled();
    const before = actor.getSnapshot(h.record.state.participants[0].playerId);
    expect(before.ok && before.snapshot.participants[0].score).toBe(0);
    gate.release();
    expect((await result).ack?.status).toBe('CORRECT');
    expect(h.record.state.participants[0].score).toBe(1);
    expect(h.publish).toHaveBeenCalledTimes(2);
    actor.close();
  });

  it('blocks successors during uncertain COMMIT and recovers the original ACK once', async () => {
    const h = harness();
    vi.mocked(h.store.commitTransition).mockImplementationOnce(
      async (input) => {
        await h.save(input);
        throw new StoreError('COMMIT_UNKNOWN');
      },
    );
    vi.mocked(h.store.resolveOperation).mockResolvedValue({
      status: 'unresolved',
    });
    const actor = h.actor();
    const playerId = h.record.state.participants[0].playerId;
    const packet = h.packet();
    const first = actor.acceptPlayerCommand({ playerId }, packet);
    const second = actor.acceptPlayerCommand({ playerId }, h.packet());
    await vi.waitFor(() =>
      expect(h.store.resolveOperation).toHaveBeenCalledTimes(1),
    );
    expect(h.store.commitTransition).toHaveBeenCalledTimes(1);
    expect(h.publish).not.toHaveBeenCalled();
    const committed = structuredClone(h.record);
    vi.mocked(h.store.resolveOperation).mockResolvedValue({
      status: 'committed',
      match: committed,
    });
    await actor.reconcile();
    const original = (await first).ack;
    expect(original?.status).toBe('INCORRECT');
    expect((await second).ack?.attemptsRemaining).toBe(1);
    expect((await actor.acceptPlayerCommand({ playerId }, packet)).ack).toEqual(
      original,
    );
    expect(h.record.state.countedAttempts).toHaveLength(2);
    actor.close();
  });

  it('retries a known rollback with the same operation and original receipt', async () => {
    const h = harness();
    const initialTime = h.record.state.lastInput.atMonoMs;
    vi.mocked(h.store.commitTransition).mockImplementationOnce(async () => {
      h.now = h.prepared.monoSchedule.deadlineAt + 100;
      throw new StoreError('ROLLED_BACK');
    });
    const actor = h.actor();
    expect(
      (
        await actor.acceptPlayerCommand(
          { playerId: h.record.state.participants[0].playerId },
          h.packet(),
        )
      ).ack?.status,
    ).toBe('INCORRECT');
    const calls = vi.mocked(h.store.commitTransition).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![0].operationId).toBe(calls[1]![0].operationId);
    expect(h.record.state.lastInput.atMonoMs).toBe(initialTime);
    actor.close();
  });

  it('recovers terminal ACKs without comparing new process time or writing terminal state', async () => {
    const base = harness();
    const packet = base.packet();
    const playerId = base.record.state.participants[0].playerId;
    const counted = submit(base.record.state, playerId, {
      attemptId: packet.payload.attemptId,
      text: packet.payload.text,
      atMonoMs: base.record.state.lastInput.atMonoMs,
    });
    const h = harness(interruptForServerRestart(counted.state).state);
    h.now = 1;
    h.record.owner = { ownerId: randomUUID(), epoch: 0n };
    const actor = h.actor();
    expect((await actor.acceptPlayerCommand({ playerId }, packet)).ack).toEqual(
      counted.ack,
    );
    expect(h.store.commitTransition).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.record.state.interruption?.reason).toBe('SERVER_RESTART');
    actor.close();
  });

  it('returns only public ACK/error and isolates each viewer history', async () => {
    const h = harness();
    const actor = h.actor();
    const result = await actor.acceptPlayerCommand(
      { playerId: h.record.state.participants[0].playerId },
      h.packet(),
    );
    expect(Object.keys(result).sort()).toEqual(['ack', 'error']);
    const serialized = JSON.stringify([result, h.publish.mock.calls]);
    for (const forbidden of [
      'private-guess',
      'fingerprint',
      'canonicalText',
      'checkpoint',
      'wordId',
      'lastInput',
    ])
      expect(serialized).not.toContain(forbidden);
    const updates = h.publish.mock.calls.map((call) => call[1]);
    expect(
      updates.map((update) => update.snapshot.viewer.countedAttempts.length),
    ).toEqual([1, 0]);
    actor.close();
  });

  it('does not roll back or repeat an outcome when a publication observer fails', async () => {
    const h = harness();
    h.publish.mockImplementation(() => {
      throw new Error('Observer failure');
    });
    const actor = h.actor();
    const playerId = h.record.state.participants[0].playerId;
    const packet = h.packet(h.prepared.descriptor.canonicalText);
    const first = await actor.acceptPlayerCommand({ playerId }, packet);
    expect((await actor.acceptPlayerCommand({ playerId }, packet)).ack).toEqual(
      first.ack,
    );
    expect(h.record.state.participants[0].score).toBe(1);
    expect(h.record.state.countedAttempts).toHaveLength(1);
    expect(h.publish).toHaveBeenCalledTimes(2);
    actor.close();
  });

  it('captures actual timer callback receipt rather than backdating to a deadline', async () => {
    const h = harness();
    const actor = h.actor();
    h.now = h.prepared.monoSchedule.deadlineAt + 300;
    [...h.timers][0]!();
    await vi.waitFor(() => expect(h.record.state.phase).toBe('ROUND_RESULT'));
    expect(h.record.state.lastInput.atMonoMs).toBe(
      h.prepared.monoSchedule.deadlineAt + 300,
    );
    expect(h.record.state.participants.map((p) => p.score)).toEqual([0, 0]);
    actor.close();
  });
});
