import { z } from 'zod';
const Environment = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  DATABASE_URL: z.string().url().optional(),
  SUPABASE_URL: z.string().url().optional(),
  GAME_SCHEMA: z.string().default('typeduel_game'),
  GAME_ALLOWED_ORIGINS: z.string().default(''),
  GAME_AUDIO_PROFILE: z.literal('m1-first-pair').optional(),
  GAME_AUDIO_MANIFEST_PATH: z.string().min(1).optional(),
  GAME_AUDIO_ROOT: z.string().min(1).optional(),
  GAME_AUDIO_SIGNING_KEY: z
    .string()
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
    .refine((value) => Buffer.from(value, 'base64').byteLength >= 32)
    .optional(),
  GAME_PUBLIC_ORIGIN: z.string().url().optional(),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});
export function readEnvironment(
  input: Record<string, string | undefined> = process.env,
) {
  const result = Environment.safeParse(input);
  if (!result.success)
    throw new Error(
      'Invalid server configuration. Check HOST, PORT, and LOG_LEVEL.',
    );
  if (!!result.data.DATABASE_URL !== !!result.data.SUPABASE_URL)
    throw new Error(
      'Invalid server configuration. Multiplayer requires DATABASE_URL and SUPABASE_URL together.',
    );
  const audioValues = [
    result.data.GAME_AUDIO_MANIFEST_PATH,
    result.data.GAME_AUDIO_ROOT,
    result.data.GAME_AUDIO_SIGNING_KEY,
    result.data.GAME_PUBLIC_ORIGIN,
  ];
  const audioEnabled = result.data.GAME_AUDIO_PROFILE === 'm1-first-pair';
  if (
    audioValues.some(Boolean) !== audioEnabled ||
    (audioEnabled && audioValues.some((value) => !value)) ||
    (audioEnabled &&
      (!result.data.DATABASE_URL ||
        !result.data.SUPABASE_URL ||
        result.data.NODE_ENV === 'production'))
  )
    throw new Error(
      'Invalid server configuration. The reviewed M1 audio profile must be explicit, complete, multiplayer-enabled, and non-production.',
    );
  return result.data;
}
