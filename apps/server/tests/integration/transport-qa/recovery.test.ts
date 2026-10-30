import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { GameplayReplyData } from '@typeduel/contracts';
import { createDatabase } from '../../../src/db/client.js';
import { acquireOwner } from '../../../src/db/owner.js';
import { migrateDatabase } from '../../../src/db/migrate.js';
import { createMatchStore } from '../../../src/db/match-store.js';
import { createTokenIssuer } from './support/tokens.js';
import {
  answer,
  barrier,
  connectPeer,
  createHarness,
  createTestDatabase,
  deferred,
  durableRows,
  eventually,
  httpRequest,
  ManualClock,
  privateLobby,
  readyLobby,
  readyRound,
  settle,
  spawnTransportChild,
  startMatch,
  success,
  type Harness,
  type Peer,
  type TestDatabase,
} from './support/harness.js';

let h: Harness | undefined;
let standalone: TestDatabase | undefined;
afterEach(async () => {
  await h?.testDb.dispose();
  h = undefined;
  await standalone?.dispose();
  standalone = undefined;
});

describe('durable socket recovery and observed disconnect grace', () => {
  it('recovers all 48 original ACKs after reconnect and keeps historical access after rebinding', async () => {
    h = await createHarness();
    let a = await h.connect();
    const b = await h.connect();
    const matchId = await startMatch(h, a, b);
    const packets: {
      playerId: string;
      packet: ReturnType<typeof answer>;
      ack: unknown;
    }[] = [];
    for (let roundNumber = 1; roundNumber <= 8; roundNumber += 1) {
      const { round, schedule } = await readyRound(h, a, b, matchId);
      for (const peer of [a, b])
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const packet = answer(
            matchId,
            round.roundId,
            `qa-wrong-${roundNumber}-${attempt}`,
          );
          const result = success(
            await peer.request<GameplayReplyData>('answer.submit', packet),
          );
          expect(result.ack?.status).toBe('INCORRECT');
          packets.push({ playerId: peer.playerId, packet, ack: result.ack });
        }
      expect((await h.store.readCommitted(matchId))!.state.phase).toBe(
        'ACTIVE_TYPING',
      );
      await h.advance(schedule.deadlineAt);
      await eventually(
        async () =>
          ['ROUND_RESULT', 'COMPLETED'].includes(
            (await h!.store.readCommitted(matchId))!.state.phase,
          ),
        'scoreless deadline close',
      );
    }
    const completed = (await h.store.readCommitted(matchId))!;
    expect(completed.state.phase).toBe('COMPLETED');
    expect(completed.state.completion?.draw).toBe(true);
    expect(completed.state.countedAttempts).toHaveLength(48);
    a.close();
    a = await h.connect(a.playerId);
    const before = await durableRows(h.testDb.pool);
    for (const entry of packets) {
      h.clock.set(h.clock.monoNow() + 100);
      const peer = entry.playerId === a.playerId ? a : b;
      expect(
        success(
          await peer.request<GameplayReplyData>('answer.submit', entry.packet),
        ).ack,
      ).toEqual(entry.ack);
    }
    expect(await durableRows(h.testDb.pool)).toEqual(before);
    for (const peer of [a, b])
      expect(
        (await peer.match(matchId)).snapshot.viewer.countedAttempts,
      ).toHaveLength(24);
    const newer = await startMatch(h, a, b);
    expect(newer).not.toBe(matchId);
    expect((await h.store.readLatestForPlayer(a.playerId))!.state.matchId).toBe(
      newer,
    );
    expect((await a.match(matchId)).snapshot.phase).toBe('COMPLETED');
    expect(
      success(
        await a.request<GameplayReplyData>('answer.submit', packets[0]!.packet),
      ).ack,
    ).toEqual(packets[0]!.ack);
    expect((await h.store.readCommitted(matchId))!).toEqual(completed);
  }, 30_000);

  it.each([9_999, 10_000, 10_001])(
    'uses server-observed disconnect plus %i ms for reconnect eligibility',
    async (offset) => {
      h = await createHarness();
      const a = await h.connect();
      const b = await h.connect();
      const matchId = await startMatch(h, a, b);
      await readyRound(h, a, b, matchId);
      const observed = deferred<void>();
      h.setLifecycleObserver((event) => {
        if (
          event.event === 'player.disconnect' &&
          event.playerId === a.playerId
        )
          observed.resolve();
      });
      const at = h.clock.monoNow();
      a.close();
      await observed.promise;
      h.clock.set(at + offset);
      const reconnected = await h.connect(a.playerId);
      const synced = await reconnected.match(matchId);
      expect(synced.snapshot.phase === 'ABORTED').toBe(offset >= 10_000);
      expect(synced.snapshot.participants.map((p) => p.score)).toEqual([0, 0]);
      if (synced.snapshot.phase === 'ABORTED')
        expect(synced.snapshot.interruption.reason).toBe('DISCONNECT_TIMEOUT');
      else
        expect(
          synced.snapshot.participants.find((p) => p.playerId === a.playerId)
            ?.connected,
        ).toBe(true);
    },
  );

  it.each([9_999, 10_000, null])(
    'preserves buffered STARTING disconnect/reconnect receipts when reconnect offset is %s',
    async (offset) => {
      h = await createHarness();
      const a = await h.connect();
      const b = await h.connect();
      const lobby = await privateLobby(h, a, b);
      const gate = barrier(h.testDb);
      let hold = true;
      h.setFault(async (point) => {
        if (point === 'before_commit' && hold) {
          hold = false;
          await gate.pause();
        }
      });
      const starting = settle(readyLobby(a, b, lobby.lobbyId));
      await gate.reached;
      const observed = deferred<void>();
      const returned = deferred<void>();
      h.setLifecycleObserver((event) => {
        if (event.playerId !== a.playerId) return;
        if (event.event === 'player.disconnect') observed.resolve();
        else returned.resolve();
      });
      const disconnectAt = h.clock.monoNow() + 100;
      h.clock.set(disconnectAt);
      a.close();
      await observed.promise;
      let replacement: Peer | undefined;
      if (offset !== null) {
        h.clock.set(disconnectAt + offset);
        replacement = await h.connect(a.playerId);
        await returned.promise;
        expect((await replacement.sync()).admission.kind).toBe('starting');
      }
      h.clock.set(disconnectAt + 20_000);
      gate.release();
      await starting;
      await h.runtime.reconcile();
      let saved = await h.store.readLatestForPlayer(a.playerId);
      await eventually(async () => {
        saved = await h!.store.readLatestForPlayer(a.playerId);
        return (
          saved !== null &&
          (offset === 9_999
            ? saved.state.phase !== 'ABORTED' &&
              (await b.sync()).admission.kind === 'match'
            : saved.state.phase === 'ABORTED')
        );
      }, 'creation bootstrap outcome');
      expect(saved!.state.participants.map((p) => p.score)).toEqual([0, 0]);
      if (offset === 9_999)
        expect(
          saved!.state.participants.find((p) => p.playerId === a.playerId)
            ?.connected,
        ).toBe(true);
      else {
        expect(saved!.state.interruption?.reason).toBe('DISCONNECT_TIMEOUT');
        expect(saved!.state.completion).toBeNull();
      }
    },
    30_000,
  );
});

