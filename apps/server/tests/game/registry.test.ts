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

it.each([9999, 10000, null])(
  'preserves STARTING disconnect receipts across a slow creation response (%s)',
  async (offset) => {
    let captured!: () => void;
    const observed = new Promise<void>((resolve) => {
      captured = resolve;
    });
    const h = await testRuntime({
      afterLifecycleCapture(event) {
        if (event.event === 'player.disconnect') captured();
      },
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = h.store.createMatch;
    h.store.createMatch = async (input) => {
      const record = await original(input);
      await gate;
      return record;
    };
    try {
      const a = await h.connect(),
        b = await h.connect();
      const setup = { mode: 'classic', categorySlug: 'general', difficulty: 1 };
      for (const client of [a, b]) {
        const s = await sync(client.socket);
        await call(client.socket, 'queue.join', {
          requestId: randomUUID(),
          expectedAdmissionRevision: s.admissionRevision,
          setup,
        });
      }
      for (const client of [a, b]) {
        const s = await sync(client.socket);
        if (s.admission.kind !== 'lobby') throw new Error();
        await call(client.socket, 'lobby.ready', {
          requestId: randomUUID(),
          expectedAdmissionRevision: s.admissionRevision,
          lobbyId: s.admission.lobby.lobbyId,
          ready: true,
        });
      }
      expect((await sync(b.socket)).admission.kind).toBe('starting');
      await h.advance(1100);
      a.socket.disconnect();
      await observed;
      if (offset !== null) {
        await h.advance(1100 + offset);
        await h.connect(a.playerId);
      }
      await h.advance(21000);
      release();
      let final = await sync(b.socket);
      for (let i = 0; i < 10 && final.admission.kind === 'starting'; i++) {
        await h.advance(21000);
        final = await sync(b.socket);
      }
      expect(final.admission.kind).toBe('match');
      if (final.admission.kind === 'match')
        expect(final.admission.update.snapshot.phase).toBe(
          offset === 9999 ? 'PREPARING_ROUND' : 'ABORTED',
        );
    } finally {
      release();
      await h.close();
    }
  },
);

it.each(['winner', 'draw'] as const)(
  'drives a complete %s through source preparation and terminal recovery',
  async (outcome) => {
    const h = await testRuntime();
    try {
      const { a, b, state } = await pair(h);
      if (state.admission.kind !== 'match') throw new Error();
      const matchId = state.admission.update.matchId;
      const rounds = outcome === 'winner' ? 5 : 8;
      for (let number = 1; number <= rounds; number++) {
        const view = await sync(a.socket);
        if (
          view.admission.kind !== 'match' ||
          view.admission.update.snapshot.phase !== 'PREPARING_ROUND'
        )
          throw new Error('Expected preparation');
        const round = view.admission.update.snapshot.round!;
        for (const client of [a, b])
          await call(client.socket, 'round.audio_ready', {
            matchId,
            roundId: round.roundId,
            audioVersion: round.audio.audioVersion,
          });
        const schedule = h.records.get(matchId)!.state.round!.monoSchedule!;
        await h.advance(
          outcome === 'winner' ? schedule.typingStartAt : schedule.deadlineAt,
        );
        if (outcome === 'winner')
          await call(a.socket, 'answer.submit', {
            matchId,
            roundId: round.roundId,
            attemptId: randomUUID(),
            text: `synthetic-${number}`,
          });
        await h.advance(h.clock.monoNow());
      }
      const final = await sync(a.socket);
      if (final.admission.kind !== 'match') throw new Error();
      expect(final.admission.update.snapshot.phase).toBe('COMPLETED');
      expect(h.records.get(matchId)?.state.completion?.draw).toBe(
        outcome === 'draw',
      );
      await h.advance(h.clock.monoNow() + 1000);
      const recovered = await sync(b.socket);
      expect(recovered.admission.kind).toBe('match');
      if (recovered.admission.kind === 'match')
        expect(recovered.admission.update.snapshot.stateVersion).toBe(
          final.admission.update.snapshot.stateVersion,
        );
    } finally {
      await h.close();
    }
  },
);

it('continues next-round lifecycle after a committed publication hook fails', async () => {
  let fail = false;
  const h = await testRuntime({
    actor(point) {
      if (fail && point === 'before_publish')
        throw new Error('private hook failure');
    },
  });
  try {
    const { a, b, state } = await pair(h);
    if (
      state.admission.kind !== 'match' ||
      state.admission.update.snapshot.phase !== 'PREPARING_ROUND'
    )
      throw new Error();
    const s = state.admission.update.snapshot;
    for (const client of [a, b])
      await call(client.socket, 'round.audio_ready', {
        matchId: s.matchId,
        roundId: s.round!.roundId,
        audioVersion: s.round!.audio.audioVersion,
      });
    await h.advance(
      h.records.get(s.matchId)!.state.round!.monoSchedule!.typingStartAt,
    );
    fail = true;
    await call(a.socket, 'answer.submit', {
      matchId: s.matchId,
      roundId: s.round!.roundId,
      attemptId: randomUUID(),
      text: 'synthetic-1',
    });
    expect(h.records.get(s.matchId)?.state.phase).toBe('ROUND_RESULT');
    fail = false;
    await h.runtime.reconcile();
    await h.advance(h.clock.monoNow());
    expect(h.records.get(s.matchId)?.state.roundNumber).toBe(2);
  } finally {
    await h.close();
  }
});

it('rejects a foreign live match sync before advancing its actor clock', async () => {
  const h = await testRuntime();
  try {
    const { a, b, state } = await pair(h);
    if (
      state.admission.kind !== 'match' ||
      state.admission.update.snapshot.phase !== 'PREPARING_ROUND'
    )
      throw new Error();
    const snapshot = state.admission.update.snapshot;
    for (const client of [a, b])
      await call(client.socket, 'round.audio_ready', {
        matchId: snapshot.matchId,
        roundId: snapshot.round!.roundId,
        audioVersion: snapshot.round!.audio.audioVersion,
      });
    const before = structuredClone(h.records.get(snapshot.matchId)!);
    const stranger = await h.connect();
    h.setNow(before.state.round!.monoSchedule!.deadlineAt);
    await expect(
      call(stranger.socket, 'match.sync', {
        lastSeenVersion: 0,
        requestId: randomUUID(),
        matchId: snapshot.matchId,
      }),
    ).rejects.toThrow('UNAUTHORIZED');
    expect(h.records.get(snapshot.matchId)).toEqual(before);
  } finally {
    await h.close();
  }
});
