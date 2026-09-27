import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from './config.js';
import { createDb } from './db/database.js';
import { migrateToLatest, migrations } from './db/migrate.js';
import { generateCode, generateShortId } from './domain/code.js';
import { buildApp } from './http/app.js';
import { startJobs } from './jobs/jobs.js';
import type { Timer } from './jobs/scheduler.js';
import { createLogger } from './logger.js';
import type { Generators } from './services/requests.js';

type Signal = 'SIGTERM' | 'SIGINT' | 'uncaughtException' | 'unhandledRejection';

/** The slice of `process` the CLI needs, injectable for tests. */
export interface Proc {
  argv: string[];
  env: Record<string, string | undefined>;
  exit: (code: number) => void;
  on: (event: Signal, listener: (reason?: unknown) => void) => unknown;
  stderr: { write: (text: string) => unknown };
}

export interface Runtime {
  frontendDir: string | null;
  timer: Timer;
}

export interface Server {
  app: FastifyInstance;
  shutdown: () => Promise<void>;
}

export const DEFAULT_FRONTEND_DIR = fileURLToPath(new URL('../../frontend/dist', import.meta.url));

export const systemTimer: Timer = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => {
    clearInterval(handle as NodeJS.Timeout);
  },
};

export function resolveFrontendDir(candidate: string): string | null {
  return existsSync(candidate) ? candidate : null;
}

export function defaultGenerators(codeLength: number): Generators {
  return {
    id: randomUUID,
    code: () => generateCode(codeLength),
    shortId: () => generateShortId(),
  };
}

async function serve(proc: Proc, runtime: Runtime): Promise<Server> {
  const config = loadConfig(proc.env);
  const logger = createLogger(config.LOG_LEVEL);
  const crash = (reason?: unknown): void => {
    logger.fatal({ err: reason }, 'uncaught exception, exiting');
    proc.exit(1);
  };
  proc.on('uncaughtException', crash);
  proc.on('unhandledRejection', crash);
  const db = createDb(config.DATABASE_URL);
  const clock = (): Date => new Date();
  const app = await buildApp({
    config,
    db,
    logger,
    clock,
    generators: defaultGenerators(config.CODE_LENGTH),
    frontendDir: runtime.frontendDir,
  });
  const jobs = startJobs({ db, config, clock, timer: runtime.timer, logger });
  await app.listen({ port: config.PORT, host: config.HOST });
  const shutdown = async (): Promise<void> => {
    await Promise.all(jobs.map((job) => job.stop()));
    await app.close();
    await db.destroy();
  };
  const onSignal = (): void => {
    void shutdown().then(() => {
      proc.exit(0);
    });
  };
  proc.on('SIGTERM', onSignal);
  proc.on('SIGINT', onSignal);
  return { app, shutdown };
}

async function migrate(proc: Proc): Promise<null> {
  const config = loadConfig(proc.env);
  const db = createDb(config.DATABASE_URL, 1);
  try {
    await migrateToLatest(db, migrations);
    proc.stderr.write('Migrations applied.\n');
  } finally {
    await db.destroy();
  }
  return null;
}

export async function runCli(proc: Proc, runtime: Runtime): Promise<Server | null> {
  const command = proc.argv[2];
  if (command === 'serve') return serve(proc, runtime);
  if (command === 'migrate') return migrate(proc);
  throw new Error('Usage: tessera <serve|migrate>');
}

/** Entry point: failures print a safe message (never a secret value) and exit with 1. */
export async function main(proc: Proc): Promise<void> {
  try {
    await runCli(proc, {
      frontendDir: resolveFrontendDir(DEFAULT_FRONTEND_DIR),
      timer: systemTimer,
    });
  } catch (error) {
    proc.stderr.write(`${String(error)}\n`);
    proc.exit(1);
  }
}
