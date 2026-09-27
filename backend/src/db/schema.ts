import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';

export const REQUEST_STATUSES = ['PENDING', 'APPROVED', 'EXPIRED', 'CANCELLED', 'LOCKED'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const EVENT_TYPES = [
  'CREATED',
  'VERIFY_FAILED',
  'APPROVED',
  'EXPIRED',
  'CANCELLED',
  'LOCKED',
  'VERIFY_REJECTED',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type JsonObject = Record<string, unknown>;
type Json = ColumnType<JsonObject, string, string>;

export interface RequestsTable {
  id: string;
  short_id: string;
  requester_id: string;
  requester_name: string;
  approver_id: string;
  approver_name: string;
  action: string;
  display_text: string;
  context: Json;
  authorization_duration_seconds: number | null;
  status: RequestStatus;
  code_hmac: Buffer;
  attempts: Generated<number>;
  max_attempts: number;
  idempotency_key: string | null;
  request_fingerprint: Buffer;
  created_at: Date;
  expires_at: Date;
  approved_at: Date | null;
  cancelled_at: Date | null;
  expired_at: Date | null;
  locked_at: Date | null;
  cancel_reason: string | null;
}

export interface RequestEventsTable {
  id: Generated<string>;
  request_id: string;
  type: EventType;
  at: Date;
  meta: Json;
  prev_hash: Buffer | null;
  hash: Buffer;
}

export interface DashboardHandoffsTable {
  jti: string;
  used_at: Date;
  expires_at: Date;
}

export interface Database {
  requests: RequestsTable;
  request_events: RequestEventsTable;
  dashboard_handoffs: DashboardHandoffsTable;
}

export type RequestRow = Selectable<RequestsTable>;
export type NewRequestRow = Insertable<RequestsTable>;
export type EventRow = Selectable<RequestEventsTable>;
