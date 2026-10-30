import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTPayload,
} from 'jose';
import {
  createJwtVerifier,
  createSupabaseVerifier,
} from '../../src/auth/verifier.js';
const now = 1_800_000_000_000;
const subject = 'c0ffee00-0000-4000-8000-000000000001';
const issuer = 'https://auth.invalid/auth/v1';
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let keys: ReturnType<typeof createLocalJWKSet>;
beforeAll(async () => {
  pair = await generateKeyPair('ES256');
  keys = createLocalJWKSet({
    keys: [
      { ...(await exportJWK(pair.publicKey)), kid: 'reviewed', alg: 'ES256' },
    ],
  });
});
afterEach(() => vi.useRealTimers());
function verifier() {
  return createJwtVerifier({
    issuer,
    audience: 'authenticated',
    key: keys,
    nowUtcMs: () => now,
  });
}
function sign(claims: JWTPayload = {}, header: Record<string, string> = {}) {
  return new SignJWT({
    sub: subject,
    iss: issuer,
    aud: 'authenticated',
    role: 'authenticated',
    exp: now / 1000 + 60,
    ...claims,
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'reviewed', ...header })
    .sign(pair.privateKey);
}
describe('trusted JWT verification', () => {
  it('verifies a real signature and returns only normalized identity and expiry', async () => {
    const token = await sign({
      sub: subject.toUpperCase(),
      email: 'private@example.invalid',
    });
    expect(await verifier().verifyAccessToken(token)).toEqual({
      playerId: subject,
      expiresAtUtcMs: now + 60000,
    });
  });
  it.each([
    { exp: now / 1000 },
    { exp: now / 1000 - 1 },
    { nbf: now / 1000 + 1 },
    { iss: 'https://other.invalid' },
    { aud: 'service_role' },
    { role: 'service_role' },
    { role: 'anon' },
    { sub: 'not-a-user' },
    { exp: now / 1000 + 0.5 },
    { exp: Number.MAX_SAFE_INTEGER },
  ])('rejects invalid claims without exposing them: %j', async (claims) => {
    await expect(
      verifier().verifyAccessToken(await sign(claims)),
    ).rejects.toThrow(/^Authentication failed$/);
  });
  it('requires expiry and refuses malformed or oversized inputs', async () => {
    const missing = await new SignJWT({
      sub: subject,
      iss: issuer,
      aud: 'authenticated',
      role: 'authenticated',
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'reviewed' })
      .sign(pair.privateKey);
    for (const token of [missing, '', 'invalid', 'x'.repeat(8193)]) {
      await expect(verifier().verifyAccessToken(token)).rejects.toThrow(
        /^Authentication failed$/,
      );
    }
  });
  it('rejects untrusted key URLs and unknown keys', async () => {
    for (const header of [
      { jku: 'https://attacker.invalid' },
      { x5u: 'https://attacker.invalid' },
      { kid: 'missing' },
    ]) {
      await expect(
        verifier().verifyAccessToken(await sign({}, header)),
      ).rejects.toThrow(/^Authentication failed$/);
    }
  });
  it('rejects wrong signatures and HMAC algorithm substitution', async () => {
    const other = await generateKeyPair('ES256');
    const token = await new SignJWT({ sub: subject })
      .setProtectedHeader({ alg: 'ES256', kid: 'reviewed' })
      .sign(other.privateKey);
    await expect(verifier().verifyAccessToken(token)).rejects.toThrow(
      /^Authentication failed$/,
    );
    const hmac = await new SignJWT({ sub: subject })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new Uint8Array(32));
    await expect(verifier().verifyAccessToken(hmac)).rejects.toThrow(
      /^Authentication failed$/,
    );
  });
  it('bounds a stalled key provider and sanitizes provider errors', async () => {
    const token = await sign();
    vi.useFakeTimers();
    const stalled = createJwtVerifier({
      issuer,
      audience: 'authenticated',
      nowUtcMs: () => now,
      key: () => new Promise(() => {}),
    });
    const result = expect(stalled.verifyAccessToken(token)).rejects.toThrow(
      /^Authentication failed$/,
    );
    await vi.advanceTimersByTimeAsync(3000);
    await result;
    const failing = createJwtVerifier({
      issuer,
      audience: 'authenticated',
      key: () => {
        throw new Error('credential or provider body');
      },
    });
    await expect(failing.verifyAccessToken(token)).rejects.toThrow(
      /^Authentication failed$/,
    );
  });
  it('rejects expiry reached while key verification is in flight', async () => {
    let current = now;
    const delayed = createJwtVerifier({
      issuer,
      audience: 'authenticated',
      nowUtcMs: () => current,
      key: async () => {
        current = now + 1000;
        return pair.publicKey;
      },
    });
    await expect(
      delayed.verifyAccessToken(await sign({ exp: now / 1000 + 1 })),
    ).rejects.toThrow(/^Authentication failed$/);
  });
  it('accepts only an explicit HTTPS project origin in production configuration', () => {
    expect(() =>
      createSupabaseVerifier({ supabaseUrl: 'https://project.supabase.co' }),
    ).not.toThrow();
    for (const url of [
      'invalid',
      'http://localhost:1234',
      'https://user:pass@project.supabase.co',
      'https://project.supabase.co?token=x',
      'https://project.supabase.co/path',
      'https://project.supabase.co/#fragment',
    ]) {
      expect(() => createSupabaseVerifier({ supabaseUrl: url })).toThrow(
        /^Invalid authentication configuration$/,
      );
    }
  });
});
