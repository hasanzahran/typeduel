import { randomUUID } from 'node:crypto';
import { createDatabase } from '../../../../src/db/client.js';
import { acquireOwner } from '../../../../src/db/owner.js';
import { createMatchStore } from '../../../../src/db/match-store.js';
import { createMatchActor } from '../../../../src/game/actor.js';
import type { FaultHook, FaultPoint } from '../../../../src/db/types.js';
import type { MatchState } from '../../../../src/game/types.js';
import { ManualClock, deferred } from './harness.js';

let database: ReturnType<typeof createDatabase> | undefined;
let owner: Awaited<ReturnType<typeof acquireOwner>> | undefined;
let actor: ReturnType<typeof createMatchActor> | undefined;
let clock: ManualClock | undefined;
let fault:
  | { point: FaultPoint; action: 'pause' | 'throw'; remaining: number }
  | undefined;
const releases = new Map<string, ReturnType<typeof deferred<void>>>();
const hook: FaultHook = async (point) => {
  if (!fault || fault.point !== point || --fault.remaining > 0) return;
  const action = fault.action;
  fault = undefined;
  if (action === 'throw') throw new Error('qa-simulated-response-loss');
  const gate = deferred<void>();
  releases.set(point, gate);
  process.send?.({ kind: 'barrier', point });
  await gate.promise;
};

interface Request {
  id: number;
  action: string;
  payload: Record<string, unknown>;
}
async function dispatch(request: Request): Promise<unknown> {
  const p = request.payload;
  if (request.action === 'boot') {
    const connectionString = process.env.TEST_DATABASE_URL;
    if (!connectionString) throw new Error('TEST_DATABASE_URL required');
    const schemaName = p.schemaName as string;
    const state = p.state as MatchState;
    database = createDatabase({ connectionString, schemaName });
    owner = await acquireOwner({
      connectionString,
      schemaName,
      ownerId: randomUUID(),
    });
    const store = createMatchStore({ database, hooks: hook });
    await store.interruptOrphans(owner);
    const initial = await store.createMatch({
      owner,
      operationId: randomUUID(),
      state,
    });
    clock = new ManualClock(
      state.lastInput.atMonoMs,
      state.clockAnchor.utcEpochMs,
      state.clockAnchor.monoMs,
    );
    actor = createMatchActor({
      store,
      owner,
      initial,
      clock,
      hooks: hook,
      publish: (viewerId, update) =>
        process.send?.({ kind: 'publication', viewerId, update }),
    });
    return {
      backendPid: owner.backendPid,
      token: owner.token,
      state: initial.state,
    };
  }
  if (request.action === 'fault') {
    fault = {
      point: p.point as FaultPoint,
      action: p.action as 'pause' | 'throw',
      remaining: (p.occurrence as number | undefined) ?? 1,
    };
    return null;
  }
  if (request.action === 'release') {
    releases.get(p.point as string)?.resolve();
    return null;
  }
  if (!actor || !clock) throw new Error('Actor child is not booted');
  if (typeof p.at === 'number') clock.set(p.at);
  if (request.action === 'trusted')
    return actor.acceptTrustedCommand(
      p.command as Parameters<typeof actor.acceptTrustedCommand>[0],
    );
  if (request.action === 'player')
    return actor.acceptPlayerCommand(
      { playerId: p.playerId as string },
      p.command as Parameters<typeof actor.acceptPlayerCommand>[1],
    );
  if (request.action === 'wake') return actor.wake();
  if (request.action === 'snapshot')
    return actor.getSnapshot(p.playerId as string);
  if (request.action === 'reconcile') {
    await actor.reconcile();
    return null;
  }
  throw new Error('Unknown child test action');
}

process.on('message', (message: Request) => {
  void dispatch(message).then(
    (value) =>
      process.send?.({ kind: 'reply', id: message.id, ok: true, value }),
    () =>
      process.send?.({
        kind: 'reply',
        id: message.id,
        ok: false,
        error: 'Actor child operation failed',
      }),
  );
});
