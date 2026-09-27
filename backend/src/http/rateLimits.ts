import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DomainError } from '../domain/errors.js';

export interface LimitOptions {
  max: number;
  windowSeconds: number;
  key: (request: FastifyRequest) => string;
}

/**
 * Builds an onRequest hook enforcing several independent limits (e.g. per IP AND per request).
 * Each limit has its own key namespace in the @fastify/rate-limit store.
 */
export function limitHook(app: FastifyInstance, limits: readonly LimitOptions[]) {
  const checks = limits.map((limit) =>
    app.createRateLimit({
      max: limit.max,
      timeWindow: limit.windowSeconds * 1000,
      keyGenerator: limit.key,
    }),
  );
  return async (request: FastifyRequest): Promise<void> => {
    for (const check of checks) {
      // No allow-list is configured, so every result carries `isExceeded`.
      const result = (await check(request)) as { isExceeded?: boolean };
      if (result.isExceeded === true) throw new DomainError('RATE_LIMITED');
    }
  };
}
