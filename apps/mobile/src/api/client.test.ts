import { apiBaseUrl } from './client';
test('validates public API URLs without accepting credentials', () => {
  expect(apiBaseUrl('http://10.0.2.2:3000/')).toBe('http://10.0.2.2:3000');
  for (const value of [
    'broken',
    'file:///tmp',
    'https://user:secret@example.com',
    'https://example.com?token=secret',
  ])
    expect(() => apiBaseUrl(value)).toThrow();
});
