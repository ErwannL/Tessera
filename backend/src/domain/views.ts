import type { EventRow, RequestRow } from '../db/schema.js';
import type { EventView, RequestView } from './schemas.js';

const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

export function toRequestView(row: RequestRow): RequestView {
  return {
    id: row.id,
    shortId: row.short_id,
    status: row.status,
    requester: { id: row.requester_id, name: row.requester_name },
    approver: { id: row.approver_id, name: row.approver_name },
    action: row.action,
    displayText: row.display_text,
    context: row.context as RequestView['context'],
    authorizationDurationSeconds: row.authorization_duration_seconds,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    attemptsRemaining: Math.max(0, row.max_attempts - row.attempts),
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    approvedAt: iso(row.approved_at),
    cancelledAt: iso(row.cancelled_at),
    expiredAt: iso(row.expired_at),
    lockedAt: iso(row.locked_at),
    cancelReason: row.cancel_reason,
  };
}

export function toEventView(row: EventRow): EventView {
  return {
    id: row.id,
    type: row.type,
    at: row.at.toISOString(),
    meta: row.meta as EventView['meta'],
  };
}
