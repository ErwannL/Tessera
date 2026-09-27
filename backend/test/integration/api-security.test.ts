import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  createRequest,
  createTestApp,
  requestBody,
  type TestContext,
} from '../helpers/app.js';
import { randomSecret } from '../helpers/env.js';

let context: TestContext;

beforeAll(async () => {
  context = await createTestApp();
});
afterAll(async () => context.close());

const inject = (options: InjectOptions) => context.app.inject(options);

describe('API key authentication', () => {
  it.each([
    ['no header', {}],
    ['a wrong key', { authorization: `Bearer ${randomSecret()}` }],
    ['a non-bearer scheme', { authorization: 'Basic abc' }],
  ])('rejects %s with 401', async (_label, headers) => {
    const response = await inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers,
      payload: requestBody(),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'UNAUTHORIZED' });
  });

  it('accepts both keys during a rotation', async () => {
    for (const key of context.config.API_KEYS) {
      const response = await inject({
        method: 'POST',
        url: '/api/v1/requests',
        headers: { authorization: `Bearer ${key}` },
        payload: requestBody(),
      });
      expect(response.statusCode).toBe(201);
    }
  });

  it('never accepts the API key on dashboard routes', async () => {
    const response = await inject({
      method: 'GET',
      url: '/api/v1/dashboard/me',
      headers: { authorization: `Bearer ${context.apiKey}` },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('input validation', () => {
  const long = (length: number) => 'x'.repeat(length);
  it.each([
    ['missing requester', { requester: undefined }],
    ['empty requester id', { requester: { id: '', name: 'A' } }],
    ['requester id too long', { requester: { id: long(129), name: 'A' } }],
    [
      'requester name too long',
      { requester: { id: '1', name: long(201) }, approver: { id: '2', name: 'B' } },
    ],
    ['unknown person field', { approver: { id: '7', name: 'B', role: 'admin' } }],
    ['lowercase action', { action: 'change' }],
    ['action too long', { action: 'A'.repeat(65) }],
    ['empty display text', { displayText: '' }],
    ['display text too long', { displayText: long(501) }],
    ['context not an object', { context: [1, 2] }],
    ['context too large', { context: { blob: long(8200) } }],
    ['expiry too short', { expiresInSeconds: 59 }],
    ['expiry too long', { expiresInSeconds: 86_401 }],
    ['non-integer expiry', { expiresInSeconds: 60.5 }],
    ['negative authorization duration', { authorizationDurationSeconds: -1 }],
    ['zero attempts', { maxAttempts: 0 }],
    ['too many attempts', { maxAttempts: 11 }],
    ['wrong type', { displayText: 12 }],
    ['unknown field', { extra: true }],
  ])('rejects %s', async (_label, overrides) => {
    const response = await api(context).create(requestBody(overrides));
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: string; details: { path: string; message: string }[] }>();
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(body.details.length).toBeGreaterThan(0);
  });

  it('accepts a null authorization duration', async () => {
    expect(
      (await api(context).create(requestBody({ authorizationDurationSeconds: null }))).statusCode,
    ).toBe(201);
  });

  it('rejects malformed verify bodies', async () => {
    const created = await createRequest(context);
    for (const payload of [{}, { code: '' }, { code: 'A'.repeat(65) }, { code: 'AAAAAA', x: 1 }]) {
      const response = await inject({
        method: 'POST',
        url: `/api/v1/requests/${created.id}/verify`,
        headers: { authorization: `Bearer ${context.apiKey}` },
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it('maps framework errors to stable codes', async () => {
    const headers = { authorization: `Bearer ${context.apiKey}` };
    const badJson = await inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: '{"oops"',
    });
    expect(badJson.statusCode).toBe(400);
    expect(badJson.json()).toEqual({ error: 'VALIDATION_ERROR' });
    const tooLarge = await inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers,
      payload: { displayText: long(17_000) },
    });
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json()).toEqual({ error: 'PAYLOAD_TOO_LARGE' });
    const text = await inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: { ...headers, 'content-type': 'application/xml' },
      payload: '<hello/>',
    });
    expect(text.statusCode).toBe(415);
    expect(text.json()).toEqual({ error: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('answers unknown routes with NOT_FOUND', async () => {
    const response = await inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'NOT_FOUND' });
  });
});

describe('security headers', () => {
  it('sends a strict CSP, no-referrer and no CORS headers', async () => {
    const response = await inject({
      method: 'GET',
      url: '/livez',
      headers: { origin: 'https://evil.example' },
    });
    const csp = String(response.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });

  it('sends HSTS in production', async () => {
    const production = await createTestApp({
      env: { NODE_ENV: 'production' },
      database: context.database,
    });
    const response = await production.app.inject({ method: 'GET', url: '/livez' });
    expect(response.headers['strict-transport-security']).toContain('max-age=31536000');
    await production.close();
  });
});

describe('internal errors', () => {
  it('never expose stacks or messages', async () => {
    const broken = await createTestApp({
      database: context.database,
      generators: {
        id: () => {
          throw new Error('secret internal detail');
        },
      },
    });
    const response = await api(broken).create();
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: 'INTERNAL_ERROR',
      requestId: response.headers['x-request-id'],
    });
    expect(response.body).not.toContain('secret internal detail');
    await broken.close();
  });
});
