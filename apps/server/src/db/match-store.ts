import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AnswerAckSchema, TransitionBatchSchema } from '@typeduel/contracts';
import { interruptForServerRestart } from '../game/engine.js';
import { toUtc } from '../game/rules.js';
import type { MatchState } from '../game/types.js';
import type { PoolClient } from 'pg';
import type { Database } from './client.js';
import { decodeCheckpoint, encodeCheckpoint } from './checkpoint.js';
import {
  StoreError,
  type FaultContext,
  type FaultHook,
  type MatchStore,
  type OwnerLease,
  type PersistedMatch,
} from './types.js';

interface MatchRow {
  checkpoint: unknown;
  store_revision: string;
  state_version: string;
  last_operation_id: string;
  owner_id: string;
  owner_epoch: string;
}
const columns =
  'checkpoint, store_revision, state_version, last_operation_id, owner_id, owner_epoch';
// Shared across store adapters using one live lease; entries exist only while a
// write promise is running, including before it acquires its first SQL lock.
const activeOperations = new WeakMap<OwnerLease, Set<string>>();
function operationsFor(owner: OwnerLease): Set<string> {
  let operations = activeOperations.get(owner);
  if (!operations) {
    operations = new Set();
    activeOperations.set(owner, operations);
  }
  return operations;
}
function decodeRow(row: MatchRow): PersistedMatch {
  const state = decodeCheckpoint(row.checkpoint);
  if (BigInt(row.state_version) !== BigInt(state.stateVersion))
    throw new StoreError('INVALID_STATE');
  return {
    state,
    storeRevision: BigInt(row.store_revision),
    lastOperationId: row.last_operation_id,
    owner: { ownerId: row.owner_id, epoch: BigInt(row.owner_epoch) },
  };
}
function dateAt(state: MatchState, monoMs: number): Date {
  const value = new Date(toUtc(state.clockAnchor, monoMs));
  if (!Number.isFinite(value.getTime())) throw new StoreError('INVALID_STATE');
  return value;
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
function validateProgress(previous: MatchState, next: MatchState): void {
  if (
    previous.matchId !== next.matchId ||
    !same(previous.setup, next.setup) ||
    !same(previous.clockAnchor, next.clockAnchor) ||
    !same(previous.config, next.config) ||
    !same(
      previous.participants.map((p) => p.playerId),
      next.participants.map((p) => p.playerId),
    ) ||
    next.stateVersion < previous.stateVersion ||
    next.lastInput.ingressSequence <= previous.lastInput.ingressSequence ||
    next.lastInput.atMonoMs < previous.lastInput.atMonoMs ||
    next.roundNumber < previous.roundNumber ||
    next.roundNumber > previous.roundNumber + 1 ||
    !same(
      previous.countedAttempts,
      next.countedAttempts.slice(0, previous.countedAttempts.length),
    ) ||
    next.countedAttempts.length > previous.countedAttempts.length + 1 ||
    !same(
      previous.usedRoundIds,
      next.usedRoundIds.slice(0, previous.usedRoundIds.length),
    ) ||
    !same(
      previous.usedWordIds,
      next.usedWordIds.slice(0, previous.usedWordIds.length),
    )
  )
    throw new StoreError('INVALID_STATE');
  if (previous.phase === 'COMPLETED' || previous.phase === 'ABORTED') {
    const { lastInput: _before, ...before } = previous;
    const { lastInput: _after, ...after } = next;
    void _before;
    void _after;
    if (!same(before, after)) throw new StoreError('INVALID_STATE');
  }
}

export function createMatchStore(options: {
  database: Database;
  hooks?: FaultHook;
}): MatchStore {
  const { database, hooks } = options;
  async function lockOwner(
    client: PoolClient,
    owner: OwnerLease,
    context: FaultContext,
    exclusive = false,
    allowUnready = false,
  ): Promise<void> {
    if (!owner.isActive() || owner.schemaName !== database.schemaName)
      throw new StoreError('FENCED');
    await hooks?.('before_owner_lock', context);
    const row = (
      await client.query<{ owner_id: string; epoch: string; ready: boolean }>(
        `SELECT owner_id, epoch, ready FROM owner_control WHERE id = 1 FOR ${exclusive ? 'UPDATE' : 'SHARE'}`,
      )
    ).rows[0];
    if (
      !owner.isActive() ||
      !row ||
      row.owner_id !== owner.token.ownerId ||
      BigInt(row.epoch) !== owner.token.epoch
    )
      throw new StoreError('FENCED');
    if (!allowUnready && !row.ready) throw new StoreError('RECOVERY_REQUIRED');
  }
  async function transaction<T>(
    owner: OwnerLease,
    context: FaultContext,
    run: (client: PoolClient) => Promise<T>,
    settings: {
      exclusive?: boolean;
      allowUnready?: boolean;
      commitHooks?: boolean;
    } = {},
  ): Promise<T> {
    const inFlight = operationsFor(owner);
    const key =
      context.operationId && settings.commitHooks !== false
        ? `${context.matchId}:${context.operationId}`
        : null;
    if (key && inFlight.has(key)) throw new StoreError('CONFLICT');
    if (key) inFlight.add(key);
    let client: PoolClient;
    try {
      client = await database.pool.connect();
    } catch {
      if (key) inFlight.delete(key);
      throw new StoreError('UNAVAILABLE');
    }
    let commitSent = false;
    let committed = false;
    let destroy = false;
    try {
      await client.query('BEGIN');
      await lockOwner(
        client,
        owner,
        context,
        settings.exclusive,
        settings.allowUnready,
      );
      const result = await run(client);
      if (settings.commitHooks !== false)
        await hooks?.('before_commit', context);
      if (!owner.isActive()) throw new StoreError('FENCED');
      commitSent = true;
      await client.query('COMMIT');
      committed = true;
      if (settings.commitHooks !== false)
        await hooks?.('after_commit', context);
      return result;
    } catch (error) {
      if (commitSent) throw new StoreError('COMMIT_UNKNOWN');
      try {
        await client.query('ROLLBACK');
      } catch {
        destroy = true;
        throw new StoreError('COMMIT_UNKNOWN');
      }
      if (error instanceof StoreError) throw error;
      if (error instanceof Error && 'code' in error && error.code === '23505')
        throw new StoreError('CONFLICT');
      if (
        error instanceof Error &&
        'code' in error &&
        ['23503', '23514', '23502'].includes(String(error.code))
      )
        throw new StoreError('INVALID_STATE');
      throw new StoreError('ROLLED_BACK');
    } finally {
      // A connection with an uncertain COMMIT is never reused for another match.
      client.release(destroy || (commitSent && !committed));
      if (key) inFlight.delete(key);
    }
  }
  async function dml(
    client: PoolClient,
    context: FaultContext,
    statement: string,
    sql: string,
    values: unknown[],
  ): Promise<void> {
    const written = await client.query(sql, values);
    if (written.rowCount !== 1) throw new StoreError('CONFLICT');
    await hooks?.('after_dml', { ...context, statement });
  }
  async function selectMatch(
    client: PoolClient,
    matchId: string,
    context: FaultContext,
  ): Promise<PersistedMatch | null> {
    await hooks?.('before_match_lock', context);
    const row = (
      await client.query<MatchRow>(
        `SELECT ${columns} FROM matches WHERE id = $1 FOR UPDATE`,
        [matchId],
      )
    ).rows[0];
    return row ? decodeRow(row) : null;
  }
  async function categoryId(
    client: PoolClient,
    state: MatchState,
  ): Promise<string> {
    const row = (
      await client.query<{ id: string }>(
        'SELECT id FROM categories WHERE slug = $1',
        [state.setup.categorySlug],
      )
    ).rows[0];
    if (!row) throw new StoreError('INVALID_STATE');
    return row.id;
  }
  async function writeRound(
    client: PoolClient,
    state: MatchState,
    category: string,
    context: FaultContext,
  ): Promise<void> {
    const round = state.round;
    if (!round) return;
    const schedule = round.monoSchedule;
    const result =
      state.lastResult?.roundId === round.roundId ? state.lastResult : null;
    await dml(
      client,
      context,
      'upsert_round',
      `INSERT INTO match_rounds (id,match_id,category_id,round_number,word_id,audio_asset_id,level,playback_at,typing_start_at,deadline_at,winner_id,result)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO UPDATE SET playback_at=EXCLUDED.playback_at,typing_start_at=EXCLUDED.typing_start_at,deadline_at=EXCLUDED.deadline_at,winner_id=EXCLUDED.winner_id,result=EXCLUDED.result
      WHERE match_rounds.match_id=EXCLUDED.match_id`,
      [
        round.roundId,
        state.matchId,
        category,
        round.roundNumber,
        round.wordId,
        round.audio.assetId,
        round.level,
        schedule ? dateAt(state, schedule.playbackAt) : null,
        schedule ? dateAt(state, schedule.typingStartAt) : null,
        schedule ? dateAt(state, schedule.deadlineAt) : null,
        result?.winnerId ?? null,
        result,
      ],
    );
  }
  async function updateMatch(
    client: PoolClient,
    owner: OwnerLease,
    state: MatchState,
    revision: bigint,
    operationId: string,
    context: FaultContext,
  ): Promise<PersistedMatch> {
    await dml(
      client,
      context,
      'update_match',
      `UPDATE matches SET player1_score=$2,player2_score=$3,status=$4,current_level=$5,round_number=$6,winner_id=$7,is_draw=$8,interruption_reason=$9,owner_id=$10,owner_epoch=$11,store_revision=$12,state_version=$13,last_operation_id=$14,checkpoint=$15,updated_at=clock_timestamp() WHERE id=$1`,
      [
        state.matchId,
        state.participants[0].score,
        state.participants[1].score,
        state.phase,
        state.currentLevel,
        state.roundNumber,
        state.completion?.winnerId ?? null,
        state.completion?.draw ?? false,
        state.interruption?.reason ?? null,
        owner.token.ownerId,
        owner.token.epoch.toString(),
        revision.toString(),
        state.stateVersion,
        operationId,
        encodeCheckpoint(state),
      ],
    );
    return {
      state: structuredClone(state),
      storeRevision: revision,
      lastOperationId: operationId,
      owner: { ...owner.token },
    };
  }
  const store: MatchStore = {
    async createMatch({ owner, operationId, state: input }) {
      if (!z.uuid().safeParse(operationId).success)
        throw new StoreError('INVALID_STATE');
      const state = encodeCheckpoint(input).state;
      if (
        state.roundNumber !== 0 ||
        state.phase !== 'PREPARING_ROUND' ||
        state.stateVersion !== 0 ||
        state.countedAttempts.length !== 0 ||
        state.round !== null
      )
        throw new StoreError('INVALID_STATE');
      const context = { operationId, matchId: state.matchId };
      return transaction(owner, context, async (client) => {
        const previous = await selectMatch(client, state.matchId, context);
        if (previous) {
          if (
            previous.lastOperationId === operationId &&
            same(previous.state, state) &&
            previous.owner.ownerId === owner.token.ownerId &&
            previous.owner.epoch === owner.token.epoch
          )
            return previous;
          throw new StoreError('CONFLICT');
        }
        const category = await categoryId(client, state);
        await dml(
          client,
          context,
          'insert_match',
          `INSERT INTO matches (id,category_id,setup,player1_id,player2_id,player1_score,player2_score,status,current_level,round_number,winner_id,is_draw,interruption_reason,owner_id,owner_epoch,store_revision,state_version,last_operation_id,checkpoint)
          VALUES ($1,$2,$3,$4,$5,0,0,$6,$7,0,NULL,false,NULL,$8,$9,1,0,$10,$11)`,
          [
            state.matchId,
            category,
            state.setup,
            state.participants[0].playerId,
            state.participants[1].playerId,
            state.phase,
            state.currentLevel,
            owner.token.ownerId,
            owner.token.epoch.toString(),
            operationId,
            encodeCheckpoint(state),
          ],
        );
        for (const [index, participant] of state.participants.entries())
          await dml(
            client,
            context,
            'insert_participant',
            'INSERT INTO match_participants (match_id,player_id,slot) VALUES ($1,$2,$3)',
            [state.matchId, participant.playerId, index + 1],
          );
        return {
          state,
          storeRevision: 1n,
          lastOperationId: operationId,
          owner: { ...owner.token },
        };
      });
    },
    async commitTransition({
      owner,
      matchId,
      expectedRevision,
      operationId,
      candidate,
    }) {
      if (
        !z.uuid().safeParse(operationId).success ||
        !z.uuid().safeParse(matchId).success
      )
        throw new StoreError('INVALID_STATE');
      const state = encodeCheckpoint(candidate.state).state;
      if (
        state.matchId !== matchId ||
        candidate.batches.some(
          (batch) => !TransitionBatchSchema.safeParse(batch).success,
        ) ||
        (candidate.ack && !AnswerAckSchema.safeParse(candidate.ack).success)
      )
        throw new StoreError('INVALID_STATE');
      const context = { operationId, matchId };
      return transaction(owner, context, async (client) => {
        const previous = await selectMatch(client, matchId, context);
        if (
          !previous ||
          previous.owner.ownerId !== owner.token.ownerId ||
          previous.owner.epoch !== owner.token.epoch
        )
          throw new StoreError('FENCED');
        if (previous.lastOperationId === operationId) {
          if (
            previous.storeRevision === expectedRevision + 1n &&
            same(previous.state, state)
          )
            return previous;
          throw new StoreError('CONFLICT');
        }
        if (previous.storeRevision !== expectedRevision)
          throw new StoreError('CONFLICT');
        validateProgress(previous.state, state);
        if (
          state.stateVersion - previous.state.stateVersion !==
            candidate.batches.length ||
          candidate.batches.some(
            (batch, index) =>
              batch.stateVersion !== previous.state.stateVersion + index + 1 ||
              batch.events.some((event) => event.matchId !== matchId),
          )
        )
          throw new StoreError('INVALID_STATE');
        if (state.stateVersion === previous.state.stateVersion) {
          const { lastInput: _oldInput, ...before } = previous.state;
          const { lastInput: _newInput, ...after } = state;
          void _oldInput;
          void _newInput;
          if (!same(before, after)) throw new StoreError('INVALID_STATE');
        }
        const category = await categoryId(client, state);
        await writeRound(client, state, category, context);
        for (const attempt of state.countedAttempts.slice(
          previous.state.countedAttempts.length,
        ))
          await dml(
            client,
            context,
            'insert_attempt',
            `INSERT INTO answer_attempts (match_id,round_id,player_id,attempt_id,attempt_number,fingerprint,original_ack,received_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              matchId,
              attempt.ack.roundId,
              attempt.playerId,
              attempt.ack.attemptId,
              3 - attempt.ack.attemptsRemaining,
              attempt.fingerprint,
              attempt.ack,
              dateAt(state, state.lastInput.atMonoMs),
            ],
          );
        return updateMatch(
          client,
          owner,
          state,
          expectedRevision + 1n,
          operationId,
          context,
        );
      });
    },
    async readCommitted(matchId) {
      if (!z.uuid().safeParse(matchId).success)
        throw new StoreError('INVALID_STATE');
      try {
        const row = (
          await database.pool.query<MatchRow>(
            `SELECT ${columns} FROM matches WHERE id=$1`,
            [matchId],
          )
        ).rows[0];
        return row ? decodeRow(row) : null;
      } catch (error) {
        if (error instanceof StoreError) throw error;
        throw new StoreError('UNAVAILABLE');
      }
    },
    async resolveOperation({ owner, matchId, operationId, expectedRevision }) {
      if (operationsFor(owner).has(`${matchId}:${operationId}`))
        return { status: 'unresolved' };
      try {
        // This exclusive owner barrier also covers a still-uncommitted first INSERT.
        // A missing row before the barrier is not evidence of rollback.
        return await transaction(
          owner,
          { operationId, matchId },
          async (client) => {
            const current = await selectMatch(client, matchId, {
              operationId,
              matchId,
            });
            // A takeover may leave terminal rows attached to their original
            // owner. They remain readable, but cannot resolve a new owner's write.
            if (
              current &&
              (current.owner.ownerId !== owner.token.ownerId ||
                current.owner.epoch !== owner.token.epoch)
            )
              return { status: 'fenced' as const };
            if (
              current?.lastOperationId === operationId &&
              current.storeRevision === expectedRevision + 1n
            )
              return { status: 'committed' as const, match: current };
            if (
              (!current && expectedRevision === 0n) ||
              current?.storeRevision === expectedRevision
            )
              return { status: 'rolled_back' as const };
            return { status: 'unresolved' as const };
          },
          { exclusive: true, allowUnready: true, commitHooks: false },
        );
      } catch (error) {
        return {
          status:
            error instanceof StoreError && error.code === 'FENCED'
              ? 'fenced'
              : 'unresolved',
        };
      }
    },
    async interruptOrphans(owner) {
      return transaction(
        owner,
        {},
        async (client) => {
          const rows = (
            await client.query<MatchRow>(
              `SELECT ${columns} FROM matches WHERE status NOT IN ('COMPLETED','ABORTED') AND (owner_id <> $1 OR owner_epoch <> $2) ORDER BY id FOR UPDATE`,
              [owner.token.ownerId, owner.token.epoch.toString()],
            )
          ).rows;
          for (const row of rows) {
            const previous = decodeRow(row);
            const interrupted = interruptForServerRestart(previous.state);
            const operationId = randomUUID();
            await updateMatch(
              client,
              owner,
              interrupted.state,
              previous.storeRevision + 1n,
              operationId,
              { operationId, matchId: previous.state.matchId },
            );
          }
          await dml(
            client,
            {},
            'owner_ready',
            'UPDATE owner_control SET ready=true WHERE id=1 AND owner_id=$1 AND epoch=$2',
            [owner.token.ownerId, owner.token.epoch.toString()],
          );
          return rows.length;
        },
        { exclusive: true, allowUnready: true },
      );
    },
  };
  const guarded =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await fn(...args);
      } catch (error) {
        if (error instanceof StoreError) throw error;
        throw new StoreError('INVALID_STATE');
      }
    };
  return {
    createMatch: guarded(store.createMatch),
    commitTransition: guarded(store.commitTransition),
    readCommitted: guarded(store.readCommitted),
    resolveOperation: guarded(store.resolveOperation),
    interruptOrphans: guarded(store.interruptOrphans),
  };
}
