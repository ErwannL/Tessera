import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { Config } from '../config.js';
import type { Database } from '../db/schema.js';
import { createDashboardService } from '../services/dashboard.js';
import { createRequestService, type Generators } from '../services/requests.js';
import { errorHandler } from './errors.js';
import { buildOpenApi } from './openapi.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { healthRoutes } from './routes/health.js';
import { requestRoutes } from './routes/requests.js';
import { createSessionTools } from './session.js';

export const BODY_LIMIT_BYTES = 16 * 1024;

export interface AppDeps {
  config: Config;
  db: Kysely<Database>;
  logger: Logger;
  clock: () => Date;
  generators: Generators;
  /** Built dashboard (frontend/dist); null when only the API is served. */
  frontendDir: string | null;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, db, clock } = deps;
  const production = config.NODE_ENV === 'production';
  const logger: FastifyBaseLogger = deps.logger;
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: config.TRUST_PROXY,
    genReqId: () => randomUUID(),
  });
  app.setErrorHandler(errorHandler);
  // Lets operators correlate an INTERNAL_ERROR answer with the server logs.
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'NOT_FOUND' }));

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: production ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
  });
  await app.register(cookie);
  // In-memory store, per instance (see docs/DECISIONS.md). Limits are applied by limitHook.
  await app.register(rateLimit, { global: false });

  const requests = createRequestService(deps);
  const dashboard = createDashboardService({ db, clock });
  const sessions = createSessionTools({
    handoffSecret: config.HANDOFF_SECRET,
    sessionSecret: config.SESSION_SECRET,
    ttlSeconds: config.SESSION_TTL_SECONDS,
    clock,
  });
  const openApi = buildOpenApi(config);

  await app.register(healthRoutes, { db });
  app.get('/api/v1/openapi.json', async () => openApi);
  await app.register(requestRoutes, { prefix: '/api/v1', config, service: requests });
  await app.register(dashboardRoutes, {
    prefix: '/api/v1/dashboard',
    config,
    db,
    service: dashboard,
    sessions,
    clock,
  });
  if (deps.frontendDir !== null) {
    await app.register(fastifyStatic, { root: deps.frontendDir, wildcard: false });
  }
  return app;
}
