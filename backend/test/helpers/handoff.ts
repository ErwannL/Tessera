import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import type { TestContext } from './app.js';

export interface HandoffOptions {
  sub?: string;
  name?: string;
  jti?: string;
  audience?: string;
  secret?: string;
  lifetime?: number;
  issuedAtOffset?: number;
  omit?: 'name';
  /** Signed `orq` claim: the Orqea origin that opened the dashboard. */
  orq?: string;
}

/** Signs a handoff token the way an App server would. */
export async function signHandoff(
  context: TestContext,
  options: HandoffOptions = {},
): Promise<string> {
  const iat = Math.floor(context.clock.now().getTime() / 1000) + (options.issuedAtOffset ?? 0);
  const claims: Record<string, string> =
    options.omit === 'name' ? {} : { name: options.name ?? 'Alice Martin' };
  if (options.orq !== undefined) claims.orq = options.orq;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(options.sub ?? '42')
    .setJti(options.jti ?? randomUUID())
    .setAudience(options.audience ?? 'tessera-dashboard')
    .setIssuedAt(iat)
    .setExpirationTime(iat + (options.lifetime ?? 60))
    .sign(new TextEncoder().encode(options.secret ?? context.config.HANDOFF_SECRET));
}

export async function postHandoff(
  context: TestContext,
  token: string,
  origin = context.config.PUBLIC_URL,
) {
  return context.app.inject({
    method: 'POST',
    url: '/api/v1/dashboard/handoff',
    headers: { origin },
    payload: { token },
  });
}

/** Performs a handoff and returns the session cookie header value. */
export async function login(
  context: TestContext,
  sub = '42',
  name = 'Alice Martin',
): Promise<string> {
  const response = await postHandoff(context, await signHandoff(context, { sub, name }));
  if (response.statusCode !== 200) throw new Error(`handoff failed: ${response.body}`);
  const cookie = response.cookies.find((candidate) => candidate.name === 'tessera_session');
  return `tessera_session=${cookie?.value ?? ''}`;
}
