import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';

/** A local identity provider exercises the real verifier, never an identity stub. */
export async function createTokenIssuer(nowUtcMs: () => number) {
  let pair = await generateKeyPair('ES256');
  let kid = randomUUID();
  let keys = [
    { ...(await exportJWK(pair.publicKey)), kid, alg: 'ES256', use: 'sig' },
  ];
  let status = 200;
  let requests = 0;
  let gate: (() => Promise<void>) | undefined;
  const server = createServer((_request, response) => {
    requests += 1;
    void (async () => {
      await gate?.();
      response.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      response.end(
        JSON.stringify(status === 200 ? { keys } : { error: 'unavailable' }),
      );
    })().catch(() => response.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('JWKS listener has no TCP address');
  const issuer = `http://127.0.0.1:${address.port}/auth/v1`;
  return {
    issuer,
    jwksUrl: `${issuer}/.well-known/jwks.json`,
    get requests() {
      return requests;
    },
    async sign(
      playerId: string,
      claims: JWTPayload = {},
      header: Record<string, unknown> = {},
    ) {
      return new SignJWT({ role: 'authenticated', ...claims })
        .setProtectedHeader({ alg: 'ES256', kid, ...header })
        .setSubject(typeof claims.sub === 'string' ? claims.sub : playerId)
        .setIssuer(typeof claims.iss === 'string' ? claims.iss : issuer)
        .setAudience(claims.aud ?? 'authenticated')
        .setIssuedAt(Math.floor(nowUtcMs() / 1_000))
        .setExpirationTime(
          typeof claims.exp === 'number'
            ? claims.exp
            : Math.floor(nowUtcMs() / 1_000) + 3_600,
        )
        .sign(pair.privateKey);
    },
    async rotate() {
      pair = await generateKeyPair('ES256');
      kid = randomUUID();
      keys = [
        { ...(await exportJWK(pair.publicKey)), kid, alg: 'ES256', use: 'sig' },
      ];
    },
    setStatus(value: number) {
      status = value;
    },
    setGate(value?: () => Promise<void>) {
      gate = value;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
