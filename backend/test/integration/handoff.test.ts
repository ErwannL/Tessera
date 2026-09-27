import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestContext } from '../helpers/app.js';
import { randomSecret } from '../helpers/env.js';
import { login, postHandoff, signHandoff } from '../helpers/handoff.js';

let context: TestContext;

beforeAll(async () => {
  context = await createTestApp({ env: { RATE_LIMIT_HANDOFF_IP_MAX: '1000' } });
});
afterAll(async () => context.close());

const me = (cookie: string) =>
  context.app.inject({ method: 'GET', url: '/api/v1/dashboard/me', headers: { cookie } });

describe('POST /api/v1/dashboard/handoff', () => {
  it('opens a session with a strict, HttpOnly, Secure cookie', async () => {
    const response = await postHandoff(context, await signHandoff(context));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: '42', name: 'Alice Martin' });
    const cookie = response.cookies[0]!;
    expect(cookie).toMatchObject({
      name: 'tessera_session',
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: 3600,
    });
    const session = await me(`tessera_session=${cookie.value}`);
    expect(session.json()).toEqual({
      id: '42',
      name: 'Alice Martin',
      hasRequested: false,
      hasToApprove: false,
    });
  });

  it('does not set Secure in development', async () => {
    const dev = await createTestApp({
      env: { NODE_ENV: 'development' },
      database: context.database,
    });
    const response = await postHandoff(dev, await signHandoff(dev));
    expect(response.cookies[0]!.secure).toBeUndefined();
    await dev.close();
  });

  it.each([
    ['a wrong signature', { secret: randomSecret() }],
    ['a wrong audience', { audience: 'someone-else' }],
    ['a lifetime above 60 seconds', { lifetime: 61 }],
    ['a non-positive lifetime', { lifetime: 0 }],
    ['an expired token', { issuedAtOffset: -120 }],
    ['an issue date in the future', { issuedAtOffset: 600 }],
    ['a missing name', { omit: 'name' as const }],
    ['a short jti', { jti: 'abc' }],
  ])('refuses %s', async (_label, options) => {
    const response = await postHandoff(context, await signHandoff(context, options));
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'INVALID_HANDOFF' });
    expect(response.cookies).toEqual([]);
  });

  it('refuses garbage and a replayed jti', async () => {
    expect((await postHandoff(context, 'not.a.jwt')).statusCode).toBe(401);
    const token = await signHandoff(context);
    expect((await postHandoff(context, token)).statusCode).toBe(200);
    const replay = await postHandoff(context, token);
    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toEqual({ error: 'INVALID_HANDOFF' });
  });

  it('refuses a foreign or missing Origin', async () => {
    const token = await signHandoff(context);
    expect((await postHandoff(context, token, 'https://evil.example')).json()).toEqual({
      error: 'FORBIDDEN_ORIGIN',
    });
    const noOrigin = await context.app.inject({
      method: 'POST',
      url: '/api/v1/dashboard/handoff',
      payload: { token },
    });
    expect(noOrigin.statusCode).toBe(403);
  });

  it('validates the body', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/dashboard/handoff',
      headers: { origin: context.config.PUBLIC_URL },
      payload: { token: '' },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('session', () => {
  it('is required, and expires after SESSION_TTL_SECONDS', async () => {
    expect((await me('')).json()).toEqual({ error: 'UNAUTHORIZED' });
    expect((await me('tessera_session=forged')).statusCode).toBe(401);
    const cookie = await login(context);
    context.clock.advance(3601);
    expect((await me(cookie)).statusCode).toBe(401);
    context.clock.advance(-3601);
  });

  it('ends with logout, which also checks the Origin', async () => {
    const cookie = await login(context);
    const foreign = await context.app.inject({
      method: 'POST',
      url: '/api/v1/dashboard/logout',
      headers: { cookie },
    });
    expect(foreign.statusCode).toBe(403);
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/dashboard/logout',
      headers: { cookie, origin: context.config.PUBLIC_URL },
    });
    expect(response.statusCode).toBe(204);
    expect(response.cookies[0]).toMatchObject({ name: 'tessera_session', value: '' });
  });
});

describe('rate limit', () => {
  it('limits handoff attempts per IP', async () => {
    const limited = await createTestApp({
      env: { RATE_LIMIT_HANDOFF_IP_MAX: '2' },
      database: context.database,
    });
    const statuses = [];
    for (let index = 0; index < 3; index += 1) {
      statuses.push((await postHandoff(limited, 'garbage')).statusCode);
    }
    expect(statuses).toEqual([401, 401, 429]);
    expect((await postHandoff(limited, 'garbage')).json()).toEqual({ error: 'RATE_LIMITED' });
    await limited.close();
  });
});