async function crashSetup() {
  const db = (standalone = await createTestDatabase());
  const clock = new ManualClock(1_000);
  const tokens = await createTokenIssuer(() => clock.utcNow());
  db.cleanupWith(() => tokens.close());
  const connectionString = db.config.connectionString!;
  await migrateDatabase({ connectionString, schemaName: db.schema });
  const database = createDatabase({ connectionString, schemaName: db.schema });
  db.cleanupWith(() => database.close());
  const store = createMatchStore({ database });
  const boot = async () => {
    const child = spawnTransportChild(db);
    const identity = await child.request<{
      origin: string;
      backendPid: number;
    }>('boot', {
      schemaName: db.schema,
      issuer: tokens.issuer,
      jwksUrl: tokens.jwksUrl,
    });
    return { child, ...identity };
  };
  const running = await boot();
  const aId = randomUUID();
  const bId = randomUUID();
  const a = await connectPeer(running.origin, await tokens.sign(aId), aId, db);
  const b = await connectPeer(running.origin, await tokens.sign(bId), bId, db);
  const facade = {
    store,
    clock,
    http<T>(peer: Peer, method: string, path: string, body?: unknown) {
      return httpRequest<T>(running.origin, peer, method, path, body);
    },
    async advance(at: number) {
      clock.set(at);
      await running.child.request('advance', { at });
    },
  };
  return { db, clock, tokens, store, boot, ...running, a, b, facade };
}

