import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { testRuntime, pair, call, sync } from './runtime-fixtures.js';
describe('runtime registry over real sockets with isolated component store', () => {
  it('creates exactly one match and advances a durable correct answer without exposing private state', async () => {
    const h = await testRuntime();
    try {
      const { a, b, state } = await pair(h);
      if (state.admission.kind !== 'match') throw new Error();
      const snapshot = state.admission.update.snapshot;
      if (snapshot.phase !== 'PREPARING_ROUND') throw new Error();
      const round = snapshot.round!;
      expect(JSON.stringify(state)).not.toContain('synthetic-1');
      for (const client of [a, b])
        await call(client.socket, 'round.audio_ready', {
          matchId: snapshot.matchId,
          roundId: round.roundId,
          audioVersion: round.audio.audioVersion,
        });
      const record = h.records.get(snapshot.matchId)!;
      await h.advance(record.state.round!.monoSchedule!.typingStartAt);
      const attemptId = randomUUID();
      const result = await call<{ ack: { status: string } }>(
        a.socket,
        'answer.submit',
        {
          matchId: snapshot.matchId,
          roundId: round.roundId,
          attemptId,
          text: 'synthetic-1',
        },
      );
      expect(result.ack.status).toBe('CORRECT');
      expect(h.records.get(snapshot.matchId)?.state.participants[0].score).toBe(
        1,
      );
      expect(h.store.createMatch).toHaveBeenCalledTimes(1);
      await h.advance(h.clock.monoNow());
      expect(h.records.get(snapshot.matchId)?.state.roundNumber).toBe(2);
    } finally {
      await h.close();
    }
  });
  it('fences superseded sockets and ignores their disconnect for the new session', async () => {
    const h = await testRuntime();
    try {
      const a = await h.connect();
      const old = await sync(a.socket);
      const replaced = new Promise<unknown>((resolve) =>
        a.socket.once('game.error', resolve),
      );
      const next = await h.connect(a.playerId);
      expect(await replaced).toMatchObject({ code: 'SESSION_REPLACED' });
      const current = await sync(next.socket);
      expect(current.sessionId).not.toBe(old.sessionId);
      expect(current.admission.kind).toBe('idle');
    } finally {
      await h.close();
    }
  });
});

it('replacement clears unscheduled readiness before another player can start the round', async () => {
  const h = await testRuntime();
  try {
    const { a, b, state } = await pair(h);
    if (
      state.admission.kind !== 'match' ||
      state.admission.update.snapshot.phase !== 'PREPARING_ROUND'
    )
      throw new Error();
    const s = state.admission.update.snapshot;
    const payload = {
      matchId: s.matchId,
      roundId: s.round!.roundId,
      audioVersion: s.round!.audio.audioVersion,
    };
    await call(a.socket, 'round.audio_ready', payload);
    const replacement = await h.connect(a.playerId);
    await sync(replacement.socket);
    await call(b.socket, 'round.audio_ready', payload);
    expect(h.records.get(s.matchId)?.state.phase).toBe('PREPARING_ROUND');
    await call(replacement.socket, 'round.audio_ready', payload);
    expect(h.records.get(s.matchId)?.state.phase).toBe('COUNTDOWN');
  } finally {
    await h.close();
  }
});
