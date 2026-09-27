import { sql } from 'kysely';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createJobs, PURGE_LOCK_KEY, startJobs, SWEEP_LOCK_KEY } from '../../src/jobs/jobs.js';
import { schedule, withAdvisoryLock, type Timer } from '../../src/jobs/scheduler.js';
import { sweepExpired } from '../../src/services/expiry.js';
import {
  api,
  bruno,
  alice,
  createRequest,
  createTestApp,
  requestBody,
  type TestContext,
} from '../helpers/app.js';

let context: TestContext;
const DAY = 86_400;

beforeAll(async () => {
  context = await createTestApp();
});
afterAll(async () => context.close());

function capturingLogger() {
  const lines: Record<string, unknown>[] = [];
  const logger = pino(
    { level: 'info' },
    { write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>) },
  );
  return { logger, lines };
}

function jobs(logger = capturingLogger().logger) {
  return createJobs({
    db: context.database.db,
    config: { EXPIRY_SWEEP_INTERVAL_SECONDS: 60, RETENTION_DAYS: 365 },
    clock: context.clock.now,
    logger,
  });
}

async function types(id: string): Promise<string[]> {
  const body = (await api(context).events(id)).json<{ events: { type: string }[] }>();
  return body.events.map((event) => event.type);
}

describe('expiry sweep', () => {
  it('expires due PENDING requests once, and never twice with lazy reads', async () => {
    const due = await createRequest(context, requestBody({ expiresInSeconds: 60 }));
    const fresh = await createRequest(context, requestBody({ expiresInSeconds: 600 }));
    context.clock.advance(60);
    const { logger, lines } = capturingLogger();
    await jobs(logger).sweep();
    await jobs(logger).sweep();
    expect(lines.filter((line) => line.job === 'expiry-sweep')).toHaveLength(1);
    expect(lines[0]).toMatchObject({ expired: 1 });
    expect((await api(context).get(due.id)).json()).toMatchObject({ status: 'EXPIRED' });
    expect(await types(due.id)).toEqual(['CREATED', 'EXPIRED']);
    expect((await api(context).get(fresh.id)).json()).toMatchObject({ status: 'PENDING' });
    context.clock.advance(-60);
  });

  it('can be restricted to the requests of one user', async () => {
    const mine = await createRequest(context, requestBody({ expiresInSeconds: 60 }));
    const theirs = await createRequest(
      context,
      requestBody({
        expiresInSeconds: 60,
        requester: { id: 'x1', name: 'X' },
        approver: { id: 'x2', name: 'Y' },
      }),
    );
    context.clock.advance(60);
    expect(await sweepExpired(context.database.db, context.clock.now(), alice.id)).toBe(1);
    expect(await types(mine.id)).toEqual(['CREATED', 'EXPIRED']);
    expect(await types(theirs.id)).toEqual(['CREATED']);
    expect(await sweepExpired(context.database.db, context.clock.now(), bruno.id)).toBe(0);
    await sweepExpired(context.database.db, context.clock.now(), null);
    context.clock.advance(-60);
  });
});

describe('purge', () => {
  it('deletes finished requests past retention, keeps recent and PENDING ones', async () => {
    const outer = context;
    context = await createTestApp();
    const old = await createRequest(context);
    await api(context).cancel(old.id);
    const pending = await createRequest(context, requestBody({ expiresInSeconds: 86_400 }));
    await context.database.db
      .insertInto('dashboard_handoffs')
      .values({ jti: 'old-jti', used_at: context.clock.now(), expires_at: context.clock.now() })
      .execute();
    context.clock.advance(300 * DAY);
    const recent = await createRequest(context);
    await api(context).cancel(recent.id);
    context.clock.advance(66 * DAY);
    const { logger, lines } = capturingLogger();
    await jobs(logger).purge();
    expect(lines).toEqual([expect.objectContaining({ job: 'purge', requests: 1, handoffs: 1 })]);
    expect(JSON.stringify(lines)).not.toContain('Projet A');
    expect((await api(context).get(old.id)).statusCode).toBe(404);
    expect(
      await context.database.db
        .selectFrom('request_events')
        .where('request_id', '=', old.id)
        .select('id')
        .execute(),
    ).toEqual([]);
    expect((await api(context).get(recent.id)).statusCode).toBe(200);
    const kept = await context.database.db
      .selectFrom('requests')
      .select('status')
      .where('id', '=', pending.id)
      .executeTakeFirstOrThrow();
    expect(kept.status).toBe('PENDING');
    await context.close();
    context = outer;
  });
});

