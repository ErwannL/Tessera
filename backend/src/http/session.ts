import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import { DomainError } from '../domain/errors.js';
import type { SessionUser } from '../services/dashboard.js';

export const HANDOFF_AUDIENCE = 'tessera-dashboard';
export const SESSION_AUDIENCE = 'tessera-session';
export const SESSION_COOKIE = 'tessera_session';
export const MAX_HANDOFF_LIFETIME_SECONDS = 60;
const CLOCK_TOLERANCE_SECONDS = 5;

const handoffClaims = z
  .object({
    sub: z.string().min(1).max(128),
    name: z.string().min(1).max(200),
    jti: z.string().min(16).max(128),
    iat: z.int(),
    exp: z.int(),
  })
  .refine((claims) => claims.exp > claims.iat, 'exp must follow iat')
  .refine(
    (claims) => claims.exp - claims.iat <= MAX_HANDOFF_LIFETIME_SECONDS,
    'handoff tokens live 60 seconds at most',
  );

const sessionClaims = z.object({ sub: z.string(), name: z.string() });

export interface VerifiedHandoff {
  user: SessionUser;
  jti: string;
  expiresAt: Date;
}

export interface SessionToolsOptions {
  handoffSecret: string;
  sessionSecret: string;
  ttlSeconds: number;
  clock: () => Date;
}

export function createSessionTools(options: SessionToolsOptions) {
  const handoffKey = new TextEncoder().encode(options.handoffSecret);
  const sessionKey = new TextEncoder().encode(options.sessionSecret);

  async function verifyHandoff(token: string): Promise<VerifiedHandoff> {
    try {
      const { payload } = await jwtVerify(token, handoffKey, {
        algorithms: ['HS256'],
        audience: HANDOFF_AUDIENCE,
        requiredClaims: ['sub', 'jti', 'iat', 'exp'],
        maxTokenAge: MAX_HANDOFF_LIFETIME_SECONDS,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        currentDate: options.clock(),
      });
      const claims = handoffClaims.parse(payload);
      return {
        user: { id: claims.sub, name: claims.name },
        jti: claims.jti,
        expiresAt: new Date(claims.exp * 1000),
      };
    } catch {
      throw new DomainError('INVALID_HANDOFF');
    }
  }

  async function issueSession(user: SessionUser): Promise<string> {
    const issuedAt = Math.floor(options.clock().getTime() / 1000);
    return new SignJWT({ name: user.name })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setAudience(SESSION_AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + options.ttlSeconds)
      .sign(sessionKey);
  }

  async function readSession(token: string | undefined): Promise<SessionUser | null> {
    try {
      const { payload } = await jwtVerify(token ?? '', sessionKey, {
        algorithms: ['HS256'],
        audience: SESSION_AUDIENCE,
        requiredClaims: ['exp'],
        currentDate: options.clock(),
      });
      const claims = sessionClaims.parse(payload);
      return { id: claims.sub, name: claims.name };
    } catch {
      return null;
    }
  }

  return { verifyHandoff, issueSession, readSession };
}

export type SessionTools = ReturnType<typeof createSessionTools>;
