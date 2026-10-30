import { randomUUID } from 'node:crypto';
import { it, expect } from 'vitest';
import { io } from 'socket.io-client';
import { testRuntime, call, sync } from '../game/runtime-fixtures.js';
it('deduplicates control mutations and fences stale revisions after request expiry', async () => {
  const h = await testRuntime();
  try {
    const a = await h.connect();
    const s = await sync(a.socket);
    const join = {
      requestId: randomUUID(),
      expectedAdmissionRevision: s.admissionRevision,
      setup: { mode: 'classic', categorySlug: 'general', difficulty: 1 },
    };
    const first = await call(a.socket, 'queue.join', join);
    expect(await call(a.socket, 'queue.join', join)).toEqual(first);
    await expect(
      call(a.socket, 'queue.join', {
        ...join,
        setup: { ...join.setup, difficulty: 2 },
      }),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    const queued = await sync(a.socket);
    await call(a.socket, 'queue.leave', {
      requestId: randomUUID(),
      expectedAdmissionRevision: queued.admissionRevision,
    });
    await h.advance(602000);
    await expect(call(a.socket, 'queue.join', join)).rejects.toThrow(
      'RETRY_WINDOW_EXPIRED',
    );
    expect((await sync(a.socket)).admission.kind).toBe('idle');
  } finally {
    await h.close();
  }
});

it('does not let a pending availability check race a newer cross-action mutation', async () => {
  let release!: (value: boolean) => void;
  let entered!: () => void;
  const gate = new Promise<boolean>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const h = await testRuntime(undefined, {
    checkAvailability: () => {
      entered();
      return gate;
    },
  });
  try {
    const a = await h.connect();
    const initial = await sync(a.socket);
    const firstRequest = {
      requestId: randomUUID(),
      expectedAdmissionRevision: initial.admissionRevision,
      setup: { mode: 'classic', categorySlug: 'general', difficulty: 1 },
    };
    const pending = call(a.socket, 'queue.join', firstRequest);
    await started;
    const during = await sync(a.socket);
    await expect(
      call(a.socket, 'queue.join', {
        ...firstRequest,
        requestId: randomUUID(),
        expectedAdmissionRevision: during.admissionRevision,
      }),
    ).rejects.toThrow('ADMISSION_CONFLICT');
    await expect(
      call(a.socket, 'queue.leave', {
        requestId: randomUUID(),
        expectedAdmissionRevision: during.admissionRevision,
      }),
    ).rejects.toThrow('ADMISSION_CONFLICT');
    release(true);
    await pending;
    expect((await sync(a.socket)).admission.kind).toBe('queued');
  } finally {
    release(false);
    await h.close();
  }
});

it('correlates rate-limit and delivery-fallback control errors without adding IDs to gameplay errors', async () => {
  let failDelivery = false;
  const h = await testRuntime({
    outbound(event) {
      if (failDelivery && event.kind === 'ack')
        throw new Error('private failure');
      return 'send';
    },
  });
  try {
    const a = await h.connect();
    await sync(a.socket);
    failDelivery = true;
    const fallbackId = randomUUID();
    expect(
      await a.socket.emitWithAck('session.sync', { requestId: fallbackId }),
    ).toEqual({
      ok: false,
      error: { code: 'SERVER_UNAVAILABLE', requestId: fallbackId },
    });
    failDelivery = false;
    for (let i = 0; i < 20; i++)
      await a.socket.emitWithAck('session.sync', { requestId: randomUUID() });
    const requestId = randomUUID();
    expect(await a.socket.emitWithAck('session.sync', { requestId })).toEqual({
      ok: false,
      error: { code: 'RATE_LIMITED', requestId },
    });
    expect(await a.socket.emitWithAck('answer.submit', { requestId })).toEqual({
      ok: false,
      error: { code: 'RATE_LIMITED', requestId: null },
    });
  } finally {
    await h.close();
  }
});

it('reclaims disconnected idle users only after their settled retry cache expires', async () => {
  const h = await testRuntime(undefined, { config: { maxPlayers: 1 } });
  try {
    const a = await h.connect();
    const initial = await sync(a.socket);
    await call(a.socket, 'queue.join', {
      requestId: randomUUID(),
      expectedAdmissionRevision: initial.admissionRevision,
      setup: { mode: 'classic', categorySlug: 'general', difficulty: 1 },
    });
    a.socket.disconnect();
    await new Promise<void>(setImmediate);
    const rejected = io(`${h.origin}/game`, {
      transports: ['websocket'],
      reconnection: false,
      autoConnect: false,
      auth: { accessToken: randomUUID() },
    });
    try {
      const error = new Promise((resolve) =>
        rejected.once('game.error', resolve),
      );
      rejected.connect();
      expect(await error).toMatchObject({ code: 'RATE_LIMITED' });
    } finally {
      rejected.disconnect();
    }
    await h.advance(602000);
    const b = await h.connect();
    expect((await sync(b.socket)).admission.kind).toBe('idle');
  } finally {
    await h.close();
  }
});

it('reclaims an idle disconnected user with no outstanding retry history', async () => {
  const h = await testRuntime(undefined, { config: { maxPlayers: 1 } });
  try {
    const a = await h.connect();
    await sync(a.socket);
    a.socket.disconnect();
    await new Promise<void>(setImmediate);
    const b = await h.connect();
    expect((await sync(b.socket)).admission.kind).toBe('idle');
  } finally {
    await h.close();
  }
});
