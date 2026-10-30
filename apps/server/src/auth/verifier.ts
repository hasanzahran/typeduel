import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';
import { z } from 'zod';
export interface Principal {
  playerId: string;
  expiresAtUtcMs: number;
}
export interface TokenVerifier {
  verifyAccessToken(token: string): Promise<Principal>;
}
/** Trusted configuration selects keys; token headers never select a key URL. */
export function createJwtVerifier(options: {
  issuer: string;
  audience: string;
  key: JWTVerifyGetKey;
  nowUtcMs?: () => number;
}): TokenVerifier {
  return {
    async verifyAccessToken(token) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        if (typeof token !== 'string' || token.length > 8192 || !token.length)
          throw new Error();
        const header = decodeProtectedHeader(token);
        if (
          header.jku !== undefined ||
          header.x5u !== undefined ||
          header.jwk !== undefined
        )
          throw new Error();
        const now = options.nowUtcMs?.() ?? Date.now();
        if (!Number.isSafeInteger(now) || now < 0) throw new Error();
        const { payload } = await Promise.race([
          jwtVerify(token, options.key, {
            issuer: options.issuer,
            audience: options.audience,
            algorithms: ['ES256', 'RS256'],
            requiredClaims: ['exp', 'sub', 'iss', 'aud', 'role'],
            currentDate: new Date(now),
          }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error()), 3000);
            timeout.unref?.();
          }),
        ]);
        const playerId = z.uuid().parse(payload.sub).toLowerCase();
        const verifiedAt = options.nowUtcMs?.() ?? Date.now();
        if (
          payload.role !== 'authenticated' ||
          !Number.isSafeInteger(payload.exp) ||
          !Number.isSafeInteger(payload.exp! * 1000) ||
          !Number.isSafeInteger(verifiedAt) ||
          payload.exp! * 1000 <= verifiedAt
        )
          throw new Error();
        return { playerId, expiresAtUtcMs: payload.exp! * 1000 };
      } catch {
        // Do not attach JOSE errors, credentials, claims or provider responses.
        throw new Error('Authentication failed');
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    },
  };
}
export function createSupabaseVerifier(options: {
  supabaseUrl: string;
}): TokenVerifier {
  let url: URL;
  try {
    url = new URL(options.supabaseUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new Error();
  } catch {
    throw new Error('Invalid authentication configuration');
  }
  const issuer = `${url.origin}/auth/v1`;
  return createJwtVerifier({
    issuer,
    audience: 'authenticated',
    key: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
      timeoutDuration: 3000,
      cooldownDuration: 30000,
      cacheMaxAge: 600000,
    }),
  });
}
