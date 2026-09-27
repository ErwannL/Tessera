import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CODE_ALPHABET } from '../../src/domain/code.js';
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
  context = await createTestApp();
});
afterAll(async () => context.close());

describe('POST /api/v1/requests', () => {
  it('creates a pending request, returns the code once and records CREATED', async () => {
    const response = await api(context).create();
    expect(response.statusCode).toBe(201);
    const created = response.json<Record<string, unknown>>();
    expect(created).toMatchObject({
      status: 'PENDING',
      createdAt: '2026-09-27T14:32:01.000Z',
      expiresAt: '2026-09-27T14:42:01.000Z',
      idempotentReplay: false,
    });
    const code = created.code as string;
    expect(code).toHaveLength(6);
    expect(code).toMatch(new RegExp(`^[${CODE_ALPHABET}]+$`));
    expect(created.codeFormatted).toBe(`${code.slice(0, 3)}-${code.slice(3)}`);
    expect(created.shortId).toMatch(/^\d{4}-[A-Z]{4}$/);

    const id = created.id as string;
    const stored = await context.database.db
      .selectFrom('requests')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(stored.code_hmac).toHaveLength(32);
    expect(stored.code_hmac.toString('latin1')).not.toContain(code);
    expect(JSON.stringify(stored)).not.toContain(code);

    const read = await api(context).get(id);
    expect(read.statusCode).toBe(200);
    expect(read.body).not.toContain(code);
    expect(read.json()).toMatchObject({
      id,
      status: 'PENDING',
      requester: alice,
      approver: bruno,
      action: 'CHANGE_PROJECT_PRIORITY',
      context: { projectId: 'A', oldPriority: 3, newPriority: 1 },
      authorizationDurationSeconds: 3600,
      attempts: 0,
      maxAttempts: 5,
      attemptsRemaining: 5,
      approvedAt: null,
    });
    const events = await api(context).events(id);
    expect(events.json()).toMatchObject({ events: [{ type: 'CREATED' }], chainValid: true });
    expect(events.body).not.toContain(code);
  });

  it('applies configured defaults when optional fields are omitted', async () => {
    const {
      context: _c,
      expiresInSeconds: _e,
      authorizationDurationSeconds: _a,
      maxAttempts: _m,
      ...minimal
    } = requestBody();
    const created = await createRequest(context, minimal);
    const read = (await api(context).get(created.id)).json<Record<string, unknown>>();
    expect(read).toMatchObject({
      context: {},
      authorizationDurationSeconds: null,
      maxAttempts: 5,
      expiresAt: '2026-09-27T14:42:01.000Z',
    });
  });

  it('refuses self approval', async () => {
    const response = await api(context).create(requestBody({ approver: { ...alice, name: 'Me' } }));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: 'SELF_APPROVAL_FORBIDDEN' });
  });

  it('retries when a short id collides, and gives up after five collisions', async () => {
    const ids = ['1111-AAAA', '1111-AAAA', '2222-BBBB'];
    const retrying = await createTestApp({
      database: context.database,
      generators: { shortId: () => ids.shift() ?? '9999-ZZZZ' },
    });
    expect((await createRequest(retrying)).shortId).toBe('1111-AAAA');
    expect((await createRequest(retrying)).shortId).toBe('2222-BBBB');
    const stuck = await createTestApp({
      database: context.database,
      generators: { shortId: () => '1111-AAAA' },
    });
    const response = await api(stuck).create();
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: 'INTERNAL_ERROR',
      requestId: response.headers['x-request-id'],
    });
    await retrying.close();
    await stuck.close();
  });
});

describe('Idempotency-Key', () => {
  it('replays the same request without the code for the same body', async () => {
    const headers = { 'idempotency-key': 'order-1' };
    const first = await api(context).create(requestBody(), headers);
    expect(first.statusCode).toBe(201);
    const second = await api(context).create(requestBody(), headers);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      id: first.json<{ id: string }>().id,
      code: null,
      codeFormatted: null,
      idempotentReplay: true,
    });
  });

  it('rejects the same key with a different body', async () => {
    const headers = { 'idempotency-key': 'order-2' };
    await api(context).create(requestBody(), headers);
    const conflict = await api(context).create(requestBody({ displayText: 'other' }), headers);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ error: 'IDEMPOTENCY_CONFLICT' });
  });

  it('returns the code to exactly one of several concurrent calls', async () => {
    const headers = { 'idempotency-key': 'order-3' };
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => api(context).create(requestBody(), headers)),
    );
    const bodies = responses.map((response) =>
      response.json<{ id: string; code: string | null }>(),
    );
    expect(bodies.filter((body) => body.code !== null)).toHaveLength(1);
    expect(new Set(bodies.map((body) => body.id)).size).toBe(1);
  });

  it('reports a conflict when a concurrent call with another body won', async () => {
    const headers = { 'idempotency-key': 'order-4' };
    const responses = await Promise.all([
      api(context).create(requestBody(), headers),
      api(context).create(requestBody({ displayText: 'different' }), headers),
      api(context).create(requestBody(), headers),
      api(context).create(requestBody({ displayText: 'different' }), headers),
    ]);
    const statuses = responses.map((response) => response.statusCode).sort();
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses).toContain(409);
  });

  it('validates the header length', async () => {
    const response = await api(context).create(requestBody(), {
      'idempotency-key': 'x'.repeat(129),
    });
    expect(response.statusCode).toBe(400);
  });
});
