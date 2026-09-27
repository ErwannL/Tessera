import { sql, type Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { Database } from '../db/schema.js';

export interface Timer {
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

export type LockResult<T> = { ran: false } | { ran: true; value: T };

/**
 * Runs `task` only if this instance obtains the PostgreSQL advisory lock `key`, so a single
 * instance executes a periodic job at a time. The lock is bound to one pooled session.
 */
export async function withAdvisoryLock<T>(
  db: Kysely<Database>,
  key: number,
  task: () => Promise<T>,
): Promise<LockResult<T>> {
  return db.connection().execute(async (connection) => {
    const { rows } = await sql<{
      locked: boolean;
    }>`SELECT pg_try_advisory_lock(${key}) AS locked`.execute(connection);
    if (!rows.some((row) => row.locked)) return { ran: false };
    try {
      return { ran: true, value: await task() };
    } finally {
      await sql`SELECT pg_advisory_unlock(${key})`.execute(connection);
    }
  });
}

export interface ScheduledJob {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
}

export interface JobHandle {
  /** Runs the job now, or joins the run already in progress (runs never overlap). */
  tick: () => Promise<void>;
  /** Cancels the interval and waits for the run in progress, if any. */
  stop: () => Promise<void>;
}

export function schedule(job: ScheduledJob, timer: Timer, logger: Logger): JobHandle {
  let current: Promise<void> | null = null;
  async function runSafely(): Promise<void> {
    try {
      await job.run();
    } catch (error) {
      logger.error({ err: error, job: job.name }, 'job failed');
    }
  }
  function tick(): Promise<void> {
    current ??= runSafely().finally(() => {
      current = null;
    });
    return current;
  }
  const handle = timer.setInterval(() => void tick(), job.intervalMs);
  return {
    tick,
    stop: async () => {
      timer.clearInterval(handle);
      await current;
    },
  };
}
