import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  alice,
  api,
  bruno,
  createRequest,
  createTestApp,
  requestBody,
  type TestContext,
} from '../helpers/app.js';

let context: TestContext;

beforeAll(async () => {
  context = await createTestApp({
    env: { RATE_LIMIT_VERIFY_REQUEST_MAX: '1000', RATE_LIMIT_VERIFY_IP_MAX: '1000' },
  });
});
afterAll(async () => context.close());

const wrong = (code: string): string => (code.startsWith('A') ? 'B' : 'A') + code.slice(1);

async function eventTypes(id: string): Promise<string[]> {
  const response = await api(context).events(id);
  return response.json<{ events: { type: string }[] }>().events.map((event) => event.type);
}

describe('POST /api/v1/requests/:id/verify', () => {
  it('approves with the right code and returns what was approved', async () => {
    const created = await createRequest(context);
    context.clock.advance(77);
    const response = await api(context).verify(created.id, created.codeFormatted.toLowerCase());
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: created.id,
      status: 'APPROVED',
      approvedAt: '2026-09-27T14:33:18.000Z',
      requester: alice,
      approver: bruno,
      action: 'CHANGE_PROJECT_PRIORITY',
      context: { projectId: 'A', oldPriority: 3, newPriority: 1 },
      authorizationDurationSeconds: 3600,
    });
    expect(await eventTypes(created.id)).toEqual(['CREATED', 'APPROVED']);
    context.clock.advance(-77);
  });

  it('counts wrong codes and reports the remaining attempts', async () => {
    const created = await createRequest(context);
    const first = await api(context).verify(created.id, wrong(created.code));
    expect(first.statusCode).toBe(422);
    expect(first.json()).toEqual({ error: 'INVALID_CODE', attemptsRemaining: 4 });
    const second = await api(context).verify(created.id, 'nonsense');
    expect(second.json()).toEqual({ error: 'INVALID_CODE', attemptsRemaining: 3 });
    expect((await api(context).get(created.id)).json()).toMatchObject({
      attempts: 2,
      attemptsRemaining: 3,
    });
  });

  it('locks after the maximum number of attempts, even for the right code', async () => {
    const created = await createRequest(context, requestBody({ maxAttempts: 2 }));
    expect((await api(context).verify(created.id, wrong(created.code))).statusCode).toBe(422);
    const locking = await api(context).verify(created.id, wrong(created.code));
    expect(locking.statusCode).toBe(423);
    expect(locking.json()).toEqual({ error: 'LOCKED' });
    const afterLock = await api(context).verify(created.id, created.code);
    expect(afterLock.statusCode).toBe(423);
    expect((await api(context).get(created.id)).json()).toMatchObject({
      status: 'LOCKED',
      lockedAt: '2026-09-27T14:32:01.000Z',
    });
    expect(await eventTypes(created.id)).toEqual([
      'CREATED',
      'VERIFY_FAILED',
      'LOCKED',
      'VERIFY_REJECTED',
    ]);
  });

  it('refuses a code already used', async () => {
    const created = await createRequest(context);
    expect((await api(context).verify(created.id, created.code)).statusCode).toBe(200);
    const again = await api(context).verify(created.id, created.code);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'ALREADY_APPROVED' });
  });

  it('refuses an expired code while the row is still PENDING in the database', async () => {
    const created = await createRequest(context, requestBody({ expiresInSeconds: 60 }));
    context.clock.advance(60);
    const stored = await context.database.db
      .selectFrom('requests')
      .select('status')
      .where('id', '=', created.id)
      .executeTakeFirstOrThrow();
    expect(stored.status).toBe('PENDING');
    const response = await api(context).verify(created.id, created.code);
    expect(response.statusCode).toBe(410);
    expect(response.json()).toEqual({ error: 'EXPIRED' });
    const again = await api(context).verify(created.id, created.code);
    expect(again.statusCode).toBe(410);
    expect(await eventTypes(created.id)).toEqual([
      'CREATED',
      'EXPIRED',
      'VERIFY_REJECTED',
      'VERIFY_REJECTED',
    ]);
    context.clock.advance(-60);
  });

  it('refuses verification of a cancelled request', async () => {
    const created = await createRequest(context);
    await api(context).cancel(created.id);
    const response = await api(context).verify(created.id, created.code);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'CANCELLED' });
  });

  it('answers NOT_FOUND for unknown or malformed ids', async () => {
    for (const id of [crypto.randomUUID(), 'not-a-uuid']) {
      const response = await api(context).verify(id, 'AAAAAA');
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'NOT_FOUND' });
      expect((await api(context).get(id)).statusCode).toBe(404);
      expect((await api(context).events(id)).statusCode).toBe(404);
      expect((await api(context).cancel(id)).statusCode).toBe(404);
    }
  });
});

