import { Writable } from 'node:stream';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { defaultGenerators } from '../../src/cli.js';
import { loadConfig, type Config } from '../../src/config.js';
import { buildApp } from '../../src/http/app.js';
import { createLogger } from '../../src/logger.js';
import type { Generators } from '../../src/services/requests.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { baseEnv } from './env.js';

export class FakeClock {
  constructor(public current = new Date('2026-09-27T14:32:01.000Z')) {}
  now = (): Date => new Date(this.current.getTime());
  advance(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

export interface TestContext {
  app: FastifyInstance;
  config: Config;
  apiKey: string;
  clock: FakeClock;
  logs: string[];
  database: TestDatabase;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  env?: Record<string, string | undefined>;
  generators?: Partial<Generators>;
  frontendDir?: string | null;
  database?: TestDatabase;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestContext> {
  const config = loadConfig(baseEnv(options.env));
  const database = options.database ?? (await createTestDatabase());
  const clock = new FakeClock();
  const logs: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      logs.push(chunk.toString());
      callback();
    },
  });
  const app = await buildApp({
    config,
    db: database.db,
    logger: createLogger(config.LOG_LEVEL, sink),
    clock: clock.now,
    generators: { ...defaultGenerators(config.CODE_LENGTH), ...options.generators },
    frontendDir: options.frontendDir ?? null,
  });
  await app.ready();
  return {
    app,
    config,
    apiKey: config.API_KEYS[0] ?? '',
    clock,
    logs,
    database,
    close: async () => {
      await app.close();
      if (options.database === undefined) await database.drop();
    },
  };
}

export const alice = { id: '42', name: 'Alice Martin' };
export const bruno = { id: '7', name: 'Bruno Keller' };

export function requestBody(overrides: Record<string, unknown> = {}) {
  return {
    requester: alice,
    approver: bruno,
    action: 'CHANGE_PROJECT_PRIORITY',
    displayText: 'Alice demande de passer « Projet A » de la priorité 3 à la priorité 1',
    context: { projectId: 'A', oldPriority: 3, newPriority: 1 },
    expiresInSeconds: 600,
    authorizationDurationSeconds: 3600,
    maxAttempts: 5,
    ...overrides,
  };
}

export interface Api {
  create: (body?: unknown, headers?: Record<string, string>) => Promise<LightMyRequestResponse>;
  get: (id: string) => Promise<LightMyRequestResponse>;
  verify: (id: string, code: string) => Promise<LightMyRequestResponse>;
  cancel: (id: string, body?: unknown) => Promise<LightMyRequestResponse>;
  events: (id: string) => Promise<LightMyRequestResponse>;
}

export function api(context: TestContext): Api {
  const authorization = `Bearer ${context.apiKey}`;
  return {
    create: (body = requestBody(), headers = {}) =>
      context.app.inject({
        method: 'POST',
        url: '/api/v1/requests',
        headers: { authorization, ...headers },
        payload: body as Record<string, unknown>,
      }),
    get: (id) =>
      context.app.inject({
        method: 'GET',
        url: `/api/v1/requests/${id}`,
        headers: { authorization },
      }),
    verify: (id, code) =>
      context.app.inject({
        method: 'POST',
        url: `/api/v1/requests/${id}/verify`,
        headers: { authorization },
        payload: { code },
      }),
    cancel: (id, body) =>
      context.app.inject({
        method: 'POST',
        url: `/api/v1/requests/${id}/cancel`,
        headers: { authorization },
        ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
      }),
    events: (id) =>
      context.app.inject({
        method: 'GET',
        url: `/api/v1/requests/${id}/events`,
        headers: { authorization },
      }),
  };
}

export interface Created {
  id: string;
  shortId: string;
  code: string;
  codeFormatted: string;
  expiresAt: string;
}

export async function createRequest(context: TestContext, body?: unknown): Promise<Created> {
  const response = await api(context).create(body);
  if (response.statusCode !== 201) throw new Error(`create failed: ${response.body}`);
  return response.json<Created>();
}
