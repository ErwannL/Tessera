import { createHmac, randomUUID } from 'node:crypto';

/**
 * Minimal Tessera client, as an App server would write it. Every call is server to server:
 * the API key and the codes never reach a browser.
 */
export interface TesseraOptions {
  apiUrl: string;
  publicUrl: string;
  apiKey: string;
  handoffSecret: string;
}

export interface Person {
  id: string;
  name: string;
}

export interface TesseraAnswer {
  status: number;
  body: Record<string, unknown>;
}

export function createTesseraClient(options: TesseraOptions) {
  async function call(method: string, path: string, body?: unknown): Promise<TesseraAnswer> {
    const response = await fetch(`${options.apiUrl}/api/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  const base64url = (value: string | Buffer): string => Buffer.from(value).toString('base64url');

  /** Signs a 60-second, single-use handoff token (HS256) for the dashboard. */
  function handoffUrl(user: Person): string {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64url(
      JSON.stringify({
        sub: user.id,
        name: user.name,
        jti: randomUUID(),
        iat: now,
        exp: now + 60,
        aud: 'tessera-dashboard',
      }),
    );
    const signature = base64url(
      createHmac('sha256', options.handoffSecret).update(`${header}.${payload}`).digest(),
    );
    return `${options.publicUrl}/#handoff=${header}.${payload}.${signature}`;
  }

  return {
    create: (body: unknown) => call('POST', '/requests', body),
    get: (id: string) => call('GET', `/requests/${id}`),
    verify: (id: string, code: string) => call('POST', `/requests/${id}/verify`, { code }),
    cancel: (id: string) =>
      call('POST', `/requests/${id}/cancel`, { reason: 'Annulée par le demandeur' }),
    handoffUrl,
  };
}

export type TesseraClient = ReturnType<typeof createTesseraClient>;
