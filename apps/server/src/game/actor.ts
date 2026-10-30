import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AnswerAck } from '@typeduel/contracts';
import {
  StoreError,
  type CommittedUpdate,
  type FaultHook,
  type MatchStore,
  type OwnerLease,
  type PersistedMatch,
} from '../db/types.js';
import { advanceTime, applyCommand, getNextWakeAt } from './engine.js';
import { engineError } from './rules.js';
import { projectSnapshot } from './snapshot.js';
import type { ActorClock } from './clock.js';
import type {
  EngineError,
  GameCommand,
  ReceiptContext,
  TransitionResult,
} from './types.js';

export interface ActorResult {
  ack: AnswerAck | null;
  error: EngineError | null;
}
export interface BootstrapLifecycle {
  command: { type: 'player.disconnect' | 'player.reconnect'; playerId: string };
  receivedAtMonoMs: number;
}
interface Pending {
  command: GameCommand | null;
  receipt: ReceiptContext;
  operationId: string;
  candidate?: TransitionResult;
  expectedRevision?: bigint;
  unknown: boolean;
  resolve(value: ActorResult): void;
  reject(error: StoreError): void;
}
const packetSchema = z.strictObject({
  type: z.enum(['answer.submit', 'round.audio_ready', 'round.replay_used']),
  payload: z.unknown(),
});
const terminal = (record: PersistedMatch) =>
  record.state.phase === 'COMPLETED' || record.state.phase === 'ABORTED';
const publicResult = (candidate: TransitionResult): ActorResult =>
  structuredClone({ ack: candidate.ack, error: candidate.error });

/** One instance owns a match's FIFO. Construct only from a newly created record,
 * or from a terminal record for read-only recovery. Live restart is forbidden. */
