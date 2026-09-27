import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { Config } from '../config.js';
import type { Database } from '../db/schema.js';
import { sweepExpired } from '../services/expiry.js';
import { purgeExpiredData } from '../services/purge.js';
import { schedule, withAdvisoryLock, type JobHandle, type Timer } from './scheduler.js';

export const SWEEP_LOCK_KEY = 73_010_001;
export const PURGE_LOCK_KEY = 73_010_002;
const DAY_MS = 86_400_000;

export interface JobsDeps {
  db: Kysely<Database>;
  config: Pick<Config, 'EXPIRY_SWEEP_INTERVAL_SECONDS' | 'RETENTION_DAYS'>;
  clock: () => Date;
  timer: Timer;
  logger: Logger;
}

export function createJobs({ db, config, clock, logger }: Omit<JobsDeps, 'timer'>) {
  async function sweep(): Promise<void> {
    const result = await withAdvisoryLock(db, SWEEP_LOCK_KEY, () =>
      sweepExpired(db, clock(), null),
    );
    if (result.ran && result.value > 0) {
      logger.info({ job: 'expiry-sweep', expired: result.value }, 'expired pending requests');
    }
  }

  async function purge(): Promise<void> {
    const result = await withAdvisoryLock(db, PURGE_LOCK_KEY, () =>
      purgeExpiredData(db, clock(), config.RETENTION_DAYS),
    );
    if (result.ran) {
      logger.info({ job: 'purge', ...result.value }, 'purged data past retention');
    }
  }

  return { sweep, purge };
}

/** Starts the periodic sweep and the daily purge (also run once at startup). */
export function startJobs(deps: JobsDeps): JobHandle[] {
  const { sweep, purge } = createJobs(deps);
  const handles = [
    schedule(
      {
        name: 'expiry-sweep',
        intervalMs: deps.config.EXPIRY_SWEEP_INTERVAL_SECONDS * 1000,
        run: sweep,
      },
      deps.timer,
      deps.logger,
    ),
    schedule({ name: 'purge', intervalMs: DAY_MS, run: purge }, deps.timer, deps.logger),
  ];
  handles.forEach((handle) => void handle.tick());
  return handles;
}
