import { createHash, randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { AudioRuntimeOptions } from '../../src/audio/access.js';
import type { RoundSource } from '../../src/game/source.js';
import { call, pair, sync, testRuntime } from '../game/runtime-fixtures.js';

function reviewedAudio(
  reader: AudioRuntimeOptions['reader'] = {
    async read() {
      return Buffer.from('reviewed fixture bytes');
    },
  },
) {
  const bytes = Buffer.from('reviewed fixture bytes');
  const assetId = randomUUID();
  const audioVersion = randomUUID();
  const source: RoundSource = {
    async checkAvailability() {
      return true;
    },
    async nextRound(input) {
      return {
        roundId: randomUUID(),
        wordId: randomUUID(),
        canonicalText: 'private-answer-never-on-wire',
        acceptedVariants: [],
        level: input.level,
        categorySlugs: ['general'],
        audio: {
          assetId,
          audioVersion,
          url: `https://audio.example/v1/audio/${assetId}/${audioVersion}`,
          clipDurationMs: 500,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      };
    },
  };
  const audio: AudioRuntimeOptions = {
    reader,
    publicOrigin: 'https://audio.example',
    signingKey: Buffer.alloc(32, 5),
  };
  return { audio, source };
}

function headers(playerId: string, sessionId: string) {
  return {
    authorization: `Bearer ${playerId}`,
    'x-typeduel-session-id': sessionId,
  };
}

function currentRound(state: Awaited<ReturnType<typeof sync>>) {
  if (state.admission.kind !== 'match') throw new Error('Expected match');
  const update = state.admission.update;
  const snapshot = update.snapshot;
  switch (snapshot.phase) {
    case 'PREPARING_ROUND':
    case 'COUNTDOWN':
    case 'PLAYING_WORD':
    case 'ACTIVE_TYPING':
      break;
    default:
      throw new Error('Expected current round');
  }
  if (!snapshot.round) throw new Error('Expected current round');
  return {
    matchId: update.matchId,
    round: snapshot.round,
    sessionId: state.sessionId,
  };
}

it('requires an authenticated current participant and exact current round before issuing a private audio URL', async () => {
  const fixture = reviewedAudio();
  const h = await testRuntime(undefined, fixture);
  try {
    const { a, state } = await pair(h);
    const current = currentRound(state);
    const { round } = current;
    const payload = {
      requestId: randomUUID(),
      roundId: round.roundId,
      assetId: round.audio.assetId,
      audioVersion: round.audio.audioVersion,
    };
    const unauthenticated = await h.runtime.app.inject({
      method: 'POST',
      url: `/v1/matches/${current.matchId}/audio-access`,
      payload,
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json().error.code).toBe('UNAUTHENTICATED');

    const issued = await h.runtime.app.inject({
      method: 'POST',
      url: `/v1/matches/${current.matchId}/audio-access`,
      headers: headers(a.playerId, current.sessionId),
      payload,
    });
    expect(issued.statusCode).toBe(200);
    expect(issued.json().data.url).toMatch(
      new RegExp(`^https://audio\\.example/v1/audio/${round.audio.assetId}/`),
    );
    expect(issued.body).not.toContain('private-answer-never-on-wire');
    expect(issued.body).not.toContain('reviewed fixture bytes');

    const staleRound = await h.runtime.app.inject({
      method: 'POST',
      url: `/v1/matches/${current.matchId}/audio-access`,
      headers: headers(a.playerId, current.sessionId),
      payload: { ...payload, requestId: randomUUID(), roundId: randomUUID() },
    });
    expect(staleRound.statusCode).toBe(403);
    expect(staleRound.json().error.code).toBe('UNAUTHORIZED');
  } finally {
    await h.close();
  }
});

it('rejects a grant from another player, a modified grant, and an expired grant without reflecting the opaque token', async () => {
  const fixture = reviewedAudio();
  const h = await testRuntime(undefined, fixture);
  try {
    const { a, b, state } = await pair(h);
    const current = currentRound(state);
    const { round } = current;
    const issued = await h.runtime.app.inject({
      method: 'POST',
      url: `/v1/matches/${current.matchId}/audio-access`,
      headers: headers(a.playerId, current.sessionId),
      payload: {
        requestId: randomUUID(),
        roundId: round.roundId,
        assetId: round.audio.assetId,
        audioVersion: round.audio.audioVersion,
      },
    });
    const url = new URL(issued.json().data.url);
    const grant = url.searchParams.get('grant');
    if (!grant) throw new Error('Expected grant');
    const bState = await sync(b.socket);

    const otherPlayer = await h.runtime.app.inject({
      url: `${url.pathname}${url.search}`,
      headers: headers(b.playerId, bState.sessionId),
    });
    expect(otherPlayer.statusCode).toBe(403);
    expect(otherPlayer.json().code).toBe('UNAUTHORIZED');

    const alteredGrant = `${grant.slice(0, -1)}${grant.endsWith('a') ? 'b' : 'a'}`;
    const tampered = await h.runtime.app.inject({
      url: `${url.pathname}?grant=${alteredGrant}`,
      headers: headers(b.playerId, bState.sessionId),
    });
    expect(tampered.statusCode).toBe(403);
    expect(tampered.json().code).toBe('UNAUTHORIZED');
    expect(tampered.body).not.toContain(grant);
    expect(tampered.body).not.toContain(alteredGrant);

    h.setNow(61_001);
    const expired = await h.runtime.app.inject({
      url: `${url.pathname}${url.search}`,
      headers: headers(a.playerId, current.sessionId),
    });
    expect(expired.statusCode).toBe(403);
    expect(expired.json().code).toBe('UNAUTHORIZED');
    expect(expired.body).not.toContain(grant);
  } finally {
    await h.close();
  }
});

it('revalidates the round scope after a slow byte read, so a terminal transition cannot mint a URL', async () => {
  let releaseRead!: (bytes: Buffer) => void;
  const reader = {
    read: vi.fn(
      () => new Promise<Buffer>((resolve) => (releaseRead = resolve)),
    ),
  };
  const fixture = reviewedAudio(reader);
  const h = await testRuntime(undefined, fixture);
  try {
    const { a, state } = await pair(h);
    const current = currentRound(state);
    const { round } = current;
    const issuing = h.runtime.app.inject({
      method: 'POST',
      url: `/v1/matches/${current.matchId}/audio-access`,
      headers: headers(a.playerId, current.sessionId),
      payload: {
        requestId: randomUUID(),
        roundId: round.roundId,
        assetId: round.audio.assetId,
        audioVersion: round.audio.audioVersion,
      },
    });
    await vi.waitFor(() => expect(reader.read).toHaveBeenCalledTimes(1));
    await call(a.socket, 'round.audio_failed', {
      matchId: current.matchId,
      roundId: round.roundId,
      audioVersion: round.audio.audioVersion,
      reason: 'DOWNLOAD_FAILED',
    });
    releaseRead(Buffer.from('reviewed fixture bytes'));

    const response = await issuing;
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  } finally {
    await h.close();
  }
});
