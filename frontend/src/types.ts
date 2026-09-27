export type RequestStatus = 'PENDING' | 'APPROVED' | 'EXPIRED' | 'CANCELLED' | 'LOCKED';
export const STATUSES: readonly RequestStatus[] = [
  'PENDING',
  'APPROVED',
  'EXPIRED',
  'CANCELLED',
  'LOCKED',
];

export type Role = 'requester' | 'approver';

export interface Person {
  id: string;
  name: string;
}

export interface RequestView {
  id: string;
  shortId: string;
  status: RequestStatus;
  requester: Person;
  approver: Person;
  action: string;
  displayText: string;
  context: Record<string, unknown>;
  authorizationDurationSeconds: number | null;
  attempts: number;
  maxAttempts: number;
  attemptsRemaining: number;
  createdAt: string;
  expiresAt: string;
  approvedAt: string | null;
  cancelledAt: string | null;
  expiredAt: string | null;
  lockedAt: string | null;
  cancelReason: string | null;
}

export interface EventView {
  id: string;
  type: string;
  at: string;
  meta: Record<string, unknown>;
}

export interface Me {
  id: string;
  name: string;
  hasRequested: boolean;
  hasToApprove: boolean;
}

export interface Page {
  items: RequestView[];
  nextCursor: string | null;
}

export interface Detail {
  request: RequestView;
  events: EventView[];
  chainValid: boolean;
}

export interface Filters {
  status: RequestStatus | '';
  action: string;
  from: string;
  to: string;
  counterpart: string;
}

export const EMPTY_FILTERS: Filters = { status: '', action: '', from: '', to: '', counterpart: '' };
