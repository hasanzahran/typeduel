import { randomUUID } from 'node:crypto';
import { it, expect } from 'vitest';
import { testRuntime, sync } from '../game/runtime-fixtures.js';
it('requires current authenticated session and freezes private setup through preview/join', async () => {
  const h = await testRuntime();
  try {
    const a = await h.connect(),
      b = await h.connect();
    const as = await sync(a.socket),
      bs = await sync(b.socket);
    const headers = (id: string, sessionId: string) => ({
      authorization: `Bearer ${id}`,
      'x-typeduel-session-id': sessionId,
    });
    const setup = { mode: 'challenge', categorySlug: 'animals' };
    const created = await h.runtime.app.inject({
      method: 'POST',
      url: '/v1/rooms',
      headers: headers(a.playerId, as.sessionId),
      payload: {
        requestId: randomUUID(),
        expectedAdmissionRevision: as.admissionRevision,
        setup,
      },
    });
    expect(created.statusCode).toBe(200);
    const room = created.json().data.admission.lobby;
    const preview = await h.runtime.app.inject({
      url: `/v1/rooms/${room.inviteCode}?requestId=${randomUUID()}`,
      headers: headers(b.playerId, bs.sessionId),
    });
    expect(preview.json().data.preview.setup).toEqual(setup);
    const joined = await h.runtime.app.inject({
      method: 'POST',
      url: `/v1/rooms/${room.inviteCode}/join`,
      headers: headers(b.playerId, bs.sessionId),
      payload: {
        requestId: randomUUID(),
        expectedAdmissionRevision: bs.admissionRevision,
      },
    });
    expect(joined.json().data.admission.lobby.members).toHaveLength(2);
    const replacement = await h.connect(a.playerId);
    await sync(replacement.socket);
    const stale = await h.runtime.app.inject({
      method: 'DELETE',
      url: `/v1/rooms/${room.inviteCode}`,
      headers: headers(a.playerId, as.sessionId),
      payload: {
        requestId: randomUUID(),
        expectedAdmissionRevision: created.json().data.admissionRevision,
      },
    });
    expect(stale.json().error.code).toBe('SESSION_REPLACED');
  } finally {
    await h.close();
  }
});
