import { randomUUID } from 'node:crypto';
import { it, expect } from 'vitest';
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
