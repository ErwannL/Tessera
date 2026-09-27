import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../../config.js';
import { DomainError } from '../../domain/errors.js';
import {
  cancelBody,
  createRequestBody,
  idempotencyKeyHeader,
  requestIdParams,
  verifyBody,
} from '../../domain/schemas.js';
import type { RequestService } from '../../services/requests.js';
import { createApiKeyVerifier } from '../apiKeys.js';
import { parseInput } from '../errors.js';
import { limitHook } from '../rateLimits.js';

export interface RequestRoutesOptions {
  config: Config;
  service: RequestService;
}

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Unknown or malformed ids are simply not found. */
function requestId(request: FastifyRequest): string {
  const parsed = requestIdParams.safeParse(request.params);
  if (!parsed.success) throw new DomainError('NOT_FOUND');
  return parsed.data.id;
}

/** Server-to-server API, authenticated with an API key. No CORS headers are ever sent. */
export function requestRoutes(app: FastifyInstance, options: RequestRoutesOptions): void {
  const { config, service } = options;
  const isValidKey = createApiKeyVerifier(config.API_KEYS);
  const windowSeconds = config.RATE_LIMIT_WINDOW_SECONDS;
  const createBody = createRequestBody({
    min: config.MIN_EXPIRES_IN_SECONDS,
    max: config.MAX_EXPIRES_IN_SECONDS,
  });

  app.addHook('onRequest', async (request) => {
    if (!isValidKey(request.headers.authorization)) throw new DomainError('UNAUTHORIZED');
  });
  // Generous per-key limit against a runaway script.
  app.addHook(
    'onRequest',
    limitHook(app, [
      {
        max: config.RATE_LIMIT_API_MAX,
        windowSeconds,
        key: (request) => `api-key:${digest(String(request.headers.authorization))}`,
      },
    ]),
  );

  // Brute force protection on verify: per IP and per request.
  const verifyLimits = limitHook(app, [
    {
      max: config.RATE_LIMIT_VERIFY_IP_MAX,
      windowSeconds,
      key: (request) => `verify-ip:${request.ip}`,
    },
    {
      max: config.RATE_LIMIT_VERIFY_REQUEST_MAX,
      windowSeconds,
      key: (request) => `verify-request:${(request.params as { id: string }).id}`,
    },
  ]);

  app.post('/requests', async (request, reply) => {
    const body = parseInput(createBody, request.body);
    const key = parseInput(idempotencyKeyHeader, request.headers['idempotency-key']);
    const result = await service.create(body, key ?? null, { ip: request.ip });
    return reply.code(result.idempotentReplay ? 200 : 201).send(result);
  });

  app.get('/requests/:id', async (request) => service.get(requestId(request)));

  app.post('/requests/:id/verify', { onRequest: verifyLimits }, async (request) => {
    const id = requestId(request);
    const { code } = parseInput(verifyBody, request.body);
    return service.verify(id, code, { ip: request.ip });
  });

  app.post('/requests/:id/cancel', async (request) => {
    const id = requestId(request);
    const { reason } = parseInput(cancelBody, request.body ?? {});
    return service.cancel(id, reason ?? null, { ip: request.ip });
  });

  app.get('/requests/:id/events', async (request) => service.events(requestId(request)));
}
