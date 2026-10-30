import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client.js';
import { StoreError } from './types.js';

export async function migrateDatabase(options: {
  connectionString: string;
  schemaName?: string;
  migrationsFolder?: string;
}): Promise<void> {
  const database = createDatabase(options);
  try {
    // schemaName is restricted to a plain identifier by createDatabase.
    await database.pool.query(
      `CREATE SCHEMA IF NOT EXISTS "${database.schemaName}"`,
    );
    await database.pool.query(
      `REVOKE ALL ON SCHEMA "${database.schemaName}" FROM PUBLIC`,
    );
    await migrate(database.db, {
      migrationsFolder:
        options.migrationsFolder ??
        fileURLToPath(new URL('../../drizzle/', import.meta.url)),
      migrationsSchema: database.schemaName,
    });
    await database.pool.query(
      `REVOKE ALL ON ALL TABLES IN SCHEMA "${database.schemaName}" FROM PUBLIC`,
    );
  } catch {
    throw new StoreError('UNAVAILABLE');
  } finally {
    await database.close();
  }
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new StoreError('UNAVAILABLE');
  await migrateDatabase({ connectionString });
}
