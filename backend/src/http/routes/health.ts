import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';

export function healthRoutes(app: FastifyInstance, options: { db: Kysely<Database> }): void {
  app.get('/livez', async () => ({ status: 'ok' }));

  app.get('/health', async (_request, reply) => {
    try {
      await sql`SELECT 1`.execute(options.db);
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
}
