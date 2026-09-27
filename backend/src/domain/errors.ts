export const ERROR_STATUS = {
  NOT_FOUND: 404,
  INVALID_CODE: 422,
  LOCKED: 423,
  EXPIRED: 410,
  ALREADY_APPROVED: 409,
  CANCELLED: 409,
  NOT_CANCELLABLE: 409,
  SELF_APPROVAL_FORBIDDEN: 422,
  IDEMPOTENCY_CONFLICT: 409,
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  INVALID_HANDOFF: 401,
  FORBIDDEN_ORIGIN: 403,
  RATE_LIMITED: 429,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

/** An expected failure with a stable, documented error code. */
export class DomainError extends Error {
  override name = 'DomainError';

  constructor(
    readonly code: ErrorCode,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }

  toBody(): Record<string, unknown> {
    return { error: this.code, ...this.extra };
  }
}
