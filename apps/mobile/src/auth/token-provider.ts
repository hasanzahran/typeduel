import { HandshakeSchema } from '@typeduel/contracts';

/** Provider sign-in/refresh belongs to the host. No credentials are stored here. */
export interface TokenProvider {
  getAccessToken(): Promise<string | null>;
}
export class AuthenticationRequired extends Error {
  constructor() {
    super('Authentication required');
    this.name = 'AuthenticationRequired';
  }
}
export async function requireAccessToken(
  provider: TokenProvider,
): Promise<string> {
  let token: unknown;
  try {
    token = await provider.getAccessToken();
  } catch {
    throw new AuthenticationRequired();
  }
  const result = HandshakeSchema.safeParse({ accessToken: token });
  if (!result.success) throw new AuthenticationRequired();
  return result.data.accessToken;
}
