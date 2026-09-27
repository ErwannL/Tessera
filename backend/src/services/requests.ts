import { createHash } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import type { Config } from '../config.js';
import type { Database, RequestRow, RequestStatus } from '../db/schema.js';
import { codeMatches, formatCode, hmacCode } from '../domain/code.js';
import { DomainError, type ErrorCode } from '../domain/errors.js';
import { canonicalJson } from '../domain/hashChain.js';
import type {
  CreateRequestBody,
  CreateResponse,
  EventView,
  RequestView,
  VerifyResponse,
} from '../domain/schemas.js';
import { toEventView, toRequestView } from '../domain/views.js';
import { appendEvent, isChainValid, loadEvents } from './events.js';
import { expireRow, isDue, lockRequest } from './expiry.js';

export const SHORT_ID_CONSTRAINT = 'requests_short_id_key';
export const IDEMPOTENCY_CONSTRAINT = 'requests_idempotency_key_key';
const MAX_SHORT_ID_ATTEMPTS = 5;

export interface Generators {
  id: () => string;
  code: () => string;
  shortId: () => string;
}

export interface RequestServiceDeps {
  db: Kysely<Database>;
  config: Pick<Config, 'CODE_HMAC_KEY' | 'DEFAULT_EXPIRES_IN_SECONDS' | 'DEFAULT_MAX_ATTEMPTS'>;
  clock: () => Date;
  generators: Generators;
}

/** Caller metadata recorded in events (never the code, never the API key). */
export interface CallMeta {
  ip: string;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: DomainError };

const REJECTION_BY_STATUS: Record<Exclude<RequestStatus, 'PENDING'>, ErrorCode> = {
  APPROVED: 'ALREADY_APPROVED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  LOCKED: 'LOCKED',
};

export function uniqueViolation(error: unknown): string | undefined {
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === '23505' ? String(candidate.constraint) : undefined;
}

function unwrap<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

function fail<T>(code: ErrorCode, extra: Record<string, unknown> = {}): Outcome<T> {
  return { ok: false, error: new DomainError(code, extra) };
}

