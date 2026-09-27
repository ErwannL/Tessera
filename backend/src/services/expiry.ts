import type { Kysely, Transaction } from 'kysely';
import type { Database, RequestRow } from '../db/schema.js';
import { appendEvent } from './events.js';

export type ExpirySource = 'read' | 'verify' | 'cancel' | 'sweep';

export function isDue(row: RequestRow, now: Date): boolean {
  return row.status === 'PENDING' && row.expires_at.getTime() <= now.getTime();
}

export async function lockRequest(
  trx: Transaction<Database>,
  id: string,
): Promise<RequestRow | undefined> {
  return trx.selectFrom('requests').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
}

/** Moves a locked, due PENDING request to EXPIRED and records the event. */
export async function expireRow(
  trx: Transaction<Database>,
  row: RequestRow,
  now: Date,
  source: ExpirySource,
): Promise<RequestRow> {
  const updated = await trx
    .updateTable('requests')
    .set({ status: 'EXPIRED', expired_at: row.expires_at })
    .where('id', '=', row.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await appendEvent(trx, { requestId: row.id, type: 'EXPIRED', at: now, meta: { source } });
  return updated;
}

/**
 * Expires every due PENDING request (optionally only those involving one user).
 * Rows locked by a concurrent verify/cancel are skipped; they are handled there or next sweep.
 */
export async function sweepExpired(
  db: Kysely<Database>,
  now: Date,
  userId: string | null,
): Promise<number> {
  return db.transaction().execute(async (trx) => {
    let query = trx
      .selectFrom('requests')
      .selectAll()
      .where('status', '=', 'PENDING')
      .where('expires_at', '<=', now);
    if (userId !== null) {
      query = query.where((eb) =>
        eb.or([eb('requester_id', '=', userId), eb('approver_id', '=', userId)]),
      );
    }
    const due = await query.orderBy('expires_at').limit(500).forUpdate().skipLocked().execute();
    for (const row of due) {
      await expireRow(trx, row, now, 'sweep');
    }
    return due.length;
  });
}
