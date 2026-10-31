import { randomUUID } from 'node:crypto';
import { buildApp } from './app.js';
import { readEnvironment } from './config/env.js';
import { createDatabase } from './db/client.js';
import { acquireOwner } from './db/owner.js';
import { createSupabaseVerifier } from './auth/verifier.js';
import { unavailableSource } from './game/source.js';
import { createGameRuntime } from './runtime.js';
import { loadReviewedCatalog } from './words/catalog.js';
import { createReviewedSource } from './words/source.js';
const env = readEnvironment();
let closing = false;
let cleanup: () => Promise<void> = async () => {};
async function shutdown() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  try {
    await cleanup();
    clearTimeout(deadline);
  } catch {
    process.exitCode = 1;
  }
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
try {
  if (env.DATABASE_URL && env.SUPABASE_URL) {
    let source = unavailableSource;
    let audio;
    if (env.GAME_AUDIO_PROFILE === 'm1-first-pair') {
      const catalog = await loadReviewedCatalog({
        manifestPath: env.GAME_AUDIO_MANIFEST_PATH!,
        assetRoot: env.GAME_AUDIO_ROOT!,
      });
      source = createReviewedSource({
        catalog,
        publicOrigin: env.GAME_PUBLIC_ORIGIN!,
      });
      audio = {
        reader: catalog.reader,
        publicOrigin: env.GAME_PUBLIC_ORIGIN!,
        signingKey: Uint8Array.from(
          Buffer.from(env.GAME_AUDIO_SIGNING_KEY!, 'base64'),
        ),
      };
    }
    const database = createDatabase({
      connectionString: env.DATABASE_URL,
      schemaName: env.GAME_SCHEMA,
    });
    cleanup = () => database.close();
    const owner = await acquireOwner({
      connectionString: env.DATABASE_URL,
      schemaName: env.GAME_SCHEMA,
      ownerId: randomUUID(),
    });
    cleanup = async () => {
      await owner.release();
      await database.close();
    };
    const runtime = await createGameRuntime({
      database,
      owner,
      verifier: createSupabaseVerifier({ supabaseUrl: env.SUPABASE_URL }),
      source,
      ...(audio ? { audio } : {}),
      config: {
        allowedOrigins: env.GAME_ALLOWED_ORIGINS.split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      },
    });
    cleanup = async () => {
      await runtime.close();
      await owner.release();
      await database.close();
    };
    await runtime.listen({ host: env.HOST, port: env.PORT });
  } else {
    const app = buildApp(env.LOG_LEVEL);
    cleanup = () => app.close();
    await app.listen({ host: env.HOST, port: env.PORT });
  }
} catch {
  process.exitCode = 1;
  await cleanup();
}
