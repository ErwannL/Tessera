import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateToLatest, migrations } from '../../src/db/migrate.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase(false);
});
afterAll(async () => database.drop());

describe('migrations', () => {
  it('apply on an empty database, are idempotent and reversible', async () => {
    await migrateToLatest(database.db, migrations);
    await migrateToLatest(database.db, migrations);
    const tables = await sql<{ tablename: string }>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `.execute(database.db);
    expect(tables.rows.map((row) => row.tablename)).toEqual([
      'dashboard_handoffs',
      'kysely_migration',
      'kysely_migration_lock',
      'request_events',
      'requests',
    ]);
    await migrations['0001_init']!.down!(database.db);
    const after = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM pg_tables WHERE tablename = 'requests'
    `.execute(database.db);
    expect(after.rows[0]!.n).toBe(0);
  });

  it('fail cleanly with a descriptive error', async () => {
    const broken = {
      '9999_broken': { up: async () => Promise.reject(new Error('syntax error near FOO')) },
    };
    const fresh = await createTestDatabase(false);
    await expect(migrateToLatest(fresh.db, broken)).rejects.toThrow(
      'Database migration failed: syntax error near FOO',
    );
    await fresh.drop();
  });
});
