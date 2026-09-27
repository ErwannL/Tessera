import pino, { type DestinationStream, type Logger } from 'pino';

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  stack?: unknown;
}

/**
 * Keeps only the type, message, code and stack of an error. Driver errors can carry a
 * `detail` echoing row contents (display text, context), which must never reach the logs.
 */
export function serializeError(error: unknown): Record<string, unknown> {
  const candidate = (error ?? {}) as ErrorLike;
  return {
    type: candidate.name,
    message: candidate.message,
    code: candidate.code,
    stack: candidate.stack,
  };
}

export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      serializers: { err: serializeError },
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        censor: '[redacted]',
      },
    },
    destination,
  );
}
