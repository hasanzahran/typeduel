import { AuthenticationRequired, requireAccessToken } from './token-provider';

test('fetches the current provider token each time without caching it', async () => {
  const provider = {
    getAccessToken: jest
      .fn()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('refreshed'),
  };
  expect(await requireAccessToken(provider)).toBe('first');
  expect(await requireAccessToken(provider)).toBe('refreshed');
});
test.each([null, '', 'x'.repeat(8193)])(
  'requires an available bounded token',
  async (token) => {
    await expect(
      requireAccessToken({ getAccessToken: async () => token }),
    ).rejects.toBeInstanceOf(AuthenticationRequired);
  },
);
test('does not surface provider errors or their secrets', async () => {
  await expect(
    requireAccessToken({
      getAccessToken: async () => {
        throw new Error('secret token');
      },
    }),
  ).rejects.toThrow('Authentication required');
});
