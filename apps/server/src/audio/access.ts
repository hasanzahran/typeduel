import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  AUDIO_GRANT_TTL_MS,
  MAX_AUDIO_BYTES,
  type AudioDescriptor,
} from '@typeduel/contracts';
import type { OwnerLease } from '../db/types.js';
import type { ActorClock } from '../game/clock.js';
import { TransportFailure } from '../socket/limits.js';

export interface PrivateAssetReader {
  read(identity: {
    assetId: string;
    audioVersion: string;
  }): Promise<Uint8Array>;
}

export interface AudioRuntimeOptions {
  reader: PrivateAssetReader;
  publicOrigin: string;
  signingKey: Uint8Array;
}

const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const claimsSchema = z.strictObject({
  serverInstanceId: z.uuid(),
  sessionId: z.uuid(),
  admissionRevision: safeInteger,
  playerId: z.uuid(),
  matchId: z.uuid(),
  roundId: z.uuid(),
  assetId: z.uuid(),
  audioVersion: z.uuid(),
  ownerId: z.uuid(),
  ownerEpoch: z.string().regex(/^[0-9]+$/),
  expiresMonoMs: safeInteger,
});

export type AudioIdentity = Pick<
  z.infer<typeof claimsSchema>,
  | 'serverInstanceId'
  | 'sessionId'
  | 'admissionRevision'
  | 'playerId'
  | 'matchId'
  | 'roundId'
  | 'assetId'
  | 'audioVersion'
>;

export function validatePublicOrigin(raw: string): string {
  try {
    const url = new URL(raw);
    const localHttp =
      url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      (url.protocol !== 'https:' && !localHttp)
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new Error('Invalid audio configuration');
  }
}

export function createAudioAccess(
  options: AudioRuntimeOptions & {
    clock: ActorClock;
    owner: OwnerLease;
    authorize(identity: AudioIdentity): AudioDescriptor;
  },
) {
  const origin = validatePublicOrigin(options.publicOrigin);
  const key = Buffer.from(options.signingKey);
  if (key.length < 32) throw new Error('Invalid audio configuration');

  const unauthorized = () => new TransportFailure('UNAUTHORIZED');
  const assertOwner = () => {
    if (!options.owner.isActive())
      throw new TransportFailure('SERVER_UNAVAILABLE');
  };
  const sign = (payload: string) =>
    createHmac('sha256', key).update(payload).digest('base64url');
  const authorize = (identity: AudioIdentity) => {
    assertOwner();
    return options.authorize(identity);
  };

  async function readVerified(identity: AudioIdentity): Promise<Uint8Array> {
    const descriptor = authorize(identity);
    let data: Uint8Array;
    try {
      data = Uint8Array.from(await options.reader.read(identity));
    } catch {
      throw new TransportFailure('SOURCE_UNAVAILABLE');
    }
    const current = authorize(identity);
    if (
      current.sha256 !== descriptor.sha256 ||
      data.length === 0 ||
      data.length > MAX_AUDIO_BYTES ||
      createHash('sha256').update(data).digest('hex') !== descriptor.sha256
    )
      throw new TransportFailure('SOURCE_UNAVAILABLE');
    return data;
  }

  function parseGrant(grant: string): z.infer<typeof claimsSchema> {
    try {
      if (grant.length > 4096) throw unauthorized();
      const parts = grant.split('.');
      if (
        parts.length !== 2 ||
        !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))
      )
        throw unauthorized();
      const signature = Buffer.from(parts[1]!, 'base64url');
      const expected = Buffer.from(sign(parts[0]!), 'base64url');
      if (
        signature.length !== expected.length ||
        !timingSafeEqual(signature, expected)
      )
        throw unauthorized();
      return claimsSchema.parse(
        JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')),
      );
    } catch {
      throw unauthorized();
    }
  }

  return {
    async issue(identity: AudioIdentity) {
      const data = await readVerified(identity);
      const expiresAt = options.clock.utcNow() + AUDIO_GRANT_TTL_MS;
      const expiresMonoMs = options.clock.monoNow() + AUDIO_GRANT_TTL_MS;
      if (
        !Number.isSafeInteger(expiresAt) ||
        !Number.isSafeInteger(expiresMonoMs)
      )
        throw unauthorized();
      const claims = claimsSchema.parse({
        ...identity,
        ownerId: options.owner.token.ownerId,
        ownerEpoch: String(options.owner.token.epoch),
        expiresMonoMs,
      });
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
      return {
        url: `${origin}/v1/audio/${identity.assetId}/${identity.audioVersion}?grant=${payload}.${sign(payload)}`,
        expiresAt,
        byteLength: data.length,
      };
    },

    async download(
      grant: string,
      viewer: { playerId: string; sessionId: string },
      asset: { assetId: string; audioVersion: string },
    ) {
      const claims = parseGrant(grant);
      const validate = () => {
        assertOwner();
        if (
          claims.playerId !== viewer.playerId ||
          claims.sessionId !== viewer.sessionId ||
          claims.assetId !== asset.assetId ||
          claims.audioVersion !== asset.audioVersion ||
          claims.ownerId !== options.owner.token.ownerId ||
          claims.ownerEpoch !== String(options.owner.token.epoch) ||
          options.clock.monoNow() >= claims.expiresMonoMs
        )
          throw unauthorized();
      };
      validate();
      const data = await readVerified(claims);
      validate();
      return data;
    },
  };
}

export type AudioAccess = ReturnType<typeof createAudioAccess>;
