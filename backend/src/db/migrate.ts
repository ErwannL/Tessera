import type { Kysely } from 'kysely';
import { Migrator, type Migration } from 'kysely/migration';
import type { Database } from './schema.js';
import * as init from './migrations/0001_init.js';

/** Migrations are bundled statically so the compiled image needs no filesystem lookup. */
export const migrations: Record<string, Migration> = { '0001_init': init };

export async function migrateToLatest(
  db: Kysely<Database>,
  set: Record<string, Migration>,
): Promise<void> {
  const migrator = new Migrator({ db, provider: { getMigrations: () => Promise.resolve(set) } });
  const { error } = await migrator.migrateToLatest();
  if (error !== undefined) {
    throw new Error(`Database migration failed: ${(error as Error).message}`, { cause: error });
  }
}
