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
import { login } from '../helpers/handoff.js';

let context: TestContext;
let aliceCookie: string;
let brunoCookie: string;
const carol = { id: 'c-3', name: 'Carol 100%_Test' };

interface Page {
  items: { id: string; status: string; action: string; requester: { id: string } }[];
  nextCursor: string | null;
}

async function list(cookie: string, query: string) {
  return context.app.inject({
    method: 'GET',
    url: `/api/v1/dashboard/requests?${query}`,
    headers: { cookie },
  });
}

beforeAll(async () => {
  context = await createTestApp({ env: { RATE_LIMIT_HANDOFF_IP_MAX: '1000' } });
  aliceCookie = await login(context, alice.id, alice.name);
  brunoCookie = await login(context, bruno.id, bruno.name);
  // 30 requests Alice -> Bruno, one second apart, then a few others.
  for (let index = 0; index < 30; index += 1) {
    await createRequest(context, requestBody({ action: index % 2 === 0 ? 'EVEN' : 'ODD' }));
    context.clock.advance(1);
  }
  await createRequest(
    context,
    requestBody({ requester: bruno, approver: alice, action: 'REVERSE' }),
  );
  await createRequest(context, requestBody({ requester: carol, approver: bruno, action: 'CAROL' }));
});
afterAll(async () => context.close());

describe('GET /api/v1/dashboard/me', () => {
  it('reports which tabs have content', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/me',
      headers: { cookie: aliceCookie },
    });
    expect(response.json()).toEqual({
      id: '42',
      name: 'Alice Martin',
      hasRequested: true,
      hasToApprove: true,
    });
    const carolCookie = await login(context, carol.id, carol.name);
    const carolMe = await context.app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/me',
      headers: { cookie: carolCookie },
    });
    expect(carolMe.json()).toMatchObject({ hasRequested: true, hasToApprove: false });
  });
});

describe('GET /api/v1/dashboard/requests', () => {
  it('lists only my requests for the role, newest first, 25 per page', async () => {
    const first = (await list(aliceCookie, 'role=requester')).json<Page>();
    expect(first.items).toHaveLength(25);
    expect(first.items.every((item) => item.requester.id === alice.id)).toBe(true);
    expect(first.nextCursor).not.toBeNull();
    const second = (
      await list(aliceCookie, `role=requester&cursor=${first.nextCursor ?? ''}`)
    ).json<Page>();
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const ids = new Set([...first.items, ...second.items].map((item) => item.id));
    expect(ids.size).toBe(30);
    const approver = (await list(aliceCookie, 'role=approver')).json<Page>();
    expect(approver.items.map((item) => item.action)).toEqual(['REVERSE']);
  });

  it('filters by status, action, period and counterpart', async () => {
    const created = await createRequest(context, requestBody({ action: 'FILTER_ME' }));
    await api(context).verify(created.id, created.code);
    const approved = (await list(aliceCookie, 'role=requester&status=APPROVED')).json<Page>();
    expect(approved.items.map((item) => item.id)).toEqual([created.id]);
    const byAction = (await list(aliceCookie, 'role=requester&action=ODD')).json<Page>();
    expect(byAction.items).toHaveLength(15);
    const period = (
      await list(
        aliceCookie,
        'role=requester&from=2026-09-27T14:32:05.000Z&to=2026-09-27T14:32:09.000Z',
      )
    ).json<Page>();
    expect(period.items).toHaveLength(5);
    const byName = (
      await list(brunoCookie, `role=approver&counterpart=${encodeURIComponent('carol 100%_')}`)
    ).json<Page>();
    expect(byName.items.map((item) => item.action)).toEqual(['CAROL']);
    const byId = (await list(brunoCookie, `role=approver&counterpart=${carol.id}`)).json<Page>();
    expect(byId.items).toHaveLength(1);
    const wildcard = (await list(brunoCookie, 'role=approver&counterpart=%25')).json<Page>();
    expect(wildcard.items.map((item) => item.action)).toEqual(['CAROL']);
  });

  it('expires overdue requests before listing them', async () => {
    const created = await createRequest(
      context,
      requestBody({ action: 'SOON', expiresInSeconds: 60 }),
    );
    context.clock.advance(61);
    const page = (await list(aliceCookie, 'role=requester&action=SOON')).json<Page>();
    expect(page.items).toEqual([expect.objectContaining({ id: created.id, status: 'EXPIRED' })]);
  });

  it('validates the query', async () => {
    for (const query of [
      '',
      'role=admin',
      'role=requester&status=DONE',
      'role=requester&cursor=bad',
      'role=requester&x=1',
    ]) {
      const response = await list(aliceCookie, query);
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: string }>().error).toBe('VALIDATION_ERROR');
    }
  });

  it('requires a session', async () => {
    expect((await list('', 'role=requester')).statusCode).toBe(401);
  });
});

describe('GET /api/v1/dashboard/requests/:id', () => {
  it('returns the detail with its history and integrity flag', async () => {
    const created = await createRequest(context);
    await api(context).verify(created.id, 'WRONG1');
    const response = await context.app.inject({
      method: 'GET',
      url: `/api/v1/dashboard/requests/${created.id}`,
      headers: { cookie: brunoCookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      request: { id: string };
      events: { type: string }[];
      chainValid: boolean;
    }>();
    expect(body.request.id).toBe(created.id);
    expect(body.events.map((event) => event.type)).toEqual(['CREATED', 'VERIFY_FAILED']);
    expect(body.chainValid).toBe(true);
    expect(response.body).not.toContain(created.code);
  });

  it("answers 404 for someone else's request or a malformed id", async () => {
    const created = await createRequest(
      context,
      requestBody({ requester: carol, approver: bruno }),
    );
    for (const id of [created.id, crypto.randomUUID(), 'nope']) {
      const response = await context.app.inject({
        method: 'GET',
        url: `/api/v1/dashboard/requests/${id}`,
        headers: { cookie: aliceCookie },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'NOT_FOUND' });
    }
  });
});
