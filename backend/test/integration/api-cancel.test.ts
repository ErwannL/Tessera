import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api,
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

describe('POST /api/v1/requests/:id/cancel', () => {
  it('cancels a pending request with a reason, then refuses verification', async () => {
    const created = await createRequest(context);
    const response = await api(context).cancel(created.id, { reason: 'Plus nécessaire' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'Plus nécessaire',
      cancelledAt: '2026-09-27T14:32:01.000Z',
    });
    expect((await api(context).verify(created.id, created.code)).json()).toEqual({
      error: 'CANCELLED',
    });
  });

  it('is idempotent: a second cancel returns 200 without a new event', async () => {
    const created = await createRequest(context);
    expect((await api(context).cancel(created.id)).json()).toMatchObject({ cancelReason: null });
    const again = await api(context).cancel(created.id, { reason: 'twice' });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ status: 'CANCELLED', cancelReason: null });
    const events = (await api(context).events(created.id)).json<{
      events: { type: string; meta: object }[];
    }>();
    expect(events.events.map((event) => event.type)).toEqual(['CREATED', 'CANCELLED']);
    expect(events.events[1]!.meta).toMatchObject({ reason: null, ip: '127.0.0.1' });
  });

  it('refuses to cancel an approved request and reports its state', async () => {
    const created = await createRequest(context);
    await api(context).verify(created.id, created.code);
    const response = await api(context).cancel(created.id);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'NOT_CANCELLABLE', status: 'APPROVED' });
  });

  it('expires a due request instead of cancelling it', async () => {
    const created = await createRequest(context, requestBody({ expiresInSeconds: 60 }));
    context.clock.advance(61);
    const response = await api(context).cancel(created.id);
    expect(response.json()).toEqual({ error: 'NOT_CANCELLABLE', status: 'EXPIRED' });
    context.clock.advance(-61);
  });

  it('validates the optional body', async () => {
    const created = await createRequest(context);
    for (const body of [{ reason: '' }, { reason: 'x'.repeat(501) }, { other: 1 }]) {
      expect((await api(context).cancel(created.id, body)).statusCode).toBe(400);
    }
  });
});

describe('GET /api/v1/requests/:id', () => {
  it('returns an overdue PENDING request as EXPIRED and records it once', async () => {
    const created = await createRequest(context, requestBody({ expiresInSeconds: 60 }));
    context.clock.advance(120);
    const first = await api(context).get(created.id);
    expect(first.json()).toMatchObject({
      status: 'EXPIRED',
      expiredAt: '2026-09-27T14:33:01.000Z',
    });
    await api(context).get(created.id);
    const events = (await api(context).events(created.id)).json<{
      events: { type: string; meta: object }[];
    }>();
    expect(events.events.map((event) => event.type)).toEqual(['CREATED', 'EXPIRED']);
    expect(events.events[1]!.meta).toEqual({ source: 'read' });
    context.clock.advance(-120);
  });
});
