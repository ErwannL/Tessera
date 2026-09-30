import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { Config } from '../../config.js';
import type { Database } from '../../db/schema.js';
import { DomainError } from '../../domain/errors.js';
import { dashboardListQuery, handoffBody, requestIdParams } from '../../domain/schemas.js';
import type { DashboardService, SessionUser } from '../../services/dashboard.js';
import { parseInput } from '../errors.js';
import { limitHook } from '../rateLimits.js';
import { SESSION_COOKIE, type SessionTools } from '../session.js';

export interface DashboardRoutesOptions {
  config: Config;
  db: Kysely<Database>;
  service: DashboardService;
  sessions: SessionTools;
  clock: () => Date;
}

/** Dashboard API: session cookie only (never the API key), read-only except handoff/logout. */
export function dashboardRoutes(app: FastifyInstance, options: DashboardRoutesOptions): void {
  const { config, db, service, sessions, clock } = options;
  // Framed by another site (EMBED_ORIGINS), a Strict cookie is never sent: the session is
  // then SameSite=None, Secure and partitioned (per top-level site). The Origin check above
  // still closes CSRF.
  const embedded = config.EMBED_ORIGINS.length > 0;
  const cookieOptions = {
    httpOnly: true,
    secure: embedded || config.NODE_ENV !== 'development',
    sameSite: embedded ? 'none' : 'strict',
    ...(embedded ? { partitioned: true } : {}),
    path: '/',
  } as const;

  // Public: lets the page know where « Back to Orqea » leads: the Orqea origin that opened
  // the dashboard (signed claim kept in the session), else this environment's TESSERA_ORQEA_URL.
  app.get('/config', async (request) => {
    const session = await sessions.readSession(request.cookies[SESSION_COOKIE]);
    return { orqeaUrl: session?.orqeaOrigin ?? config.TESSERA_ORQEA_URL };
  });

  // CSRF: besides SameSite=Strict, state-changing calls must come from our own origin.
  const checkOrigin = async (request: FastifyRequest): Promise<void> => {
    if (request.headers.origin !== config.PUBLIC_URL) throw new DomainError('FORBIDDEN_ORIGIN');
  };

  const currentUser = async (request: FastifyRequest): Promise<SessionUser> => {
    const session = await sessions.readSession(request.cookies[SESSION_COOKIE]);
    if (session === null) throw new DomainError('UNAUTHORIZED');
    return session.user;
  };

  const handoffLimit = limitHook(app, [
    {
      max: config.RATE_LIMIT_HANDOFF_IP_MAX,
      windowSeconds: config.RATE_LIMIT_WINDOW_SECONDS,
      key: (request) => `handoff-ip:${request.ip}`,
    },
  ]);

  app.post('/handoff', { onRequest: [handoffLimit, checkOrigin] }, async (request, reply) => {
    const { token } = parseInput(handoffBody, request.body);
    const handoff = await sessions.verifyHandoff(token);
    // The primary key on jti makes a replayed token fail, even under concurrency.
    const inserted = await db
      .insertInto('dashboard_handoffs')
      .values({ jti: handoff.jti, used_at: clock(), expires_at: handoff.expiresAt })
      .onConflict((conflict) => conflict.column('jti').doNothing())
      .returning('jti')
      .executeTakeFirst();
    if (inserted === undefined) throw new DomainError('INVALID_HANDOFF');
    const session = await sessions.issueSession(handoff.user, handoff.orqeaOrigin);
    return reply
      .setCookie(SESSION_COOKIE, session, { ...cookieOptions, maxAge: config.SESSION_TTL_SECONDS })
      .send(handoff.user);
  });

  app.post('/logout', { onRequest: checkOrigin }, async (_request, reply) =>
    reply.clearCookie(SESSION_COOKIE, cookieOptions).code(204).send(),
  );

  app.get('/me', async (request) => service.me(await currentUser(request)));

  app.get('/requests', async (request) => {
    const user = await currentUser(request);
    return service.list(user, parseInput(dashboardListQuery, request.query));
  });

  app.get('/requests/:id', async (request) => {
    const user = await currentUser(request);
    const parsed = requestIdParams.safeParse(request.params);
    if (!parsed.success) throw new DomainError('NOT_FOUND');
    return service.detail(user, parsed.data.id);
  });
}
