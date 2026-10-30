import type { TransportErrorCode } from '@typeduel/contracts';
export class TransportFailure extends Error {
  constructor(readonly code: TransportErrorCode) {
    super('Request could not be completed');
  }
}
/** Bounded token buckets. Unknown keys cannot displace an existing allowance. */
export function createLimits(now: () => number, capacity = 10000) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return {
    allow(key: string, rate = 10, burst = 20): boolean {
      const at = now();
      if (buckets.size >= capacity && !buckets.has(key)) {
        for (const [id, b] of buckets)
          if (at - b.at > 60000) buckets.delete(id);
        if (buckets.size >= capacity) return false;
      }
      const bucket = buckets.get(key) ?? { tokens: burst, at };
      bucket.tokens = Math.min(
        burst,
        bucket.tokens + (Math.max(0, at - bucket.at) * rate) / 1000,
      );
      bucket.at = at;
      buckets.set(key, bucket);
      if (bucket.tokens < 1) return false;
      bucket.tokens -= 1;
      return true;
    },
  };
}
