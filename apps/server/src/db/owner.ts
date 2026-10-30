import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { z } from 'zod';
import { connectionConfig, validateSchemaName } from './client.js';
import {
  StoreError,
  type FaultHook,
  type OwnerLease,
  type OwnerToken,
} from './types.js';

export async function acquireOwner(options: {
  connectionString: string;
  schemaName?: string;
  ownerId: string;
  hooks?: FaultHook;
}): Promise<OwnerLease> {
  if (!z.uuid().safeParse(options.ownerId).success)
    throw new StoreError('INVALID_STATE');
  const schemaName = validateSchemaName(options.schemaName);
  // Advisory locks are already database-local; the key separates private schemas.
  const key = createHash('sha256')
    .update(`typeduel-owner:${schemaName}`)
    .digest()
    .readBigInt64BE()
    .toString();
  const client = new Client(connectionConfig({ ...options, schemaName }));
  let active = false;
  let lossObserved = false;
  const listeners = new Set<() => void>();
  const lost = () => {
    lossObserved = true;
    if (!active) return;
    active = false;
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* An observer cannot restore ownership. */
      }
    }
  };
  client.on('error', lost);
  client.on('end', lost);
  try {
    await client.connect();
    await options.hooks?.('before_owner_lock', {});
    const lock = await client.query<{ acquired: boolean; pid: number }>(
      'SELECT pg_try_advisory_lock($1::bigint) AS acquired, pg_backend_pid() AS pid',
      [key],
    );
    if (!lock.rows[0]?.acquired) throw new StoreError('CONFLICT');
    await client.query('BEGIN');
    await client.query('SELECT id FROM owner_control WHERE id = 1 FOR UPDATE');
    const updated = await client.query<{ epoch: string }>(
      'UPDATE owner_control SET owner_id = $1, epoch = epoch + 1, ready = false WHERE id = 1 RETURNING epoch',
      [options.ownerId],
    );
    if (!updated.rows[0]) throw new StoreError('INVALID_STATE');
    await options.hooks?.('after_dml', { statement: 'owner_takeover' });
    await options.hooks?.('before_commit', {});
    await client.query('COMMIT');
    await options.hooks?.('after_commit', {
      statement: 'owner_takeover',
      backendPid: lock.rows[0].pid,
    });
    if (lossObserved) throw new StoreError('UNAVAILABLE');
    const token: OwnerToken = Object.freeze({
      ownerId: options.ownerId,
      epoch: BigInt(updated.rows[0].epoch),
    });
    active = true;
    return {
      token,
      backendPid: lock.rows[0].pid,
      schemaName,
      isActive: () => active,
      onLost(listener) {
        listeners.add(listener);
        if (!active) listener();
        return () => {
          listeners.delete(listener);
        };
      },
      async release() {
        lost();
        await client.end().catch(() => {});
      },
    };
  } catch (error) {
    await client.end().catch(() => {});
    if (error instanceof StoreError) throw error;
    throw new StoreError('UNAVAILABLE');
  }
}
