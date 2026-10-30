import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import type { GameplayReplyData, SessionState } from '@typeduel/contracts';
import {
  answer,
  barrier,
  createHarness,
  eventually,
  mutate,
  readyRound,
  settle,
  startMatch,
  success,
  type Harness,
} from './support/harness.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.testDb.dispose();
  h = undefined;
});

describe('real Socket.IO authentication and session authority', () => {
  it.each([
    'expired',
    'future',
    'issuer',
    'audience',
    'subject',
    'role',
    'signature',
    'algorithm',
  ] as const)(
    'rejects %s credentials through real JWT verification without database admission',
    async (kind) => {
      h = await createHarness();
      const playerId = randomUUID();
      const seconds = Math.floor(h.clock.utcNow() / 1_000);
      const claims =
        kind === 'expired'
          ? { exp: seconds }
          : kind === 'future'
            ? { nbf: seconds + 30 }
            : kind === 'issuer'
              ? { iss: 'https://wrong-issuer.invalid' }
              : kind === 'audience'
                ? { aud: 'wrong-audience' }
                : kind === 'subject'
                  ? { sub: 'not-a-uuid' }
                  : kind === 'role'
                    ? { role: 'service_role' }
                    : {};
      let token = await h.tokens.sign(playerId, claims);
      if (kind === 'signature') {
        const parts = token.split('.');
        parts[1] = Buffer.from(
          JSON.stringify({ sub: randomUUID(), role: 'authenticated' }),
        ).toString('base64url');
        token = parts.join('.');
      }
      if (kind === 'algorithm')
        token = await new SignJWT({
          sub: playerId,
          role: 'authenticated',
          iss: h.tokens.issuer,
          aud: 'authenticated',
          exp: seconds + 30,
        })
          .setProtectedHeader({ alg: 'HS256' })
          .sign(Buffer.alloc(32, 7));
      const rejected = await settle(h.connect(playerId, token));
      expect(rejected.ok).toBe(false);
      if (!rejected.ok)
        expect(JSON.stringify(rejected.error)).not.toContain(token);
      expect((await h.testDb.pool.query('SELECT 1 FROM matches')).rows).toEqual(
        [],
      );
      expect(
        (await h.testDb.pool.query('SELECT 1 FROM player_match_bindings')).rows,
      ).toEqual([]);
    },
  );

  it('validates key rotation and fails closed on unavailable JWKS without trusting token key URLs', async () => {
    h = await createHarness();
    const a = await h.connect();
    expect((await a.sync()).admission.kind).toBe('idle');
    await h.tokens.rotate();
    const b = await h.connect();
    expect(b.playerId).not.toBe(a.playerId);
    await h.tokens.rotate();
    h.tokens.setStatus(503);
    const failed = await settle(h.connect());
    expect(failed.ok).toBe(false);
    h.tokens.setStatus(200);
    const malicious = await h.tokens.sign(
      randomUUID(),
      {},
      { kid: 'qa-unknown-key', jku: 'http://127.0.0.1:1/qa-must-not-fetch' },
    );
    expect((await settle(h.connect(randomUUID(), malicious))).ok).toBe(false);
    expect(h.tokens.requests).toBeGreaterThanOrEqual(2);
  });

  it('rejects expired authorization but preserves a valid answer admitted before expiry during slow storage', async () => {
    h = await createHarness();
    const playerId = randomUUID();
    const expiry = h.clock.utcNow() + 30_000;
    const a = await h.connect(
      playerId,
      await h.tokens.sign(playerId, { exp: expiry / 1_000 }),
    );
    const b = await h.connect();
    const matchId = await startMatch(h, a, b);
    const { round } = await readyRound(h, a, b, matchId);
    const gate = barrier(h.testDb);
    let hold = true;
    h.setFault(async (point) => {
      if (point === 'before_commit' && hold) {
        hold = false;
        await gate.pause();
      }
    });
    const packet = answer(matchId, round.roundId, 'qa-wrong');
    const pending = settle(
      a.request<GameplayReplyData>('answer.submit', packet),
    );
    await gate.reached;
    h.clock.set(h.clock.monoNow() + expiry - h.clock.utcNow(), true);
    gate.release();
    await pending; // Expiry can close the socket before the committed ACK is delivered.
    await eventually(
      async () =>
        (await h!.store.readCommitted(matchId))!.state.countedAttempts
          .length === 1,
      'valid pre-expiry attempt commit',
    );
    expect(
      (await h.store.readCommitted(matchId))?.state.countedAttempts[0]?.ack
        .attemptId,
    ).toBe(packet.attemptId);
    expect((await settle(h.connect(playerId, a.token))).ok).toBe(false);
    const fresh = await h.connect(playerId);
    expect(
      (await fresh.match(matchId)).snapshot.viewer.countedAttempts[0]
        ?.attemptId,
    ).toBe(packet.attemptId);
  });

  it('replaces one session, ignores its stale disconnect, and rejects stale HTTP mutations', async () => {
    h = await createHarness();
    const a = await h.connect();
    const b = await h.connect();
    const matchId = await startMatch(h, a, b);
    await readyRound(h, a, b, matchId);
    const originalSession = a.session.sessionId;
    const replacement = await h.connect(a.playerId);
    expect(replacement.session.sessionId).not.toBe(originalSession);
    await eventually(async () => !a.socket.connected, 'displaced socket close');
    a.close();
    await h.advance(h.clock.monoNow() + 1);
    expect(
      (await h.store.readCommitted(matchId))!.state.participants.find(
        (p) => p.playerId === a.playerId,
      )?.connected,
    ).toBe(true);
    const response = await h.http<SessionState>(a, 'POST', '/v1/rooms', {
      requestId: randomUUID(),
      expectedAdmissionRevision: a.session.admissionRevision,
      setup: { mode: 'classic', categorySlug: 'general', difficulty: 1 },
    });
    expect(response.reply).toMatchObject({
      ok: false,
      error: { code: 'SESSION_REPLACED' },
    });
    expect((await replacement.match(matchId)).snapshot.matchId).toBe(matchId);
  });

  it('rejects a third identity and spoofed packet identity without consuming either participant attempt', async () => {
    h = await createHarness();
    const a = await h.connect();
    const b = await h.connect();
    const outsider = await h.connect();
    const matchId = await startMatch(h, a, b);
    const { round } = await readyRound(h, a, b, matchId);
    expect(
      await outsider.request('match.sync', {
        requestId: randomUUID(),
        matchId,
        lastSeenVersion: 0,
      }),
    ).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
    expect(
      await outsider.request(
        'answer.submit',
        answer(matchId, round.roundId, round.canonicalText),
      ),
    ).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
    const spoof = await a.request<GameplayReplyData>('answer.submit', {
      ...answer(matchId, round.roundId, round.canonicalText),
      playerId: b.playerId,
    });
    expect(spoof.ok ? spoof.data.ack : null).toBeNull();
    expect(
      (await h.store.readCommitted(matchId))!.state.countedAttempts,
    ).toEqual([]);
    expect(
      success(
        await mutate(outsider, 'queue.join', {
          setup: { mode: 'classic', categorySlug: 'general', difficulty: 1 },
        }),
      ).admission.kind,
    ).toBe('queued');
  });
});
