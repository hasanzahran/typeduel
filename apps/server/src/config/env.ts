import { z } from 'zod';
const Environment = z.object({
  DATABASE_URL: z.string().url().optional(),
  SUPABASE_URL: z.string().url().optional(),
  GAME_SCHEMA: z.string().default('typeduel_game'),
  GAME_ALLOWED_ORIGINS: z.string().default(''),
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
  return result.data;
}
