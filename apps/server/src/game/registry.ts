import { randomUUID } from 'node:crypto';
import type { CommittedMatchUpdate, MatchSetup } from '@typeduel/contracts';
import {
  StoreError,
  type DiscoverableMatchStore,
  type OwnerLease,
  type PersistedMatch,
} from '../db/types.js';
import { createMatch } from './engine.js';
import { createMatchActor, type BootstrapLifecycle } from './actor.js';
import { projectSnapshot } from './snapshot.js';
import type { ActorClock } from './clock.js';
import type { RoundSource } from './source.js';
import type { MatchState } from './types.js';
import type { RuntimeConfig, RuntimeHooks } from '../runtime.js';
import { TransportFailure } from '../socket/limits.js';
import { createLifecycle } from './lifecycle.js';

type Actor = ReturnType<typeof createMatchActor>;
interface Entry {
  state: MatchState;
  operationId: string;
  unknown: boolean;
  running: boolean;
  actor?: Actor;
  record?: PersistedMatch;
  buffer: BootstrapLifecycle[];
  online: Map<string, boolean>;
  reconnects: Map<string, number>;
  ready: boolean;
  active: boolean;
  usedWordIds: string[];
  lifecycle?: ReturnType<typeof createLifecycle>;
  resolve(id: string): void;
  reject(error: Error): void;
  promise: Promise<string>;
}
export function createRegistry(options: {
  store: DiscoverableMatchStore;
  owner: OwnerLease;
  clock: ActorClock;
  source: RoundSource;
  config: RuntimeConfig;
  hooks?: RuntimeHooks | undefined;
  publish(playerId: string, update: CommittedMatchUpdate): void;
}) {
  const { store, owner, clock, source, config, hooks } = options;
  const entries = new Map<string, Entry>();
  let closed = false;
  const assert = () => {
    if (closed || !owner.isActive())
      throw new TransportFailure('SERVER_UNAVAILABLE');
  };
  const terminal = (s: MatchState) =>
    s.phase === 'COMPLETED' || s.phase === 'ABORTED';
  const snapshot = (actor: Actor, viewer: string) => {
    const p = actor.getSnapshot(viewer);
    if (!p.ok) throw new TransportFailure('UNAUTHORIZED');
    return p.snapshot;
  };
  async function bounded<T>(work: Promise<T>): Promise<T> {
    let cancel = () => {};
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          cancel = clock.schedule(
            clock.monoNow() + config.sourceTimeoutMs,
            () => reject(new TransportFailure('SOURCE_UNAVAILABLE')),
          );
        }),
      ]);
    } finally {
      cancel();
    }
  }
  async function prepare(entry: Entry, expectedRound: number) {
    assert();
    if (!entry.actor || !entry.active) return;
    const first = entry.state.participants[0].playerId;
    const before = snapshot(entry.actor, first);
    if (
      before.roundNumber !== expectedRound ||
      !['ROUND_RESULT', 'PREPARING_ROUND'].includes(before.phase)
    )
      return;
    try {
      const descriptor = await bounded(
        source.nextRound({
          matchId: before.matchId,
          setup: before.setup,
          roundNumber: expectedRound + 1,
          level: before.currentLevel,
          usedWordIds: [...entry.usedWordIds],
        }),
      );
      assert();
      const now = snapshot(entry.actor, first);
      if (now.phase !== before.phase || now.roundNumber !== before.roundNumber)
        return;
      const result = await entry.actor.acceptTrustedCommand({
        type: 'round.prepare',
        descriptor,
      });
      if (!result.error) entry.usedWordIds.push(descriptor.wordId);
      else if (result.error.code !== 'MATCH_TERMINAL')
        await entry.actor.acceptTrustedCommand({ type: 'source.unavailable' });
    } catch {
      if (!closed && owner.isActive() && entry.actor) {
        const now = snapshot(entry.actor, first);
        if (
          now.phase === before.phase &&
          now.roundNumber === before.roundNumber
        )
          await entry.actor.acceptTrustedCommand({
            type: 'source.unavailable',
          });
      }
    }
  }
  async function attempt(entry: Entry) {
    if (entry.running || entry.ready || closed) return;
    entry.running = true;
    try {
      assert();
      if (entry.unknown) {
        const result = await store.resolveOperation({
          owner,
          matchId: entry.state.matchId,
          operationId: entry.operationId,
          expectedRevision: 0n,
        });
        if (result.status === 'unresolved') return;
        if (result.status === 'fenced')
          throw new TransportFailure('SERVER_UNAVAILABLE');
        if (result.status === 'committed') entry.record = result.match;
        entry.unknown = false;
      }
      if (!entry.record)
        entry.record = await store.createMatch({
          owner,
          operationId: entry.operationId,
          state: entry.state,
        });
      assert();
      if (!entry.actor) {
        entry.lifecycle = createLifecycle({
          clock,
          resultHoldMs: config.resultHoldMs,
          prepare: (round) => prepare(entry, round),
        });
        entry.actor = createMatchActor({
          store,
          owner,
          initial: entry.record,
          clock,
          ...(hooks?.actor ? { hooks: hooks.actor } : {}),
          bootstrapLifecycle: entry.buffer,
          publish(playerId, update) {
            const packet = {
              ...update,
              stateVersion: update.snapshot.stateVersion,
            };
            if (entry.active) {
              options.publish(playerId, packet);
              entry.lifecycle?.observe(update.snapshot);
            }
          },
        });
        entry.buffer = [];
      }
      await entry.actor.bootstrapReady;
      assert();
      entry.ready = true;
      entry.resolve(entry.state.matchId);
    } catch (error) {
      if (
        error instanceof StoreError &&
        ['COMMIT_UNKNOWN', 'UNAVAILABLE', 'ROLLED_BACK'].includes(error.code)
      ) {
        entry.unknown = error.code === 'COMMIT_UNKNOWN';
        return;
      }
      entry.reject(
        new TransportFailure(
          error instanceof StoreError && error.code === 'CONFLICT'
            ? 'ADMISSION_CONFLICT'
            : 'SERVER_UNAVAILABLE',
        ),
      );
    } finally {
      entry.running = false;
    }
  }
  const api = {
    async available(setup: MatchSetup) {
      assert();
      try {
        return await bounded(source.checkAvailability(setup));
      } catch {
        return false;
      }
    },
    start(input: {
      matchId: string;
      participants: [string, string];
      setup: MatchSetup;
      clockAnchor: { monoMs: number; utcEpochMs: number };
    }): Promise<string> {
      assert();
      const prior = entries.get(input.matchId);
      if (prior) return prior.promise;
      let resolve!: (id: string) => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<string>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const entry: Entry = {
        state: createMatch(input),
        operationId: randomUUID(),
        unknown: false,
        running: false,
        buffer: [],
        online: new Map(input.participants.map((id) => [id, true])),
        reconnects: new Map(),
        ready: false,
        active: false,
        usedWordIds: [],
        resolve,
        reject,
        promise,
      };
      entries.set(input.matchId, entry);
      void attempt(entry);
      return promise;
    },
    canReconnect(matchId: string, playerId: string) {
      const e = entries.get(matchId);
      return (
        !e ||
        e.online.get(playerId) !== false ||
        ((e.ready || (e.reconnects.get(playerId) ?? 0) < 31) &&
          (!e.actor || e.actor.canAcceptReconnect()))
      );
    },
    canReplace(matchId: string, playerId: string) {
      const entry = entries.get(matchId);
      if (!entry?.ready || !entry.actor) return true;
      return (
        snapshot(entry.actor, playerId).phase !== 'PREPARING_ROUND' ||
        entry.actor.canAcceptReplacement()
      );
    },
    replaceSession(matchId: string, playerId: string) {
      const entry = entries.get(matchId);
      if (
        entry?.ready &&
        entry.actor &&
        snapshot(entry.actor, playerId).phase === 'PREPARING_ROUND'
      ) {
        const pending = entry.actor.replaceConnection(playerId);
        hooks?.afterLifecycleCapture?.({
          event: 'player.disconnect',
          playerId,
          matchId,
        });
        hooks?.afterLifecycleCapture?.({
          event: 'player.reconnect',
          playerId,
          matchId,
        });
        void pending.catch(() => {});
      }
    },
    connection(matchId: string, playerId: string, connected: boolean) {
      const e = entries.get(matchId);
      if (!e || e.online.get(playerId) === connected) return;
      if (connected && !api.canReconnect(matchId, playerId))
        throw new TransportFailure('RATE_LIMITED');
      if (connected && !e.ready)
        e.reconnects.set(playerId, (e.reconnects.get(playerId) ?? 0) + 1);
      e.online.set(playerId, connected);
      const command = {
        type: connected
          ? ('player.reconnect' as const)
          : ('player.disconnect' as const),
        playerId,
      };
      if (e.actor) void e.actor.acceptTrustedCommand(command).catch(() => {});
      else e.buffer.push({ command, receivedAtMonoMs: clock.monoNow() });
      hooks?.afterLifecycleCapture?.({
        event: command.type,
        playerId,
        matchId,
      });
    },
    activate(matchId: string) {
      const e = entries.get(matchId);
      if (!e?.actor || !e.ready) return;
      e.active = true;
      e.lifecycle?.observe(snapshot(e.actor, e.state.participants[0].playerId));
    },
    async sync(
      matchId: string,
      playerId: string,
    ): Promise<CommittedMatchUpdate> {
      assert();
      const e = entries.get(matchId);
      if (e) {
        if (!e.ready || !e.actor)
          throw new TransportFailure('STORAGE_UNAVAILABLE');
        await e.actor.wake();
        assert();
        const s = snapshot(e.actor, playerId);
        return {
          matchId,
          stateVersion: s.stateVersion,
          snapshot: s,
          batches: [],
        };
      }
      const record = await store.readCommitted(matchId);
      assert();
      if (
        !record ||
        !record.state.participants.some((p) => p.playerId === playerId)
      )
        throw new TransportFailure('UNAUTHORIZED');
      if (!terminal(record.state))
        throw new TransportFailure('SERVER_UNAVAILABLE');
      const projection = projectSnapshot(record.state, playerId);
      if (!projection.ok) throw new TransportFailure('UNAUTHORIZED');
      return {
        matchId,
        stateVersion: projection.snapshot.stateVersion,
        snapshot: projection.snapshot,
        batches: [],
      };
    },
    command(
      matchId: string,
      playerId: string,
      type: 'answer.submit' | 'round.audio_ready' | 'round.replay_used',
      payload: unknown,
    ) {
      assert();
      const e = entries.get(matchId);
      if (e) {
        if (!e.ready || !e.actor)
          throw new TransportFailure('STORAGE_UNAVAILABLE');
        return e.actor.acceptPlayerCommand({ playerId }, { type, payload });
      }
      return (async () => {
        const record = await store.readCommitted(matchId);
        assert();
        if (
          !record ||
          !record.state.participants.some((p) => p.playerId === playerId)
        )
          throw new TransportFailure('UNAUTHORIZED');
        if (!terminal(record.state))
          throw new TransportFailure('SERVER_UNAVAILABLE');
        const actor = createMatchActor({
          store,
          owner,
          initial: record,
          clock,
          publish: () => {},
        });
        try {
          return await actor.acceptPlayerCommand(
            { playerId },
            { type, payload },
          );
        } finally {
          actor.close();
        }
      })();
    },
    async reconcile() {
      if (closed) return;
      await Promise.allSettled(
        [...entries.values()].map(async (e) => {
          if (e.actor) {
            await e.actor.reconcile();
            if (
              e.ready &&
              e.actor.isIdle() &&
              ['COMPLETED', 'ABORTED'].includes(
                snapshot(e.actor, e.state.participants[0].playerId).phase,
              )
            ) {
              e.lifecycle?.close();
              e.actor.close();
              entries.delete(e.state.matchId);
              return;
            }
          }
          if (!e.ready) await attempt(e);
        }),
      );
    },
    close() {
      closed = true;
      for (const e of entries.values()) {
        e.lifecycle?.close();
        e.actor?.close();
        e.reject(new TransportFailure('SERVER_UNAVAILABLE'));
      }
      entries.clear();
    },
  };
  return api;
}
export type MatchRegistry = ReturnType<typeof createRegistry>;
