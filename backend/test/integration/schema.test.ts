import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NewRequestRow } from '../../src/db/schema.js';
import { appendEvent, loadEvents, verifyEventChain } from '../../src/services/events.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';

let database: TestDatabase;
const at = new Date('2026-09-27T14:32:01.000Z');

function row(overrides: Partial<NewRequestRow> = {}): NewRequestRow {
  return {
    id: randomUUID(),
    short_id: randomUUID().slice(0, 9),
    requester_id: '42',
    requester_name: 'Alice',
    approver_id: '7',
    approver_name: 'Bruno',
    action: 'DO_IT',
    display_text: 'text',
    context: '{}',
    authorization_duration_seconds: null,
    status: 'PENDING',
    code_hmac: Buffer.alloc(32),
    max_attempts: 5,
    idempotency_key: null,
    request_fingerprint: Buffer.alloc(32),
    created_at: at,
    expires_at: new Date(at.getTime() + 60_000),
    ...overrides,
  };
}

async function insertWithEvents(): Promise<string> {
  const values = row();
  await database.db.transaction().execute(async (trx) => {
    await trx.insertInto('requests').values(values).execute();
    await appendEvent(trx, { requestId: values.id, type: 'CREATED', at, meta: { ip: '::1' } });
    await appendEvent(trx, {
      requestId: values.id,
      type: 'VERIFY_FAILED',
      at: new Date(at.getTime() + 1000),
      meta: { attemptsRemaining: 4, ip: '::1' },
    });
    await appendEvent(trx, { requestId: values.id, type: 'APPROVED', at, meta: { ip: '::1' } });
  });
  return values.id;
}

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(async () => database.drop());

describe('database constraints', () => {
  it.each([
    ['self approval', { approver_id: '42' }],
    ['unknown status', { status: 'DONE' as 'PENDING' }],
    ['expiry before creation', { expires_at: at }],
    ['invalid action', { action: 'lower case' }],
    ['non-object context', { context: '[1]' }],
  ])('rejects %s', async (_label, overrides) => {
    await expect(
      database.db.insertInto('requests').values(row(overrides)).execute(),
    ).rejects.toThrow(/violates check constraint/);
  });
});

describe('request_events hash chain', () => {
  it('links events in order and validates the chain', async () => {
    const id = await insertWithEvents();
    const events = await loadEvents(database.db, id);
    expect(events.map((event) => event.type)).toEqual(['CREATED', 'VERIFY_FAILED', 'APPROVED']);
    expect(events[0]!.prev_hash).toBeNull();
    expect(events[1]!.prev_hash!.equals(events[0]!.hash)).toBe(true);
    expect(await verifyEventChain(database.db, id)).toBe(true);
  });

  it('refuses UPDATE and direct DELETE through the trigger', async () => {
    const id = await insertWithEvents();
    await expect(
      sql`UPDATE request_events SET meta = '{"forged":true}' WHERE request_id = ${id}`.execute(
        database.db,
      ),
    ).rejects.toThrow('request_events is append-only');
    await expect(
      sql`DELETE FROM request_events WHERE request_id = ${id}`.execute(database.db),
    ).rejects.toThrow('only deleted with their request');
  });

  it('cascades deletion when the request itself is purged', async () => {
    const id = await insertWithEvents();
    await database.db.deleteFrom('requests').where('id', '=', id).execute();
    expect(await loadEvents(database.db, id)).toHaveLength(0);
  });

  it('detects tampering done by bypassing the trigger', async () => {
    const id = await insertWithEvents();
    await sql`ALTER TABLE request_events DISABLE TRIGGER request_events_append_only`.execute(
      database.db,
    );
    await sql`
      UPDATE request_events SET meta = '{"attemptsRemaining":5,"ip":"::1"}'
      WHERE request_id = ${id} AND type = 'VERIFY_FAILED'
    `.execute(database.db);
    await sql`ALTER TABLE request_events ENABLE TRIGGER request_events_append_only`.execute(
      database.db,
    );
    expect(await verifyEventChain(database.db, id)).toBe(false);
  });
});
