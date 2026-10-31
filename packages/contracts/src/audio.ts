import { z } from 'zod';
import { RequestSchema, SessionScopeSchema, replySchema } from './realtime.js';

// Shared resource limits, not catalog metadata or answer lookup keys.
export const MAX_AUDIO_BYTES = 1_048_576;
export const MAX_AUDIO_DURATION_MS = 10_000;
export const AUDIO_GRANT_TTL_MS = 60_000;
const Id = z.uuid();
export const AudioAccessRequestSchema = RequestSchema.extend({
  roundId: Id,
  assetId: Id,
  audioVersion: Id,
});
export const AudioAccessDataSchema = SessionScopeSchema.extend({
  requestId: Id,
  matchId: Id,
  roundId: Id,
  assetId: Id,
  audioVersion: Id,
  url: z.url().refine((raw) => {
    const url = new URL(raw);
    return (
      ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  }, 'Invalid audio access URL'),
  expiresAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  byteLength: z.number().int().positive().max(MAX_AUDIO_BYTES),
});
export const AudioAccessReplySchema = replySchema(AudioAccessDataSchema);
export type AudioAccessRequest = z.infer<typeof AudioAccessRequestSchema>;
export type AudioAccessData = z.infer<typeof AudioAccessDataSchema>;
