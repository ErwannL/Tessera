import { z } from 'zod';
import { EVENT_TYPES, REQUEST_STATUSES } from '../db/schema.js';

export const CONTEXT_MAX_BYTES = 8192;
export const ACTION_PATTERN = /^[A-Z0-9_.:-]{1,64}$/;

export interface ExpiryBounds {
  min: number;
  max: number;
}

const person = z.strictObject({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
});

const context = z
  .record(z.string(), z.json())
  .refine((value) => Buffer.byteLength(JSON.stringify(value)) <= CONTEXT_MAX_BYTES, {
    message: `context must not exceed ${String(CONTEXT_MAX_BYTES)} bytes once serialized`,
  });

export function createRequestBody(bounds: ExpiryBounds) {
  return z.strictObject({
    requester: person,
    approver: person,
    action: z.string().regex(ACTION_PATTERN),
    displayText: z.string().min(1).max(500),
    context: context.optional(),
    expiresInSeconds: z.int().min(bounds.min).max(bounds.max).optional(),
    authorizationDurationSeconds: z.int().min(0).max(2_147_483_647).nullable().optional(),
    maxAttempts: z.int().min(1).max(10).optional(),
  });
}
export type CreateRequestBody = z.infer<ReturnType<typeof createRequestBody>>;

export const idempotencyKeyHeader = z.string().min(1).max(128).optional();
export const requestIdParams = z.object({ id: z.uuid() });
export const verifyBody = z.strictObject({ code: z.string().min(1).max(64) });
export const cancelBody = z.strictObject({ reason: z.string().min(1).max(500).optional() });

const status = z.enum(REQUEST_STATUSES);
const timestamp = z.iso.datetime();
const nullableTimestamp = timestamp.nullable();
const personView = z.object({ id: z.string(), name: z.string() });

export const requestView = z.object({
  id: z.uuid(),
  shortId: z.string(),
  status,
  requester: personView,
  approver: personView,
  action: z.string(),
  displayText: z.string(),
  context: z.record(z.string(), z.json()),
  authorizationDurationSeconds: z.int().nullable(),
  attempts: z.int(),
  maxAttempts: z.int(),
  attemptsRemaining: z.int(),
  createdAt: timestamp,
  expiresAt: timestamp,
  approvedAt: nullableTimestamp,
  cancelledAt: nullableTimestamp,
  expiredAt: nullableTimestamp,
  lockedAt: nullableTimestamp,
  cancelReason: z.string().nullable(),
});
export type RequestView = z.infer<typeof requestView>;

export const createResponse = z.object({
  id: z.uuid(),
  shortId: z.string(),
  status,
  code: z.string().nullable(),
  codeFormatted: z.string().nullable(),
  expiresAt: timestamp,
  createdAt: timestamp,
  idempotentReplay: z.boolean(),
});
export type CreateResponse = z.infer<typeof createResponse>;

export const verifyResponse = z.object({
  id: z.uuid(),
  status: z.literal('APPROVED'),
  approvedAt: timestamp,
  requester: personView,
  approver: personView,
  action: z.string(),
  context: z.record(z.string(), z.json()),
  authorizationDurationSeconds: z.int().nullable(),
});
export type VerifyResponse = z.infer<typeof verifyResponse>;

export const eventView = z.object({
  id: z.string(),
  type: z.enum(EVENT_TYPES),
  at: timestamp,
  meta: z.record(z.string(), z.json()),
});
export type EventView = z.infer<typeof eventView>;

export const eventsResponse = z.object({ events: z.array(eventView), chainValid: z.boolean() });

export const errorResponse = z.object({
  error: z.string(),
  details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  attemptsRemaining: z.int().optional(),
  status: status.optional(),
  requestId: z.string().optional(),
});

export const handoffBody = z.strictObject({ token: z.string().min(1).max(4096) });

export const dashboardListQuery = z.strictObject({
  role: z.enum(['requester', 'approver']),
  status: status.optional(),
  action: z.string().regex(ACTION_PATTERN).optional(),
  from: timestamp.optional(),
  to: timestamp.optional(),
  counterpart: z.string().min(1).max(200).optional(),
  cursor: z.string().min(1).max(200).optional(),
});
export type DashboardListQuery = z.infer<typeof dashboardListQuery>;

export const meResponse = z.object({
  id: z.string(),
  name: z.string(),
  hasRequested: z.boolean(),
  hasToApprove: z.boolean(),
});

export const dashboardListResponse = z.object({
  items: z.array(requestView),
  nextCursor: z.string().nullable(),
});

export const dashboardDetailResponse = z.object({
  request: requestView,
  events: z.array(eventView),
  chainValid: z.boolean(),
});