describe('real transport process restart and durable discovery', () => {
  it.each(['before_commit', 'after_commit'] as const)(
    'recovers creation honestly after killing the socket process at %s',
    async (point) => {
      const s = await crashSetup();
      const lobby = await privateLobby(s.facade, s.a, s.b);
      await s.child.request('fault', { point, action: 'pause' });
      const pending = settle(readyLobby(s.a, s.b, lobby.lobbyId));
      await s.child.reached(point);
      await s.child.kill();
      await eventually(
        async () =>
          (
            await s.db.pool.query(
              'SELECT 1 FROM pg_stat_activity WHERE pid=$1',
              [s.backendPid],
            )
          ).rowCount === 0,
        'old ownership session exit',
      );
      const next = await s.boot();
      const recovered = await connectPeer(
        next.origin,
        await s.tokens.sign(s.a.playerId),
        s.a.playerId,
        s.db,
      );
      const sync = await recovered.sync();
      expect(sync.serverInstanceId).not.toBe(s.a.session.serverInstanceId);
      if (point === 'before_commit') {
        expect(sync.admission.kind).toBe('idle');
        expect(await s.store.readLatestForPlayer(s.a.playerId)).toBeNull();
      } else {
        expect(sync.admission.kind).toBe('match');
        if (sync.admission.kind !== 'match')
          throw new Error('Lost committed match discovery');
        expect(sync.admission.update.snapshot.phase).toBe('ABORTED');
        if (sync.admission.update.snapshot.phase === 'ABORTED')
          expect(sync.admission.update.snapshot.interruption.reason).toBe(
            'SERVER_RESTART',
          );
        expect(
          sync.admission.update.snapshot.participants.map((p) => p.score),
        ).toEqual([0, 0]);
      }
      await pending;
    },
    30_000,
  );

  it('fences a still-running old socket process and waits for its transaction before takeover', async () => {
    const s = await crashSetup();
    const matchId = await startMatch(s.facade, s.a, s.b);
    const { round } = await readyRound(s.facade, s.a, s.b, matchId);
    const options = {
      connectionString: s.db.config.connectionString!,
      schemaName: s.db.schema,
      ownerId: randomUUID(),
    };
    await expect(acquireOwner(options)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await s.child.request('fault', { point: 'before_commit', action: 'pause' });
    s.a.fire(
      'answer.submit',
      answer(matchId, round.roundId, round.canonicalText),
    );
    await s.child.reached('before_commit');
    await s.db.pool.query('SELECT pg_terminate_backend($1)', [s.backendPid]);
    await eventually(
      async () => !s.a.socket.connected && !s.b.socket.connected,
      'lost owner closes old transport',
    );
    let acquired = false;
    const takeover = acquireOwner(options).then((owner) => {
      acquired = true;
      s.db.cleanupWith(() => owner.release());
      return owner;
    });
    await eventually(
      async () =>
        (
          await s.db.pool.query(
            "SELECT 1 FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE '%owner_control%FOR UPDATE%'",
          )
        ).rowCount! > 0,
      'new owner waiting for old transaction SHARE lock',
    );
    expect(acquired).toBe(false);
    await s.child.request('release', { point: 'before_commit' });
    const owner = await takeover;
    await s.store.interruptOrphans(owner);
    const terminal = (await s.store.readCommitted(matchId))!;
    expect(terminal.state.phase).toBe('ABORTED');
    expect(terminal.state.interruption?.reason).toBe('SERVER_RESTART');
    expect(terminal.state.countedAttempts).toEqual([]);
    expect(terminal.state.participants.map((p) => p.score)).toEqual([0, 0]);
    expect(terminal.state.completion).toBeNull();
    // IPC remains responsive: this is ownership fencing, not killing the old process.
    await s.child.request('reconcile');
    expect(
      (
        await settle(
          connectPeer(
            s.origin,
            await s.tokens.sign(s.a.playerId),
            s.a.playerId,
            s.db,
          ),
        )
      ).ok,
    ).toBe(false);
    expect(await s.store.readCommitted(matchId)).toEqual(terminal);
  }, 30_000);

  it('preserves the decisive completed result and its original ACK after the socket process dies before delivery', async () => {
    const s = await crashSetup();
    const matchId = await startMatch(s.facade, s.a, s.b);
    let finalPacket: ReturnType<typeof answer> | undefined;
    for (let roundNumber = 1; roundNumber <= 5; roundNumber += 1) {
      const { round } = await readyRound(s.facade, s.a, s.b, matchId);
      finalPacket = answer(matchId, round.roundId, round.canonicalText);
      if (roundNumber === 5) break;
      expect(
        success(
          await s.a.request<GameplayReplyData>('answer.submit', finalPacket),
        ).ack?.status,
      ).toBe('CORRECT');
    }
    await s.child.request('fault', { point: 'after_commit', action: 'pause' });
    s.a.fire('answer.submit', finalPacket);
    await s.child.reached('after_commit');
    const committed = (await s.store.readCommitted(matchId))!;
    expect(committed.state.phase).toBe('COMPLETED');
    await s.child.kill();
    await eventually(
      async () =>
        (
          await s.db.pool.query('SELECT 1 FROM pg_stat_activity WHERE pid=$1', [
            s.backendPid,
          ])
        ).rowCount === 0,
      'old ownership session exit',
    );
    const next = await s.boot();
    const a = await connectPeer(
      next.origin,
      await s.tokens.sign(s.a.playerId),
      s.a.playerId,
      s.db,
    );
    const b = await connectPeer(
      next.origin,
      await s.tokens.sign(s.b.playerId),
      s.b.playerId,
      s.db,
    );
    for (const peer of [a, b])
      expect((await peer.match(matchId)).snapshot.phase).toBe('COMPLETED');
    expect(
      success(await a.request<GameplayReplyData>('answer.submit', finalPacket))
        .ack,
    ).toEqual(committed.state.countedAttempts.at(-1)?.ack);
    expect(await s.store.readCommitted(matchId)).toEqual(committed);
  }, 30_000);
});