export function createRequestService(deps: RequestServiceDeps) {
  const { db, config, clock, generators } = deps;

  function replay(row: RequestRow, fingerprint: Buffer): CreateResponse {
    if (!row.request_fingerprint.equals(fingerprint)) {
      throw new DomainError('IDEMPOTENCY_CONFLICT');
    }
    return {
      id: row.id,
      shortId: row.short_id,
      status: row.status,
      code: null,
      codeFormatted: null,
      expiresAt: row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      idempotentReplay: true,
    };
  }

  async function findByIdempotencyKey(key: string): Promise<RequestRow | undefined> {
    return db
      .selectFrom('requests')
      .selectAll()
      .where('idempotency_key', '=', key)
      .executeTakeFirst();
  }

  async function insertOnce(
    body: Required<CreateRequestBody>,
    idempotencyKey: string | null,
    fingerprint: Buffer,
    meta: CallMeta,
  ): Promise<CreateResponse> {
    const id = generators.id();
    const code = generators.code();
    const shortId = generators.shortId();
    const createdAt = clock();
    const expiresAt = new Date(createdAt.getTime() + body.expiresInSeconds * 1000);
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('requests')
        .values({
          id,
          short_id: shortId,
          requester_id: body.requester.id,
          requester_name: body.requester.name,
          approver_id: body.approver.id,
          approver_name: body.approver.name,
          action: body.action,
          display_text: body.displayText,
          context: JSON.stringify(body.context),
          authorization_duration_seconds: body.authorizationDurationSeconds,
          status: 'PENDING',
          code_hmac: hmacCode(config.CODE_HMAC_KEY, id, code),
          max_attempts: body.maxAttempts,
          idempotency_key: idempotencyKey,
          request_fingerprint: fingerprint,
          created_at: createdAt,
          expires_at: expiresAt,
        })
        .execute();
      await appendEvent(trx, { requestId: id, type: 'CREATED', at: createdAt, meta: { ...meta } });
    });
    return {
      id,
      shortId,
      status: 'PENDING',
      code,
      codeFormatted: formatCode(code),
      expiresAt: expiresAt.toISOString(),
      createdAt: createdAt.toISOString(),
      idempotentReplay: false,
    };
  }

  async function insertWithRetry(
    body: Required<CreateRequestBody>,
    idempotencyKey: string | null,
    fingerprint: Buffer,
    meta: CallMeta,
  ): Promise<CreateResponse> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await insertOnce(body, idempotencyKey, fingerprint, meta);
      } catch (error) {
        if (attempt >= MAX_SHORT_ID_ATTEMPTS || uniqueViolation(error) !== SHORT_ID_CONSTRAINT) {
          throw error;
        }
      }
    }
  }

  async function create(
    input: CreateRequestBody,
    idempotencyKey: string | null,
    meta: CallMeta,
  ): Promise<CreateResponse> {
    if (input.requester.id === input.approver.id) {
      throw new DomainError('SELF_APPROVAL_FORBIDDEN');
    }
    const body: Required<CreateRequestBody> = {
      ...input,
      context: input.context ?? {},
      expiresInSeconds: input.expiresInSeconds ?? config.DEFAULT_EXPIRES_IN_SECONDS,
      authorizationDurationSeconds: input.authorizationDurationSeconds ?? null,
      maxAttempts: input.maxAttempts ?? config.DEFAULT_MAX_ATTEMPTS,
    };
    const fingerprint = createHash('sha256').update(canonicalJson(body)).digest();
    if (idempotencyKey !== null) {
      const existing = await findByIdempotencyKey(idempotencyKey);
      if (existing !== undefined) return replay(existing, fingerprint);
    }
    try {
      return await insertWithRetry(body, idempotencyKey, fingerprint, meta);
    } catch (error) {
      // A concurrent call with the same Idempotency-Key committed first.
      if (idempotencyKey !== null && uniqueViolation(error) === IDEMPOTENCY_CONSTRAINT) {
        const winner = await db
          .selectFrom('requests')
          .selectAll()
          .where('idempotency_key', '=', idempotencyKey)
          .executeTakeFirstOrThrow();
        return replay(winner, fingerprint);
      }
      throw error;
    }
  }

  /** Runs `step` on the locked row, after expiring it if its deadline has passed. */
  async function withLockedRequest<T>(
    id: string,
    source: 'read' | 'verify' | 'cancel',
    step: (trx: Transaction<Database>, row: RequestRow, now: Date) => Promise<Outcome<T>>,
  ): Promise<T> {
    const outcome = await db.transaction().execute(async (trx): Promise<Outcome<T>> => {
      const locked = await lockRequest(trx, id);
      if (locked === undefined) return fail('NOT_FOUND');
      const now = clock();
      const row = isDue(locked, now) ? await expireRow(trx, locked, now, source) : locked;
      return step(trx, row, now);
    });
    return unwrap(outcome);
  }

  async function get(id: string): Promise<RequestView> {
    return withLockedRequest(id, 'read', (_trx, row) =>
      Promise.resolve({ ok: true, value: toRequestView(row) }),
    );
  }

  async function registerFailure(
    trx: Transaction<Database>,
    row: RequestRow,
    now: Date,
    meta: CallMeta,
  ): Promise<Outcome<VerifyResponse>> {
    const attempts = row.attempts + 1;
    if (attempts >= row.max_attempts) {
      await trx
        .updateTable('requests')
        .set({ attempts, status: 'LOCKED', locked_at: now })
        .where('id', '=', row.id)
        .execute();
      await appendEvent(trx, {
        requestId: row.id,
        type: 'LOCKED',
        at: now,
        meta: { ...meta, attempts },
      });
      return fail('LOCKED');
    }
    const attemptsRemaining = row.max_attempts - attempts;
    await trx.updateTable('requests').set({ attempts }).where('id', '=', row.id).execute();
    await appendEvent(trx, {
      requestId: row.id,
      type: 'VERIFY_FAILED',
      at: now,
      meta: { ...meta, attemptsRemaining },
    });
    return fail('INVALID_CODE', { attemptsRemaining });
  }

  async function verify(id: string, code: string, meta: CallMeta): Promise<VerifyResponse> {
    return withLockedRequest(id, 'verify', async (trx, row, now) => {
      if (row.status !== 'PENDING') {
        await appendEvent(trx, {
          requestId: row.id,
          type: 'VERIFY_REJECTED',
          at: now,
          meta: { ...meta, status: row.status },
        });
        return fail(REJECTION_BY_STATUS[row.status]);
      }
      if (!codeMatches(config.CODE_HMAC_KEY, row.id, row.code_hmac, code)) {
        return registerFailure(trx, row, now, meta);
      }
      await trx
        .updateTable('requests')
        .set({ status: 'APPROVED', approved_at: now })
        .where('id', '=', row.id)
        .execute();
      await appendEvent(trx, { requestId: row.id, type: 'APPROVED', at: now, meta: { ...meta } });
      return {
        ok: true,
        value: {
          id: row.id,
          status: 'APPROVED',
          approvedAt: now.toISOString(),
          requester: { id: row.requester_id, name: row.requester_name },
          approver: { id: row.approver_id, name: row.approver_name },
          action: row.action,
          context: row.context as VerifyResponse['context'],
          authorizationDurationSeconds: row.authorization_duration_seconds,
        },
      };
    });
  }

  async function cancel(id: string, reason: string | null, meta: CallMeta): Promise<RequestView> {
    return withLockedRequest(id, 'cancel', async (trx, row, now) => {
      if (row.status === 'CANCELLED') return { ok: true, value: toRequestView(row) };
      if (row.status !== 'PENDING') return fail('NOT_CANCELLABLE', { status: row.status });
      const updated = await trx
        .updateTable('requests')
        .set({ status: 'CANCELLED', cancelled_at: now, cancel_reason: reason })
        .where('id', '=', row.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await appendEvent(trx, {
        requestId: row.id,
        type: 'CANCELLED',
        at: now,
        meta: { ...meta, reason },
      });
      return { ok: true, value: toRequestView(updated) };
    });
  }

  async function events(id: string): Promise<{ events: EventView[]; chainValid: boolean }> {
    const exists = await db
      .selectFrom('requests')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst();
    if (exists === undefined) throw new DomainError('NOT_FOUND');
    const rows = await loadEvents(db, id);
    return { events: rows.map(toEventView), chainValid: isChainValid(rows) };
  }

  return { create, get, verify, cancel, events };
}

export type RequestService = ReturnType<typeof createRequestService>;
