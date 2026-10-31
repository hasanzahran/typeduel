import { SupabaseSessionProvider } from './supabase-session';

const id = '00000000-0000-4000-8000-000000000001';
const session = (access = 'access', refresh = 'refresh') => ({
  access_token: access,
  refresh_token: refresh,
  expires_in: 60,
  token_type: 'bearer',
  user: { id },
});
const response = (
  value: unknown,
  url = 'https://project.supabase.co/auth/v1/token',
) =>
  ({
    ok: true,
    redirected: false,
    url,
    text: jest.fn().mockResolvedValue(JSON.stringify(value)),
  }) as unknown as Response;

test('keeps credentials and tokens in memory while sending only the publishable key header', async () => {
  const request = jest.fn().mockResolvedValue(response(session()));
  const provider = new SupabaseSessionProvider(
    'https://project.supabase.co',
    'public-key',
    request,
  );
  await provider.signIn('player@example.test', 'password');
  expect(await provider.getAccessToken()).toBe('access');
  expect(request).toHaveBeenCalledWith(
    'https://project.supabase.co/auth/v1/token?grant_type=password',
    expect.objectContaining({
      redirect: 'error',
      headers: { apikey: 'public-key', 'Content-Type': 'application/json' },
    }),
  );
  provider.signOut();
  expect(await provider.getAccessToken()).toBeNull();
});

test('refresh is single-flight and a sign-out fences its late result', async () => {
  let now = 1000;
  let finish!: (value: Response) => void;
  const request = jest
    .fn()
    .mockResolvedValueOnce(response(session()))
    .mockImplementationOnce(
      () => new Promise<Response>((resolve) => (finish = resolve)),
    );
  const provider = new SupabaseSessionProvider(
    'https://project.supabase.co',
    'public-key',
    request,
    () => now,
  );
  await provider.signIn('player@example.test', 'password');
  now += 31_000;
  const first = provider.getAccessToken();
  const second = provider.getAccessToken();
  expect(request).toHaveBeenCalledTimes(2);
  provider.signOut();
  finish(response(session('new-access', 'new-refresh')));
  await expect(first).resolves.toBeNull();
  await expect(second).resolves.toBeNull();
  expect(provider.current).toBeNull();
});

test('rejects redirects, off-origin responses and insecure project URLs', async () => {
  expect(
    () => new SupabaseSessionProvider('http://project.supabase.co', 'key'),
  ).toThrow();
  const request = jest
    .fn()
    .mockResolvedValue(response(session(), 'https://attacker.test/token'));
  const provider = new SupabaseSessionProvider(
    'https://project.supabase.co',
    'key',
    request,
  );
  await expect(
    provider.signIn('player@example.test', 'password'),
  ).rejects.toThrow('Authentication failed');
});
