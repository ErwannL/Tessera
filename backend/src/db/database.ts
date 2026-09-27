import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.js';

/**
 * An idle pooled client can be terminated by the server (restart, failover). pg reports it
 * on the pool; without a listener Node would crash. The next query simply reconnects and
 * surfaces any persistent failure (e.g. /health answers 503).
 */
export function onIdleClientError(): void {
  return undefined;
}

export function createDb(connectionString: string, max = 10): Kysely<Database> {
  const pool = new pg.Pool({ connectionString, max, connectionTimeoutMillis: 5000 });
  pool.on('error', onIdleClientError);
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
