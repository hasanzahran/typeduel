import { z } from 'zod';
export * from './setup.js';
export * from './gameplay.js';
export * from './realtime.js';
export * from './audio.js';
export const HealthSchema = z.strictObject({
  status: z.literal('ok'),
  service: z.literal('typeduel-api'),
});
export const ErrorSchema = z.strictObject({
  code: z.string(),
  message: z.string(),
  requestId: z.string(),
});
export type Health = z.infer<typeof HealthSchema>;
