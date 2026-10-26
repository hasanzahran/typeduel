import { HealthSchema } from '@typeduel/contracts';
import { z } from 'zod';
export function apiBaseUrl(value = process.env.EXPO_PUBLIC_API_URL) {
  const parsed = z.url().parse(value ?? 'http://127.0.0.1:3000');
  const url = new URL(parsed);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      'API URL must be an HTTP(S) URL without credentials, query, or fragment',
    );
  return parsed.replace(/\/$/, '');
}
export async function fetchHealth() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${apiBaseUrl()}/health/live`, {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('API unavailable');
    return HealthSchema.parse(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}
