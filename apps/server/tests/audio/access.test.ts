import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AudioDescriptor } from '@typeduel/contracts';
import {
  createAudioAccess,
  type AudioIdentity,
} from '../../src/audio/access.js';
import type { OwnerLease } from '../../src/db/types.js';
import type { ActorClock } from '../../src/game/clock.js';

function fixture() {
  const bytes = Buffer.from('approved private audio bytes');
  const identity: AudioIdentity = {
    serverInstanceId: randomUUID(),
    sessionId: randomUUID(),
    admissionRevision: 4,
    playerId: randomUUID(),
    matchId: randomUUID(),
    roundId: randomUUID(),
    assetId: randomUUID(),
    audioVersion: randomUUID(),
  };
  const descriptor: AudioDescriptor = {
    assetId: identity.assetId,
    audioVersion: identity.audioVersion,
    url: `https://audio.example/v1/audio/${identity.assetId}/${identity.audioVersion}`,
    clipDurationMs: 500,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  let mono = 1000;
  let utc = 1_800_000_000_000;
  let active = true;
  let permitted = true;
  const owner: OwnerLease = {
    token: { ownerId: randomUUID(), epoch: 7n },
    backendPid: 1,
    schemaName: 'test',
    isActive: () => active,
    onLost: () => () => {},
    async release() {
      active = false;
    },
  };
  const clock: ActorClock = {
    monoNow: () => mono,
    utcNow: () => utc,
    schedule: () => () => {},
  };
  const reader = vi.fn(async (): Promise<Uint8Array> => Uint8Array.from(bytes));
  const access = createAudioAccess({
    reader: { read: reader },
    publicOrigin: 'https://audio.example',
    signingKey: Buffer.alloc(32, 9),
    clock,
    owner,
    authorize(request) {
      if (!permitted || request.roundId !== identity.roundId)
        throw new Error('stale round scope');
      return descriptor;
    },
  });
  return {
    access,
    bytes,
    descriptor,
    identity,
    owner,
    reader,
    setMono(value: number) {
      mono = value;
    },
    setUtc(value: number) {
      utc = value;
    },
    revokeRound() {
      permitted = false;
    },
  };
}

function grantFrom(url: string) {
  const grant = new URL(url).searchParams.get('grant');
  if (!grant) throw new Error('Missing grant');
  return grant;
}

describe('private audio grants', () => {
  it('binds a verified grant to its viewer, asset, owner epoch, and 60-second monotonic lifetime', async () => {
    const h = fixture();
    const issued = await h.access.issue(h.identity);
    const grant = grantFrom(issued.url);

    expect(issued.byteLength).toBe(h.bytes.length);
    expect(issued.expiresAt).toBe(1_800_000_060_000);
    await expect(
      h.access.download(
        grant,
        { playerId: h.identity.playerId, sessionId: h.identity.sessionId },
        { assetId: h.identity.assetId, audioVersion: h.identity.audioVersion },
      ),
    ).resolves.toEqual(Uint8Array.from(h.bytes));

    await expect(
      h.access.download(
        grant,
        { playerId: randomUUID(), sessionId: h.identity.sessionId },
        { assetId: h.identity.assetId, audioVersion: h.identity.audioVersion },
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(
      h.access.download(
        grant,
        { playerId: h.identity.playerId, sessionId: randomUUID() },
        { assetId: h.identity.assetId, audioVersion: h.identity.audioVersion },
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(
      h.access.download(
        grant,
        { playerId: h.identity.playerId, sessionId: h.identity.sessionId },
        { assetId: randomUUID(), audioVersion: h.identity.audioVersion },
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    h.setMono(61_000);
    await expect(
      h.access.download(
        grant,
        { playerId: h.identity.playerId, sessionId: h.identity.sessionId },
        { assetId: h.identity.assetId, audioVersion: h.identity.audioVersion },
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects malformed or modified grants without exposing their contents', async () => {
    const h = fixture();
    const issued = await h.access.issue(h.identity);
    const grant = grantFrom(issued.url);
    const tampered = `${grant.slice(0, -1)}${grant.endsWith('a') ? 'b' : 'a'}`;

    await expect(
      h.access.download(
        tampered,
        { playerId: h.identity.playerId, sessionId: h.identity.sessionId },
        { assetId: h.identity.assetId, audioVersion: h.identity.audioVersion },
      ),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Request could not be completed',
    });
    await expect(
      h.access.download(
        'not-a-grant',
        { playerId: h.identity.playerId, sessionId: h.identity.sessionId },
        { assetId: h.identity.assetId, audioVersion: h.identity.audioVersion },
      ),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Request could not be completed',
    });
  });

  it('rechecks both current round authorization and ownership after awaited byte reads', async () => {
    const h = fixture();
    let releaseRead!: (bytes: Uint8Array) => void;
    h.reader.mockImplementationOnce(
      () => new Promise<Uint8Array>((resolve) => (releaseRead = resolve)),
    );
    const issuing = h.access.issue(h.identity);
    await vi.waitFor(() => expect(h.reader).toHaveBeenCalledTimes(1));
    h.revokeRound();
    releaseRead(h.bytes);
    await expect(issuing).rejects.toMatchObject({
      message: 'stale round scope',
    });

    const fresh = fixture();
    const issued = await fresh.access.issue(fresh.identity);
    let releaseDownload!: (bytes: Uint8Array) => void;
    fresh.reader.mockImplementationOnce(
      () => new Promise<Uint8Array>((resolve) => (releaseDownload = resolve)),
    );
    const downloading = fresh.access.download(
      grantFrom(issued.url),
      {
        playerId: fresh.identity.playerId,
        sessionId: fresh.identity.sessionId,
      },
      {
        assetId: fresh.identity.assetId,
        audioVersion: fresh.identity.audioVersion,
      },
    );
    await vi.waitFor(() => expect(fresh.reader).toHaveBeenCalledTimes(2));
    await fresh.owner.release();
    releaseDownload(fresh.bytes);
    await expect(downloading).rejects.toMatchObject({
      code: 'SERVER_UNAVAILABLE',
    });
  });
});
