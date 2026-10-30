import { Pool, type PoolConfig } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { StoreError } from './types.js';

export function validateSchemaName(value = 'typeduel_game'): string {
  if (
    !/^[a-z][a-z0-9_]{0,62}$/.test(value) ||
    value.startsWith('pg_') ||
    ['public', 'information_schema'].includes(value)
  )
    throw new StoreError('INVALID_STATE');
  return value;
}
export function connectionConfig(options: {
  connectionString: string;
  schemaName?: string;
}): PoolConfig {
  const schemaName = validateSchemaName(options.schemaName);
  return {
    connectionString: options.connectionString,
    options: `-c search_path=${schemaName},pg_catalog`,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    idle_in_transaction_session_timeout: 10_000,
    max: 8,
  };
}
export function createDatabase(options: {
  connectionString: string;
  schemaName?: string;
}) {
  const schemaName = validateSchemaName(options.schemaName);
  const pool = new Pool(connectionConfig({ ...options, schemaName }));
  // Pool background errors must not crash or log connection/statement details.
  pool.on('error', () => {});
  return { pool, db: drizzle(pool), schemaName, close: () => pool.end() };
}
export type Database = ReturnType<typeof createDatabase>;