export function createMatchActor(options: {
  store: MatchStore;
  owner: OwnerLease;
  initial: PersistedMatch;
  clock: ActorClock;
  publish(viewerId: string, update: CommittedUpdate): unknown;
  hooks?: FaultHook;
  operationId?: () => string;
  maxQueueLength?: number;
  bootstrapLifecycle?: readonly BootstrapLifecycle[];
}) {
  const { store, owner, clock, publish, hooks } = options;
  let record = structuredClone(options.initial);
  if (
    !owner.isActive() ||
    (!terminal(record) &&
      (record.owner.ownerId !== owner.token.ownerId ||
        record.owner.epoch !== owner.token.epoch))
  ) {
    throw new StoreError('FENCED');
  }
  const maxQueueLength = options.maxQueueLength ?? 128;
  if (!Number.isSafeInteger(maxQueueLength) || maxQueueLength < 1)
    throw new StoreError('INVALID_STATE');
  const queue: Pending[] = [];
  const bootstrap =
    options.bootstrapLifecycle === undefined
      ? null
      : structuredClone(options.bootstrapLifecycle);
  const bootstrapNow = clock.monoNow();
  if (bootstrap !== null) {
    let previous = record.state.lastInput.atMonoMs;
    if (
      record.state.phase !== 'PREPARING_ROUND' ||
      record.state.roundNumber !== 0 ||
      record.state.stateVersion !== 0 ||
      record.storeRevision !== 1n ||
      bootstrap.length > 126 ||
      !Number.isSafeInteger(bootstrapNow)
    )
      throw new StoreError('INVALID_STATE');
    for (const entry of bootstrap) {
      if (
        !Number.isSafeInteger(entry.receivedAtMonoMs) ||
        entry.receivedAtMonoMs < previous ||
        entry.receivedAtMonoMs > bootstrapNow ||
        !['player.disconnect', 'player.reconnect'].includes(
          entry.command.type,
        ) ||
        !record.state.participants.some(
          (p) => p.playerId === entry.command.playerId,
        )
      )
        throw new StoreError('INVALID_STATE');
      previous = entry.receivedAtMonoMs;
    }
  }
  let sequence = record.state.lastInput.ingressSequence;
  let closed = false;
  let bootstrapping = bootstrap !== null;
  let paused = false;
  let running: Promise<void> | null = null;
  let cancelWake: (() => void) | undefined;
  const nextOperationId = options.operationId ?? randomUUID;

  function stop(code: 'FENCED' | 'UNAVAILABLE') {
    closed = true;
    cancelWake?.();
    cancelWake = undefined;
    for (const pending of queue.splice(0)) pending.reject(new StoreError(code));
  }
  const removeLostListener = owner.onLost(() => stop('FENCED'));
  function ensureActive() {
    if (!owner.isActive()) throw new StoreError('FENCED');
    if (closed) throw new StoreError('UNAVAILABLE');
  }
  function armWake() {
    cancelWake?.();
    cancelWake = undefined;
    if (closed || paused || bootstrapping) return;
    const at = getNextWakeAt(record.state);
    if (at !== null) {
      cancelWake = clock.schedule(at, () => {
        cancelWake = undefined;
        // Timer failures are recovered by the actor, never logged with inputs.
        void enqueue(null).catch(() => {});
      });
    }
  }
  async function publishCommitted(pending: Pending) {
    const candidate = pending.candidate!;
    // A duplicate ACK needs no replay of public effects. Canonical sync is separate.
    if (!candidate.batches.length) return;
    await hooks?.('before_publish', {
      operationId: pending.operationId,
      matchId: record.state.matchId,
    });
    ensureActive();
    for (const participant of record.state.participants) {
      ensureActive();
      const projected = projectSnapshot(record.state, participant.playerId);
      if (!projected.ok) throw new StoreError('INVALID_STATE');
      const update: CommittedUpdate = {
        matchId: record.state.matchId,
        snapshot: projected.snapshot,
        batches: structuredClone(candidate.batches),
      };
      try {
        // Invoke in commit order; network completion cannot block authoritative
        // processing or roll back a durable point. Later transport checks versions.
        const delivery = publish(participant.playerId, update);
        void Promise.resolve(delivery).catch(() => {});
      } catch {
        /* A failed observer is repaired by canonical snapshot/ACK sync. */
      }
    }
  }
  async function commitPending(pending: Pending): Promise<boolean> {
    const candidate = pending.candidate!;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      ensureActive();
      if (pending.unknown) {
        const resolution = await store.resolveOperation({
          owner,
          matchId: record.state.matchId,
          operationId: pending.operationId,
          expectedRevision: pending.expectedRevision!,
        });
        ensureActive();
        if (resolution.status === 'fenced') throw new StoreError('FENCED');
        if (resolution.status === 'unresolved') return false;
        if (resolution.status === 'committed') {
          record = structuredClone(resolution.match);
          return true;
        }
        pending.unknown = false;
      }
      try {
        record = await store.commitTransition({
          owner,
          matchId: record.state.matchId,
          expectedRevision: pending.expectedRevision!,
          operationId: pending.operationId,
          candidate,
        });
        ensureActive();
        return true;
      } catch (error) {
        if (!(error instanceof StoreError)) throw new StoreError('UNAVAILABLE');
        if (error.code === 'COMMIT_UNKNOWN') {
          pending.unknown = true;
          continue;
        }
        if (error.code === 'ROLLED_BACK') continue;
        if (error.code === 'UNAVAILABLE') return false;
        throw error;
      }
    }
    return false;
  }
  async function drain() {
    try {
      while (queue.length && !paused && !closed) {
        const pending = queue[0]!;
        ensureActive();
        // Terminal recovery is a pure read. It does not compare a new process's
        // monotonic clock with the old process or write terminal ordering metadata.
        if (terminal(record)) {
          if (pending.command === null)
            pending.resolve({ ack: null, error: null });
          else {
            const result = applyCommand(record.state, pending.command, {
              receivedAtMonoMs: record.state.lastInput.atMonoMs,
              ingressSequence: record.state.lastInput.ingressSequence + 1,
            });
            pending.resolve(publicResult(result));
          }
          queue.shift();
          continue;
        }
        if (!pending.candidate) {
          pending.candidate =
            pending.command === null
              ? advanceTime(record.state, {
                  nowMonoMs: pending.receipt.receivedAtMonoMs,
                  ingressSequence: pending.receipt.ingressSequence,
                })
              : applyCommand(record.state, pending.command, pending.receipt);
          pending.expectedRevision = record.storeRevision;
        }
        // Invalid clock/order input is not a transition and cannot be persisted.
        if (pending.candidate.state === record.state) {
          pending.resolve(publicResult(pending.candidate));
          queue.shift();
          continue;
        }
        if (!(await commitPending(pending))) {
          paused = true;
          cancelWake?.();
          cancelWake = undefined;
          break;
        }
        armWake();
        // A diagnostic/publication hook failure cannot undo a committed result.
        try {
          await publishCommitted(pending);
        } catch (error) {
          if (!owner.isActive() || closed) throw error;
        }
        ensureActive();
        pending.resolve(publicResult(pending.candidate));
        queue.shift();
      }
    } catch (error) {
      // Fencing/conflicts/corruption are fail-closed, never guessed outcomes.
      stop(
        error instanceof StoreError && error.code === 'FENCED'
          ? 'FENCED'
          : 'UNAVAILABLE',
      );
    }
  }
  function run() {
    if (running || closed || paused) return;
    running = drain().finally(() => {
      running = null;
      if (queue.length && !closed && !paused) run();
    });
  }
  function enqueue(
    command: GameCommand | null,
    preservedReceipt?: number,
    start = true,
  ): Promise<ActorResult> {
    // No await before receipt capture and insertion. Caller mutation after return
    // cannot change the queued payload or its fingerprint.
    try {
      const receivedAtMonoMs = preservedReceipt ?? clock.monoNow();
      const ingressSequence = ++sequence;
      ensureActive();
      const capacity =
        !start || command?.type === 'player.disconnect'
          ? maxQueueLength
          : Math.max(1, maxQueueLength - 2);
      if (queue.length >= capacity) throw new StoreError('UNAVAILABLE');
      const copy = structuredClone(command);
      const operationId = nextOperationId();
      return new Promise((resolve, reject) => {
        queue.push({
          command: copy,
          receipt: { receivedAtMonoMs, ingressSequence },
          operationId,
          unknown: false,
          resolve,
          reject,
        });
        if (start) run();
      });
    } catch {
      return Promise.reject(
        new StoreError(owner.isActive() ? 'UNAVAILABLE' : 'FENCED'),
      );
    }
  }
  const bootstrapReady =
    bootstrap === null
      ? Promise.resolve()
      : Promise.all([
          ...bootstrap.map((entry) =>
            enqueue(entry.command, entry.receivedAtMonoMs, false),
          ),
          enqueue(null, bootstrapNow, false),
        ]).then(() => {
          bootstrapping = false;
          armWake();
        });
  // Keep rejection handled even if shutdown races the registry's await.
  void bootstrapReady.catch(() => {});
  if (bootstrap !== null) run();
  else armWake();
  return {
    bootstrapReady,
    isIdle: () => queue.length === 0 && running === null,
    canAcceptReconnect: () =>
      !closed &&
      (bootstrapping || queue.length < Math.max(1, maxQueueLength - 2)),
    canAcceptReplacement: () =>
      !closed && maxQueueLength >= 4 && queue.length <= maxQueueLength - 4,
    replaceConnection(playerId: string): Promise<ActorResult> {
      if (closed || maxQueueLength < 4 || queue.length > maxQueueLength - 4)
        return Promise.reject(new StoreError('UNAVAILABLE'));
      const at = clock.monoNow();
      const disconnected = enqueue(
        { type: 'player.disconnect', playerId },
        at,
        false,
      );
      const reconnected = enqueue(
        { type: 'player.reconnect', playerId },
        at,
        false,
      );
      run();
      return Promise.all([disconnected, reconnected]).then(
        (results) => results[1]!,
      );
    },
    acceptPlayerCommand(
      principal: { playerId: string },
      raw: unknown,
    ): Promise<ActorResult> {
      try {
        const parsed = packetSchema.safeParse(raw);
        if (!parsed.success)
          return Promise.resolve({
            ack: null,
            error: engineError('INVALID_COMMAND'),
          });
        if (
          !record.state.participants.some(
            (p) => p.playerId === principal.playerId,
          )
        ) {
          return Promise.resolve({
            ack: null,
            error: engineError('UNAUTHORIZED'),
          });
        }
        return enqueue({
          type: parsed.data.type,
          playerId: principal.playerId,
          payload: parsed.data.payload,
        });
      } catch {
        return Promise.resolve({
          ack: null,
          error: engineError('INVALID_COMMAND'),
        });
      }
    },
    acceptTrustedCommand(
      command: Exclude<
        GameCommand,
        { type: 'answer.submit' | 'round.audio_ready' | 'round.replay_used' }
      >,
    ): Promise<ActorResult> {
      return enqueue(command);
    },
    wake: () => enqueue(null),
    getSnapshot(viewerId: string) {
      ensureActive();
      return projectSnapshot(record.state, viewerId);
    },
    async reconcile(): Promise<void> {
      if (closed) return;
      if (paused) {
        paused = false;
        run();
      }
      // An ongoing transaction owns the queue; reconciliation never races it.
      if (running) await running;
      if (!paused && !closed) armWake();
    },
    close() {
      removeLostListener();
      stop('UNAVAILABLE');
    },
  };
}