describe('advisory lock', () => {
  it('lets only one instance run a job at a time', async () => {
    const other = context.database.db;
    let inside = 0;
    let concurrent = 0;
    const task = async () => {
      inside += 1;
      concurrent = Math.max(concurrent, inside);
      await new Promise((resolve) => setTimeout(resolve, 50));
      inside -= 1;
      return 'done';
    };
    const results = await Promise.all([
      withAdvisoryLock(context.database.db, SWEEP_LOCK_KEY, task),
      withAdvisoryLock(other, SWEEP_LOCK_KEY, task),
    ]);
    expect(results.filter((result) => result.ran)).toHaveLength(1);
    expect(concurrent).toBe(1);
    expect(await withAdvisoryLock(other, SWEEP_LOCK_KEY, task)).toEqual({
      ran: true,
      value: 'done',
    });
  });

  it('skips the jobs silently when another instance holds the locks', async () => {
    await context.database.db.connection().execute(async (connection) => {
      await sql`SELECT pg_advisory_lock(${SWEEP_LOCK_KEY}), pg_advisory_lock(${PURGE_LOCK_KEY})`.execute(
        connection,
      );
      const { logger, lines } = capturingLogger();
      await jobs(logger).sweep();
      await jobs(logger).purge();
      expect(lines).toEqual([]);
      await sql`SELECT pg_advisory_unlock_all()`.execute(connection);
    });
  });

  it('releases the lock when the task fails', async () => {
    await expect(
      withAdvisoryLock(context.database.db, 1234, () => Promise.reject(new Error('fail'))),
    ).rejects.toThrow('fail');
    expect(await withAdvisoryLock(context.database.db, 1234, () => Promise.resolve(1))).toEqual({
      ran: true,
      value: 1,
    });
  });
});

describe('scheduler', () => {
  function fakeTimer() {
    const callbacks: (() => void)[] = [];
    const timer: Timer = {
      setInterval: vi.fn((callback: () => void) => {
        callbacks.push(callback);
        return callbacks.length;
      }),
      clearInterval: vi.fn(),
    };
    return { timer, callbacks };
  }

  it('runs on each interval, never overlaps and logs failures', async () => {
    const { timer, callbacks } = fakeTimer();
    const { logger, lines } = capturingLogger();
    let release: () => void = () => undefined;
    const run = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error('db down'));
    const handle = schedule({ name: 'demo', intervalMs: 1000, run }, timer, logger);
    expect(timer.setInterval).toHaveBeenCalledWith(expect.any(Function), 1000);
    const first = handle.tick();
    callbacks[0]!();
    expect(handle.tick()).toBe(first);
    expect(run).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stopping = handle.stop().then(() => {
      stopped = true;
    });
    expect(timer.clearInterval).toHaveBeenCalledWith(1);
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);
    await handle.tick();
    expect(lines).toEqual([expect.objectContaining({ job: 'demo', msg: 'job failed' })]);
  });

  it('starts the sweep and the daily purge immediately', async () => {
    const { timer } = fakeTimer();
    const handles = startJobs({
      db: context.database.db,
      config: { EXPIRY_SWEEP_INTERVAL_SECONDS: 30, RETENTION_DAYS: 365 },
      clock: context.clock.now,
      timer,
      logger: capturingLogger().logger,
    });
    expect(timer.setInterval).toHaveBeenNthCalledWith(1, expect.any(Function), 30_000);
    expect(timer.setInterval).toHaveBeenNthCalledWith(2, expect.any(Function), 86_400_000);
    await Promise.all(handles.map((handle) => handle.stop()));
    expect(timer.clearInterval).toHaveBeenCalledTimes(2);
  });
});
