import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoomPreview, SessionState } from '@typeduel/contracts';
import { createFixtureMatch } from '../../game/fixtures.js';
import {
  barrier,
  createHarness,
  DEFAULT_SETUP,
  durableRows,
  eventually,
  mutate,
  privateLobby,
  readyLobby,
  settle,
  success,
  type Harness,
} from './support/harness.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.testDb.dispose();
  h = undefined;
});

describe('atomic HTTP/socket admission and durable participant discovery', () => {
  it('freezes invite settings, rejects self/full-room joins and authorizes cancellation', async () => {
    h = await createHarness();
    const a = await h.connect();
    const b = await h.connect();
    const c = await h.connect();
    const lobby = await privateLobby(h, a, undefined, {
      mode: 'challenge',
      categorySlug: 'animals',
    });
    const path = `/v1/rooms/${lobby.inviteCode}`;
    const preview = await h.http<RoomPreview>(
      b,
      'GET',
      `${path}?requestId=${randomUUID()}`,
    );
    expect(success(preview.reply).preview.setup).toEqual(lobby.setup);
    expect(success(preview.reply).preview.available).toBe(true);
    const self = await h.http<SessionState>(a, 'POST', `${path}/join`, {
      requestId: randomUUID(),
      expectedAdmissionRevision: (await a.sync()).admissionRevision,
    });
    expect(self.reply.ok).toBe(false);
    const outcomes = await Promise.all(
      [b, c].map(async (peer) =>
        h!.http<SessionState>(peer, 'POST', `${path}/join`, {
          requestId: randomUUID(),
          expectedAdmissionRevision: (await peer.sync()).admissionRevision,
        }),
      ),
    );
    expect(outcomes.filter((entry) => entry.reply.ok)).toHaveLength(1);
    const admitted = outcomes[0]!.reply.ok ? b : c;
    const outsider = admitted === b ? c : b;
    const joined = await admitted.sync();
    expect(
      joined.admission.kind === 'lobby' && joined.admission.lobby.setup,
    ).toEqual(lobby.setup);
    const forbidden = await h.http<SessionState>(outsider, 'DELETE', path, {
      requestId: randomUUID(),
      expectedAdmissionRevision: (await outsider.sync()).admissionRevision,
    });
    expect(forbidden.reply.ok).toBe(false);
    const malicious = await h.http<SessionState>(
      admitted,
      'POST',
      `${path}/join`,
      {
        requestId: randomUUID(),
        expectedAdmissionRevision: joined.admissionRevision,
        setup: DEFAULT_SETUP,
      },
    );
    expect(malicious.reply.ok).toBe(false);
    const cancelled = await h.http<SessionState>(a, 'DELETE', path, {
      requestId: randomUUID(),
      expectedAdmissionRevision: (await a.sync()).admissionRevision,
    });
    expect(success(cancelled.reply).admission.kind).toBe('idle');
    expect((await admitted.sync()).admission.kind).toBe('idle');
    expect((await h.testDb.pool.query('SELECT 1 FROM matches')).rows).toEqual(
      [],
    );
  });

  it('serializes same-user HTTP room creation against queue admission and retries the winning request idempotently', async () => {
    h = await createHarness();
    const a = await h.connect();
    const current = await a.sync();
    const roomBody = {
      requestId: randomUUID(),
      expectedAdmissionRevision: current.admissionRevision,
      setup: DEFAULT_SETUP,
    };
    const queueBody = {
      requestId: randomUUID(),
      expectedAdmissionRevision: current.admissionRevision,
      setup: DEFAULT_SETUP,
    };
    const [room, queue] = await Promise.all([
      h.http<SessionState>(a, 'POST', '/v1/rooms', roomBody),
      a.request<SessionState>('queue.join', queueBody),
    ]);
    expect(Number(room.reply.ok) + Number(queue.ok)).toBe(1);
    const after = await a.sync();
    const retry = room.reply.ok
      ? (await h.http<SessionState>(a, 'POST', '/v1/rooms', roomBody)).reply
      : await a.request<SessionState>('queue.join', queueBody);
    expect(success(retry)).toEqual(
      room.reply.ok ? room.reply.data : success(queue),
    );
    expect((await a.sync()).admission).toEqual(after.admission);
    const changed = room.reply.ok
      ? (
          await h.http<SessionState>(a, 'POST', '/v1/rooms', {
            ...roomBody,
            setup: { ...DEFAULT_SETUP, difficulty: 2 },
          })
        ).reply
      : await a.request<SessionState>('queue.join', {
          ...queueBody,
          setup: { ...DEFAULT_SETUP, difficulty: 2 },
        });
    expect(changed).toMatchObject({
      ok: false,
      error: { code: 'IDEMPOTENCY_CONFLICT' },
    });
  });

  it('isolates incompatible General queues and rejects named-category and invalid Challenge input', async () => {
    h = await createHarness();
    const a = await h.connect();
    const b = await h.connect();
    const c = await h.connect();
    expect(
      (
        await mutate(c, 'queue.join', {
          setup: { mode: 'classic', categorySlug: 'animals', difficulty: 1 },
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await mutate(c, 'queue.join', {
          setup: { mode: 'challenge', categorySlug: 'general', difficulty: 1 },
        })
      ).ok,
    ).toBe(false);
    expect(
      success(await mutate(a, 'queue.join', { setup: DEFAULT_SETUP })).admission
        .kind,
    ).toBe('queued');
    expect(
      success(
        await mutate(b, 'queue.join', {
          setup: { ...DEFAULT_SETUP, difficulty: 2 },
        }),
      ).admission.kind,
    ).toBe('queued');
    success(await mutate(c, 'queue.join', { setup: DEFAULT_SETUP }));
    await eventually(
      async () => (await a.sync()).admission.kind === 'lobby',
      'compatible pair lobby',
    );
    const paired = await a.sync();
    expect(
      paired.admission.kind === 'lobby' &&
        paired.admission.lobby.members.map((member) => member.playerId).sort(),
    ).toEqual([a.playerId, c.playerId].sort());
    expect((await b.sync()).admission.kind).toBe('queued');
  });

  it.each(['overlap', 'reversed'] as const)(
    'guards %s participant bindings in real concurrent create transactions',
    async (kind) => {
      h = await createHarness();
      const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()] as [
        string,
        string,
        string,
      ];
      const one = createFixtureMatch({
        matchId: randomUUID(),
        participants: [a, b],
      });
      const two = createFixtureMatch({
        matchId: randomUUID(),
        participants: kind === 'overlap' ? [a, c] : [b, a],
      });
      const results = await Promise.all(
        [one, two].map((state) =>
          settle(
            h!.store.createMatch({
              owner: h!.owner,
              operationId: randomUUID(),
              state,
            }),
          ),
        ),
      );
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      const rows = await h.testDb.pool.query<{
        player_id: string;
        last_match_id: string;
      }>(
        'SELECT player_id, last_match_id FROM player_match_bindings ORDER BY player_id',
      );
      expect(rows.rows).toHaveLength(2);
      expect(new Set(rows.rows.map((row) => row.last_match_id)).size).toBe(1);
      expect(
        (await h.testDb.pool.query('SELECT 1 FROM matches')).rows,
      ).toHaveLength(1);
      expect(
        (await h.testDb.pool.query('SELECT 1 FROM match_participants')).rows,
      ).toHaveLength(2);
      await expect(
        h.testDb.pool.query(
          'UPDATE player_match_bindings SET player_id = $1 WHERE player_id = $2',
          [randomUUID(), rows.rows[0]!.player_id],
        ),
      ).rejects.toMatchObject({ code: '23503' });
    },
  );

  it('rolls back every new match/participant/binding write atomically', async () => {
    h = await createHarness();
    const state = createFixtureMatch({
      matchId: randomUUID(),
      participants: [randomUUID(), randomUUID()],
    });
    const before = await durableRows(h.testDb.pool);
    let completed = false;
    for (let failAt = 1; failAt <= 12; failAt += 1) {
      let writes = 0;
      h.setFault((point) => {
        if (point === 'after_dml' && ++writes === failAt)
          throw new Error('qa-private-admission-fault');
      });
      const result = await settle(
        h.store.createMatch({
          owner: h.owner,
          operationId: randomUUID(),
          state,
        }),
      );
      if (result.ok) {
        expect(writes).toBe(failAt - 1);
        expect(writes).toBeGreaterThanOrEqual(5);
        completed = true;
        break;
      }
      expect(writes).toBe(failAt);
      expect(await durableRows(h.testDb.pool)).toEqual(before);
      expect(
        await h.store.readLatestForPlayer(state.participants[0].playerId),
      ).toBeNull();
    }
    expect(completed).toBe(true);
  });

  it('retains both starting reservations across uncertain creation and lost discovery messages', async () => {
    h = await createHarness();
    const a = await h.connect();
    const b = await h.connect();
    const lobby = await privateLobby(h, a, b);
    const gate = barrier(h.testDb);
    let pause = true;
    h.setFault(async (point) => {
      if (point === 'after_commit' && pause) {
        pause = false;
        await gate.pause();
        throw new Error('qa-lost-create-response');
      }
    });
    h.setOutbound((packet) =>
      packet.kind === 'event' &&
      ['match.found', 'session.update'].includes(packet.event)
        ? 'drop'
        : 'send',
    );
    const starting = settle(readyLobby(a, b, lobby.lobbyId));
    await gate.reached;
    expect((await a.sync()).admission.kind).toBe('starting');
    expect((await b.sync()).admission.kind).toBe('starting');
    expect((await mutate(a, 'queue.join', { setup: DEFAULT_SETUP })).ok).toBe(
      false,
    );
    const cancelled = await h.http<SessionState>(
      b,
      'DELETE',
      `/v1/rooms/${lobby.inviteCode}`,
      {
        requestId: randomUUID(),
        expectedAdmissionRevision: (await b.sync()).admissionRevision,
      },
    );
    expect(
      cancelled.reply.ok && cancelled.reply.data.admission.kind === 'idle',
    ).toBe(false);
    gate.release();
    await starting;
    await h.runtime.reconcile();
    await eventually(async () => {
      // Drive the manual recovery scheduler without flooding session.sync at a frozen clock.
      await h!.runtime.reconcile();
      return h!.packets.some(
        (packet) =>
          packet.kind === 'event' &&
          packet.event === 'match.found' &&
          packet.playerId === a.playerId,
      );
    }, 'bound match after uncertain creation');
    const recovered = await a.sync();
    expect(recovered.admission.kind).toBe('match');
    if (recovered.admission.kind !== 'match')
      throw new Error('Committed match not discoverable');
    expect(
      (await h.testDb.pool.query('SELECT 1 FROM matches')).rows,
    ).toHaveLength(1);
    expect((await h.store.readLatestForPlayer(b.playerId))?.state.matchId).toBe(
      recovered.admission.update.matchId,
    );
  });

  it('expires invites and refuses admission when source coverage is unavailable', async () => {
    h = await createHarness();
    const a = await h.connect();
    const b = await h.connect();
    const lobby = await privateLobby(h, a);
    h.clock.set(h.clock.monoNow() + lobby.expiresAt - h.clock.utcNow(), true);
    const expired = await h.http<SessionState>(
      b,
      'POST',
      `/v1/rooms/${lobby.inviteCode}/join`,
      {
        requestId: randomUUID(),
        expectedAdmissionRevision: (await b.sync()).admissionRevision,
      },
    );
    expect(expired.reply.ok).toBe(false);
    h.content.setAvailable(false);
    expect(
      await mutate(b, 'queue.join', { setup: DEFAULT_SETUP }),
    ).toMatchObject({ ok: false, error: { code: 'SOURCE_UNAVAILABLE' } });
    expect((await h.testDb.pool.query('SELECT 1 FROM matches')).rows).toEqual(
      [],
    );
  });
});
