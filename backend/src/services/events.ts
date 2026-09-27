import type { Kysely, Transaction } from 'kysely';
import type { Database, EventRow, EventType, JsonObject } from '../db/schema.js';
import { computeEventHash, verifyChain } from '../domain/hashChain.js';

export interface NewEvent {
  requestId: string;
  type: EventType;
  at: Date;
  meta: JsonObject;
}

/**
 * Appends an event to the per-request hash chain. The caller must hold the request row lock
 * (SELECT … FOR UPDATE, or the row was inserted in the same transaction) so links never fork.
 */
export async function appendEvent(trx: Transaction<Database>, event: NewEvent): Promise<void> {
  const last = await trx
    .selectFrom('request_events')
    .select('hash')
    .where('request_id', '=', event.requestId)
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  const prevHash = last?.hash ?? null;
  const hash = computeEventHash({ ...event, prevHash });
  await trx
    .insertInto('request_events')
    .values({
      request_id: event.requestId,
      type: event.type,
      at: event.at,
      meta: JSON.stringify(event.meta),
      prev_hash: prevHash,
      hash,
    })
    .execute();
}

export async function loadEvents(db: Kysely<Database>, requestId: string): Promise<EventRow[]> {
  return db
    .selectFrom('request_events')
    .selectAll()
    .where('request_id', '=', requestId)
    .orderBy('id', 'asc')
    .execute();
}

export function isChainValid(events: readonly EventRow[]): boolean {
  return verifyChain(
    events.map((event) => ({
      requestId: event.request_id,
      type: event.type,
      at: event.at,
      meta: event.meta,
      prevHash: event.prev_hash,
      hash: event.hash,
    })),
  );
}

/** Loads the history of a request and checks the integrity of its hash chain. */
export async function verifyEventChain(db: Kysely<Database>, requestId: string): Promise<boolean> {
  return isChainValid(await loadEvents(db, requestId));
}
