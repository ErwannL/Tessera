import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema.js';

const DAY_MS = 86_400_000;

export interface PurgeResult {
  requests: number;
  handoffs: number;
}

/** Deletes finished requests (with their events) older than the retention, and used handoffs. */
export async function purgeExpiredData(
  db: Kysely<Database>,
  now: Date,
  retentionDays: number,
): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const requests = await db
    .deleteFrom('requests')
    .where('status', '<>', 'PENDING')
    .where(sql<Date>`coalesce(approved_at, cancelled_at, expired_at, locked_at)`, '<', cutoff)
    .executeTakeFirst();
  const handoffs = await db
    .deleteFrom('dashboard_handoffs')
    .where('expires_at', '<', now)
    .executeTakeFirst();
  return {
    requests: Number(requests.numDeletedRows),
    handoffs: Number(handoffs.numDeletedRows),
  };
}
