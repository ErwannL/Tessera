import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { DomainError } from '../domain/errors.js';

const FRAMEWORK_ERRORS: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
};

export function parseInput<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new DomainError('VALIDATION_ERROR', {
      details: result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

/** Never exposes stacks or internal messages: unknown failures become INTERNAL_ERROR. */
export function errorHandler(
  error: FastifyError | DomainError,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof DomainError) {
    return reply.code(error.status).send(error.toBody());
  }
  const status = error.statusCode ?? 500;
  const known = FRAMEWORK_ERRORS[status];
  if (known !== undefined) {
    return reply.code(status).send({ error: known });
  }
  request.log.error({ err: error }, 'unhandled error');
  return reply.code(500).send({ error: 'INTERNAL_ERROR', requestId: request.id });
}
