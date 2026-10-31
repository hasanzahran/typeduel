import { z } from 'zod';
import type { TokenProvider } from './token-provider';

const SessionSchema = z.strictObject({
  access_token: z.string().min(1).max(8192),
  refresh_token: z.string().min(1).max(8192),
  expires_in: z.number().int().positive().max(86_400),
  token_type: z.string().min(1).max(32),
  user: z.object({ id: z.uuid() }).passthrough(),
});
type Session = z.infer<typeof SessionSchema>;
export interface SupabaseSessionView {
  userId: string;
  expiresAt: number;
}
export type AuthFetch = typeof fetch;

function authOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Supabase URL must be a credential-free HTTPS origin');
  return url.origin;
}

/** In-memory development session provider with fenced, single-flight refresh. */
export class SupabaseSessionProvider implements TokenProvider {
  private session: Session | null = null;
  private expiresAt = 0;
  private generation = 0;
  private refreshOperation: Promise<string | null> | null = null;
  private readonly origin: string;

  constructor(
    projectUrl: string,
    private readonly publishableKey: string,
    private readonly authFetch: AuthFetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.origin = authOrigin(projectUrl);
    if (!publishableKey || publishableKey.length > 8192)
      throw new Error('A Supabase publishable key is required');
  }

  get current(): SupabaseSessionView | null {
    return this.session
      ? { userId: this.session.user.id, expiresAt: this.expiresAt }
      : null;
  }

  async signIn(email: string, password: string): Promise<SupabaseSessionView> {
    if (
      !z.email().safeParse(email).success ||
      !password ||
      password.length > 1024
    )
      throw new Error('Invalid credentials');
    const generation = ++this.generation;
    this.session = null;
    this.expiresAt = 0;
    const session = await this.exchange('password', { email, password });
    if (generation !== this.generation) throw new Error('Sign-in superseded');
    this.apply(session);
    return this.current!;
  }

  signOut(): void {
    ++this.generation;
    this.session = null;
    this.expiresAt = 0;
    this.refreshOperation = null;
  }

  async getAccessToken(): Promise<string | null> {
    const session = this.session;
    if (!session) return null;
    if (this.expiresAt - this.now() > 30_000) return session.access_token;
    if (this.refreshOperation) return this.refreshOperation;
    const generation = this.generation;
    const operation = this.exchange('refresh_token', {
      refresh_token: session.refresh_token,
    })
      .then((next) => {
        if (generation !== this.generation) return null;
        this.apply(next);
        return next.access_token;
      })
      .catch(() => {
        if (generation === this.generation) this.signOut();
        return null;
      })
      .finally(() => {
        if (this.refreshOperation === operation) this.refreshOperation = null;
      });
    this.refreshOperation = operation;
    return operation;
  }

  private apply(session: Session): void {
    this.session = session;
    this.expiresAt = this.now() + session.expires_in * 1000;
  }

  private async exchange(
    grant: 'password' | 'refresh_token',
    body: Record<string, string>,
  ): Promise<Session> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const url = `${this.origin}/auth/v1/token?grant_type=${grant}`;
      const response = await this.authFetch(url, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          apikey: this.publishableKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (
        !response.ok ||
        response.redirected ||
        new URL(response.url).origin !== this.origin
      )
        throw new Error('Authentication failed');
      const raw = await response.text();
      if (raw.length > 32_768) throw new Error('Authentication failed');
      return SessionSchema.parse(JSON.parse(raw));
    } catch {
      throw new Error('Authentication failed');
    } finally {
      clearTimeout(timeout);
    }
  }
}