describe('crossed and concurrent requests', () => {
  it('validates each request only with its own code', async () => {
    const a = await createRequest(context);
    const b = await createRequest(context);
    const c = await createRequest(context, requestBody({ requester: bruno, approver: alice }));
    const all = [a, b, c];
    for (const target of all) {
      for (const other of all.filter((request) => request !== target)) {
        if (other.code !== target.code) {
          expect((await api(context).verify(target.id, other.code)).statusCode).toBe(422);
        }
      }
    }
    for (const target of all) {
      expect((await api(context).verify(target.id, target.code)).statusCode).toBe(200);
    }
  });

  it('keeps roles relative to each request', async () => {
    const forward = await createRequest(context);
    const reverse = await createRequest(
      context,
      requestBody({ requester: bruno, approver: alice }),
    );
    const approved = await api(context).verify(reverse.id, reverse.code);
    expect(approved.json()).toMatchObject({ requester: bruno, approver: alice });
    expect((await api(context).get(forward.id)).json()).toMatchObject({
      requester: alice,
      status: 'PENDING',
    });
  });

  it('keeps two requests with the same code independent', async () => {
    const shared = await createTestApp({
      database: context.database,
      generators: { code: () => 'K7M4QX' },
    });
    const first = await createRequest(shared);
    const second = await createRequest(shared);
    expect(first.code).toBe(second.code);
    const hmacs = await context.database.db
      .selectFrom('requests')
      .select('code_hmac')
      .where('id', 'in', [first.id, second.id])
      .execute();
    expect(hmacs[0]!.code_hmac.equals(hmacs[1]!.code_hmac)).toBe(false);
    expect((await api(shared).verify(first.id, 'K7M-4QX')).statusCode).toBe(200);
    expect((await api(shared).get(second.id)).json()).toMatchObject({
      status: 'PENDING',
      attempts: 0,
    });
    expect((await api(shared).verify(second.id, 'K7M4QX')).statusCode).toBe(200);
    await shared.close();
  });

  it('gives exactly one success for 20 simultaneous right codes', async () => {
    const created = await createRequest(context);
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => api(context).verify(created.id, created.code)),
    );
    const statuses = responses.map((response) => response.statusCode);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(
      responses.filter(
        (response) => response.json<{ error?: string }>().error === 'ALREADY_APPROVED',
      ),
    ).toHaveLength(19);
  });

  it('never exceeds max_attempts with 20 simultaneous wrong codes', async () => {
    const created = await createRequest(context);
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => api(context).verify(created.id, wrong(created.code))),
    );
    const errors = responses.map((response) => response.json<{ error: string }>().error);
    expect(errors.filter((error) => error === 'INVALID_CODE')).toHaveLength(4);
    expect(errors.filter((error) => error === 'LOCKED')).toHaveLength(16);
    const stored = await context.database.db
      .selectFrom('requests')
      .select(['attempts', 'status'])
      .where('id', '=', created.id)
      .executeTakeFirstOrThrow();
    expect(stored).toEqual({ attempts: 5, status: 'LOCKED' });
  });
});
