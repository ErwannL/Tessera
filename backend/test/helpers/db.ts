import { randomBytes } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { createDb } from '../../src/db/database.js';
import { migrateToLatest, migrations } from '../../src/db/migrate.js';
import type { Database } from '../../src/db/schema.js';
import { adminDatabaseUrl } from './env.js';

export interface TestDatabase {
  db: Kysely<Database>;
  url: string;
  drop: () => Promise<void>;
}

/** A fresh, migrated database per test file, dropped afterwards. */
export async function createTestDatabase(migrate = true): Promise<TestDatabase> {
  const admin = createDb(adminDatabaseUrl(), 1);
  const name = `tessera_t_${randomBytes(6).toString('hex')}`;
  await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin);
  const url = new URL(adminDatabaseUrl());
  url.pathname = `/${name}`;
  const db = createDb(url.toString(), 30);
  if (migrate) await migrateToLatest(db, migrations);
  return {
    db,
    url: url.toString(),
    drop: async () => {
      await db.destroy();
      await sql`DROP DATABASE ${sql.id(name)} WITH (FORCE)`.execute(admin);
      await admin.destroy();
    },
  };
}
