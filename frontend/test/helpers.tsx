import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { vi } from 'vitest';
import type { Api } from '../src/api';
import { initI18n } from '../src/i18n';
import type { Detail, Me, Page, RequestView } from '../src/types';

export async function renderWithI18n(ui: ReactElement, language: 'fr' | 'en' = 'fr') {
  const i18n = await initI18n(language);
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

let sequence = 0;

export function makeRequest(overrides: Partial<RequestView> = {}): RequestView {
  sequence += 1;
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    shortId: `${String(1000 + sequence)}-KQMX`,
    status: 'PENDING',
    requester: { id: '42', name: 'Alice Martin' },
    approver: { id: '7', name: 'Bruno Keller' },
    action: 'CHANGE_PROJECT_PRIORITY',
    displayText: 'Passer « Projet A » en priorité 1',
    context: { projectId: 'A', newPriority: 1 },
    authorizationDurationSeconds: 3600,
    attempts: 0,
    maxAttempts: 5,
    attemptsRemaining: 5,
    createdAt: '2026-09-27T14:32:01.000Z',
    expiresAt: '2026-09-27T14:42:01.000Z',
    approvedAt: null,
    cancelledAt: null,
    expiredAt: null,
    lockedAt: null,
    cancelReason: null,
    ...overrides,
  };
}

export const aliceMe: Me = {
  id: '42',
  name: 'Alice Martin',
  hasRequested: true,
  hasToApprove: true,
};

export function page(items: RequestView[], nextCursor: string | null = null): Page {
  return { items, nextCursor };
}

export function detailOf(request: RequestView, chainValid = true): Detail {
  return {
    request,
    chainValid,
    events: [
      { id: '1', type: 'CREATED', at: request.createdAt, meta: {} },
      { id: '2', type: 'VERIFY_FAILED', at: request.createdAt, meta: { attemptsRemaining: 4 } },
    ],
  };
}

export function fakeApi(overrides: Partial<Api> = {}): Api {
  return {
    handoff: vi.fn(() => Promise.resolve(aliceMe)),
    logout: vi.fn(() => Promise.resolve(null)),
    me: vi.fn(() => Promise.resolve(aliceMe)),
    list: vi.fn(() => Promise.resolve(page([makeRequest()]))),
    detail: vi.fn((id: string) => Promise.resolve(detailOf(makeRequest({ id })))),
    ...overrides,
  };
}

export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
