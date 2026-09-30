import type { Detail, Filters, Me, Page, Role } from './types';

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${String(status)}`);
  }
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const BASE = '/api/v1/dashboard';

/** Local calendar day (YYYY-MM-DD) → UTC instant at the start or the end of that day. */
export function dayToIso(day: string, endOfDay: boolean): string {
  return new Date(`${day}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).toISOString();
}

export function listQuery(role: Role, filters: Filters, cursor: string | null): string {
  const params = new URLSearchParams({ role });
  if (filters.status !== '') params.set('status', filters.status);
  if (filters.action !== '') params.set('action', filters.action);
  if (filters.from !== '') params.set('from', dayToIso(filters.from, false));
  if (filters.to !== '') params.set('to', dayToIso(filters.to, true));
  if (filters.counterpart !== '') params.set('counterpart', filters.counterpart);
  if (cursor !== null) params.set('cursor', cursor);
  return params.toString();
}

/** Dashboard client: same-origin calls authenticated by the HttpOnly session cookie. */
export function createApi(fetchImpl: Fetch) {
  interface CallInit {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  }

  async function call<T>(path: string, init: CallInit = {}): Promise<T> {
    const response = await fetchImpl(`${BASE}${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: { accept: 'application/json', ...init.headers },
    });
    if (!response.ok) throw new ApiError(response.status);
    return (await response.json()) as T;
  }

  const post = <T>(path: string, body: unknown) =>
    call<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });

  return {
    handoff: (token: string) => post<Me>('/handoff', { token }),
    me: () => call<Me>('/me'),
    config: () => call<{ orqeaUrl: string }>('/config'),
    list: (role: Role, filters: Filters, cursor: string | null) =>
      call<Page>(`/requests?${listQuery(role, filters, cursor)}`),
    detail: (id: string) => call<Detail>(`/requests/${encodeURIComponent(id)}`),
  };
}

export type Api = ReturnType<typeof createApi>;
