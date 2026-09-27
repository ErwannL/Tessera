import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/database.js';
import {
  api,
  createRequest,
  createTestApp,
  requestBody,
  type TestContext,
} from '../helpers/app.js';
import { login } from '../helpers/handoff.js';

let context: TestContext;

beforeAll(async () => {
  context = await createTestApp({ env: { LOG_LEVEL: 'trace' } });
});
afterAll(async () => context.close());

describe('health', () => {
  it('answers /livez and /health while PostgreSQL responds', async () => {
    expect((await context.app.inject({ url: '/livez' })).json()).toEqual({ status: 'ok' });
    const health = await context.app.inject({ url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });
  });

  it('answers 503 without details when PostgreSQL is unavailable', async () => {
    const down = await createTestApp({ database: context.database });
    const unreachable = createDb('postgres://nobody:nothing@127.0.0.1:1/none');
    await down.app.close();
    const { buildApp } = await import('../../src/http/app.js');
    const app = await buildApp({
      config: down.config,
      db: unreachable,
      logger: (await import('pino')).default({ level: 'silent' }),
      clock: down.clock.now,
      generators: {
        id: () => crypto.randomUUID(),
        code: () => 'AAAAAA',
        shortId: () => '0000-AAAA',
      },
      frontendDir: null,
    });
    const health = await app.inject({ url: '/health' });
    expect(health.statusCode).toBe(503);
    expect(health.json()).toEqual({ status: 'unavailable' });
    expect((await app.inject({ url: '/livez' })).statusCode).toBe(200);
    await app.close();
    await unreachable.destroy();
  });

  it('survives the server terminating idle pooled connections', async () => {
    await sql`SELECT 1`.execute(context.database.db);
    const admin = createDb(process.env.TEST_DATABASE_URL ?? '', 1);
    const database = new URL(context.database.url).pathname.slice(1);
    await sql`
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = ${database} AND pid <> pg_backend_pid()
    `.execute(admin);
    await admin.destroy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await context.app.inject({ url: '/health' })).statusCode).toBe(200);
  });
});

describe('OpenAPI', () => {
  it('serves an OpenAPI 3.1 document generated from the schemas', async () => {
    const response = await context.app.inject({ url: '/api/v1/openapi.json' });
    const document = response.json<{ openapi: string; paths: Record<string, unknown> }>();
    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.paths)).toEqual([
      '/requests',
      '/requests/{id}',
      '/requests/{id}/verify',
      '/requests/{id}/cancel',
      '/requests/{id}/events',
    ]);
    expect(response.body).toContain('"displayText"');
    expect(response.body).toContain('"maxLength":500');
  });
});

describe('static dashboard', () => {
  it('serves the built frontend when a directory is provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tessera-front-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>TESSERA</title>');
    const withFront = await createTestApp({ database: context.database, frontendDir: dir });
    const response = await withFront.app.inject({ url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('TESSERA');
    expect((await withFront.app.inject({ url: '/missing.js' })).statusCode).toBe(404);
    await withFront.close();
  });
});

describe('rate limits', () => {
  it('limits verify per request', async () => {
    const limited = await createTestApp({
      database: context.database,
      env: { RATE_LIMIT_VERIFY_REQUEST_MAX: '2' },
    });
    const first = await createRequest(limited);
    const second = await createRequest(limited);
    const statuses = [];
    for (let index = 0; index < 3; index += 1) {
      statuses.push((await api(limited).verify(first.id, 'WRONG1')).statusCode);
    }
    expect(statuses).toEqual([422, 422, 429]);
    expect((await api(limited).verify(second.id, second.code)).statusCode).toBe(200);
    await limited.close();
  });

  it('limits verify per IP across requests', async () => {
    const limited = await createTestApp({
      database: context.database,
      env: { RATE_LIMIT_VERIFY_IP_MAX: '2' },
    });
    const requests = [
      await createRequest(limited),
      await createRequest(limited),
      await createRequest(limited),
    ];
    const statuses = [];
    for (const request of requests) {
      statuses.push((await api(limited).verify(request.id, request.code)).statusCode);
    }
    expect(statuses).toEqual([200, 200, 429]);
    await limited.close();
  });

  it('limits the API per key', async () => {
    const limited = await createTestApp({
      database: context.database,
      env: { RATE_LIMIT_API_MAX: '2' },
    });
    const statuses = [];
    for (let index = 0; index < 3; index += 1) {
      statuses.push((await api(limited).create()).statusCode);
    }
    expect(statuses).toEqual([201, 201, 429]);
    await limited.close();
  });
});

describe('logs', () => {
  it('never contain a code, key, secret, token, context or display text', async () => {
    const before = context.logs.length;
    const body = requestBody({
      displayText: 'Texte-Tres-Secret',
      context: { hidden: 'Contexte-Prive' },
    });
    const created = await createRequest(context, body);
    await api(context).get(created.id);
    await api(context).verify(created.id, 'WRONG1');
    await api(context).verify(created.id, created.code);
    await api(context).verify(created.id, created.codeFormatted);
    await api(context).events(created.id);
    await api(context).cancel(created.id, { reason: 'late' });
    const cookie = await login(context);
    await context.app.inject({
      url: '/api/v1/dashboard/requests?role=requester',
      headers: { cookie },
    });
    await context.app.inject({
      url: `/api/v1/dashboard/requests/${created.id}`,
      headers: { cookie },
    });
    const lines = context.logs.slice(before).join('\n');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines).toContain(created.id);
    const forbidden = [
      created.code,
      created.codeFormatted,
      ...context.config.API_KEYS,
      context.config.CODE_HMAC_KEY,
      context.config.HANDOFF_SECRET,
      context.config.SESSION_SECRET,
      cookie.split('=')[1]!,
      'Texte-Tres-Secret',
      'Contexte-Prive',
    ];
    for (const value of forbidden) {
      expect(lines).not.toContain(value);
    }
  });
});
