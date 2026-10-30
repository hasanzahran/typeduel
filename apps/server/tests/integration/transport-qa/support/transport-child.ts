import { randomUUID } from 'node:crypto';
import { createRemoteJWKSet } from 'jose';
import { createDatabase } from '../../../../src/db/client.js';
import { acquireOwner } from '../../../../src/db/owner.js';
import { createMatchStore } from '../../../../src/db/match-store.js';
import { createGameRuntime } from '../../../../src/runtime.js';
import { createJwtVerifier } from '../../../../src/auth/verifier.js';
import type { FaultHook, FaultPoint } from '../../../../src/db/types.js';
import {
  createSource,
  deferred,
  ManualClock,
  RESULT_HOLD_MS,
} from './harness.js';

let runtime: Awaited<ReturnType<typeof createGameRuntime>> | undefined;
let clock: ManualClock | undefined;
let fault: { point: FaultPoint; action: 'pause' | 'throw' } | undefined;
const gates = new Map<string, ReturnType<typeof deferred<void>>>();
const drops = new Set<string>();
const hooks: FaultHook = async (point) => {
  if (fault?.point !== point) return;
  const action = fault.action;
  fault = undefined;
  if (action === 'throw') throw new Error('qa-private-simulated-loss');
  const gate = deferred<void>();
  gates.set(point, gate);
  process.send?.({ kind: 'barrier', point });
  await gate.promise;
};
async function dispatch(
  action: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  if (action === 'boot') {
    const connectionString = process.env.TEST_DATABASE_URL;
    if (!connectionString) throw new Error('TEST_DATABASE_URL required');
    const schemaName = payload.schemaName as string;
    clock = new ManualClock((payload.monoMs as number | undefined) ?? 1_000);
    const database = createDatabase({ connectionString, schemaName });
    const owner = await acquireOwner({
      connectionString,
      schemaName,
      ownerId: randomUUID(),
    });
    const store = createMatchStore({ database, hooks });
    const verifier = createJwtVerifier({
      issuer: payload.issuer as string,
      audience: 'authenticated',
      key: createRemoteJWKSet(new URL(payload.jwksUrl as string), {
        cooldownDuration: 0,
        timeoutDuration: 1_000,
      }),
      nowUtcMs: () => clock!.utcNow(),
    });
    runtime = await createGameRuntime({
      database,
      owner,
      store,
      verifier,
      clock,
      source: createSource().source,
      config: { resultHoldMs: RESULT_HOLD_MS, reconcileIntervalMs: 10 },
      hooks: {
        actor: hooks,
        outbound: (packet) =>
          drops.has(`${packet.kind}:${packet.event}`) ? 'drop' : 'send',
      },
    });
    return {
      origin: await runtime.listen({ host: '127.0.0.1', port: 0 }),
      backendPid: owner.backendPid,
    };
  }
  if (action === 'fault') {
    fault = {
      point: payload.point as FaultPoint,
      action: payload.action as 'pause' | 'throw',
    };
    return null;
  }
  if (action === 'release') {
    gates.get(payload.point as string)?.resolve();
    return null;
  }
  if (action === 'drop') {
    drops.add(`${payload.kind as string}:${payload.event as string}`);
    return null;
  }
  if (!runtime || !clock) throw new Error('Child not booted');
  if (action === 'advance') {
    clock.set(payload.at as number, true);
    await runtime.reconcile();
    return null;
  }
  if (action === 'reconcile') {
    await runtime.reconcile();
    return null;
  }
  throw new Error('Unknown child action');
}
process.on(
  'message',
  (message: {
    id: number;
    action: string;
    payload: Record<string, unknown>;
  }) => {
    void dispatch(message.action, message.payload).then(
      (value) =>
        process.send?.({ kind: 'reply', id: message.id, ok: true, value }),
      () => process.send?.({ kind: 'reply', id: message.id, ok: false }),
    );
  },
);
