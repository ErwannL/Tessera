import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { decodeCursor, encodeCursor } from '../domain/cursor.js';
import { DomainError } from '../domain/errors.js';
import type { DashboardListQuery, EventView, RequestView } from '../domain/schemas.js';
import { toEventView, toRequestView } from '../domain/views.js';
import { isChainValid, loadEvents } from './events.js';
import { sweepExpired } from './expiry.js';

export const PAGE_SIZE = 25;

export interface SessionUser {
  id: string;
  name: string;
}

export interface DashboardServiceDeps {
  db: Kysely<Database>;
  clock: () => Date;
}

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);

export function createDashboardService({ db, clock }: DashboardServiceDeps) {
  async function me(user: SessionUser) {
    const row = await db
      .selectNoFrom((eb) => [
        eb
          .exists(eb.selectFrom('requests').select('id').where('requester_id', '=', user.id))
          .as('hasRequested'),
        eb
          .exists(eb.selectFrom('requests').select('id').where('approver_id', '=', user.id))
          .as('hasToApprove'),
      ])
      .executeTakeFirstOrThrow();
    return {
      id: user.id,
      name: user.name,
      hasRequested: row.hasRequested,
      hasToApprove: row.hasToApprove,
    };
  }

  async function list(
    user: SessionUser,
    query: DashboardListQuery,
  ): Promise<{ items: RequestView[]; nextCursor: string | null }> {
    const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor);
    if (cursor === null && query.cursor !== undefined) {
      throw new DomainError('VALIDATION_ERROR', {
        details: [{ path: 'cursor', message: 'Invalid cursor' }],
      });
    }
    await sweepExpired(db, clock(), user.id);
    const mine = query.role === 'requester' ? 'requester_id' : 'approver_id';
    const other = query.role === 'requester' ? 'approver' : 'requester';
    // The ownership filter lives in SQL: rows of other users are never loaded.
    let select = db.selectFrom('requests').selectAll().where(mine, '=', user.id);
    if (query.status !== undefined) select = select.where('status', '=', query.status);
    if (query.action !== undefined) select = select.where('action', '=', query.action);
    if (query.from !== undefined) select = select.where('created_at', '>=', new Date(query.from));
    if (query.to !== undefined) select = select.where('created_at', '<=', new Date(query.to));
    const counterpart = query.counterpart;
    if (counterpart !== undefined) {
      select = select.where((eb) =>
        eb.or([
          eb(`${other}_id`, '=', counterpart),
          eb(`${other}_name`, 'ilike', `%${escapeLike(counterpart)}%`),
        ]),
      );
    }
    if (cursor !== null) {
      select = select.where((eb) =>
        eb.or([
          eb('created_at', '<', cursor.createdAt),
          eb.and([eb('created_at', '=', cursor.createdAt), eb('id', '<', cursor.id)]),
        ]),
      );
    }
    const rows = await select
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(PAGE_SIZE + 1)
      .execute();
    const page = rows.slice(0, PAGE_SIZE);
    const last = rows.length > PAGE_SIZE ? page[PAGE_SIZE - 1] : undefined;
    const nextCursor =
      last === undefined ? null : encodeCursor({ createdAt: last.created_at, id: last.id });
    return { items: page.map(toRequestView), nextCursor };
  }

  async function detail(
    user: SessionUser,
    id: string,
  ): Promise<{ request: RequestView; events: EventView[]; chainValid: boolean }> {
    await sweepExpired(db, clock(), user.id);
    const row = await db
      .selectFrom('requests')
      .selectAll()
      .where('id', '=', id)
      .where((eb) => eb.or([eb('requester_id', '=', user.id), eb('approver_id', '=', user.id)]))
      .executeTakeFirst();
    // 404 rather than 403: never reveal that someone else's request exists.
    if (row === undefined) throw new DomainError('NOT_FOUND');
    const events = await loadEvents(db, id);
    return {
      request: toRequestView(row),
      events: events.map(toEventView),
      chainValid: isChainValid(events),
    };
  }

  return { me, list, detail };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
