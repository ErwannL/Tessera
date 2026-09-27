import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FRONTEND_DIR,
  defaultGenerators,
  main,
  resolveFrontendDir,
  runCli,
  systemTimer,
  type Proc,
} from '../../src/cli.js';
import { CODE_ALPHABET } from '../../src/domain/code.js';
import { createTestDatabase, type TestDatabase } from '../helpers/db.js';
import { baseEnv } from '../helpers/env.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase(false);
});
afterAll(async () => database.drop());

function fakeProc(argv: string[], env: Record<string, string | undefined>) {
  const listeners = new Map<string, (reason?: unknown) => void>();
  const output: string[] = [];
  const proc: Proc = {
    argv: ['node', 'main.js', ...argv],
    env,
    exit: vi.fn(),
    on: (event, listener) => listeners.set(event, listener),
    stderr: { write: (text: string) => output.push(text) },
  };
  return { proc, listeners, output };
}

const timer = { setInterval: vi.fn(() => 1), clearInterval: vi.fn() };

describe('cli', () => {
  it('migrates, then serves the API and shuts down on SIGTERM', async () => {
    const env = baseEnv({
      DATABASE_URL: database.url,
      PORT: '0',
      HOST: '127.0.0.1',
      LOG_LEVEL: 'silent',
    });
    const migrate = fakeProc(['migrate'], env);
    await main(migrate.proc);
    expect(migrate.output).toEqual(['Migrations applied.\n']);
    expect(migrate.proc.exit).not.toHaveBeenCalled();

    const serve = fakeProc(['serve'], env);
    const server = await runCli(serve.proc, { frontendDir: null, timer });
    expect(server).not.toBeNull();
    const address = server?.app.server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const health = await fetch(`http://127.0.0.1:${String(port)}/health`);
    expect(health.status).toBe(200);
    expect(timer.setInterval).toHaveBeenCalledTimes(2);

    serve.listeners.get('SIGTERM')?.();
    await vi.waitFor(
      () => {
        expect(serve.proc.exit).toHaveBeenCalledWith(0);
      },
      { timeout: 15_000 },
    );
    expect(timer.clearInterval).toHaveBeenCalledTimes(2);
  });

  it('logs and exits with 1 on an uncaught exception', async () => {
    const env = baseEnv({
      DATABASE_URL: database.url,
      PORT: '0',
      HOST: '127.0.0.1',
      LOG_LEVEL: 'silent',
    });
    const serve = fakeProc(['serve'], env);
    const server = await runCli(serve.proc, { frontendDir: null, timer });
    serve.listeners.get('uncaughtException')?.(new Error('boom'));
    expect(serve.proc.exit).toHaveBeenCalledWith(1);
    serve.listeners.get('unhandledRejection')?.('reason');
    expect(serve.proc.exit).toHaveBeenCalledTimes(2);
    await server?.shutdown();
  });

  it('prints a safe message and exits with 1 on invalid configuration', async () => {
    const secret = 'short-secret-value';
    const run = fakeProc(['serve'], baseEnv({ SESSION_SECRET: secret }));
    await main(run.proc);
    expect(run.proc.exit).toHaveBeenCalledWith(1);
    expect(run.output.join('')).toContain('SESSION_SECRET');
    expect(run.output.join('')).not.toContain(secret);
  });

  it('rejects unknown commands', async () => {
    const unknown = fakeProc(['dance'], baseEnv());
    await main(unknown.proc);
    expect(unknown.output).toEqual(['Error: Usage: tessera <serve|migrate>\n']);
    expect(unknown.proc.exit).toHaveBeenCalledWith(1);
  });

  it('reports a failed migration and exits with 1', async () => {
    const run = fakeProc(
      ['migrate'],
      baseEnv({ DATABASE_URL: 'postgres://nobody:x@127.0.0.1:1/none' }),
    );
    await main(run.proc);
    expect(run.proc.exit).toHaveBeenCalledWith(1);
    expect(run.output.join('')).toContain('Database migration failed');
  });
});

describe('runtime helpers', () => {
  it('resolves the frontend directory only when it exists', () => {
    expect(DEFAULT_FRONTEND_DIR).toMatch(/frontend[\\/]dist$/);
    const dir = mkdtempSync(`${tmpdir()}/front-`);
    expect(resolveFrontendDir(dir)).toBe(dir);
    expect(resolveFrontendDir(`${dir}/missing`)).toBeNull();
  });

  it('uses cryptographic generators', () => {
    const generators = defaultGenerators(8);
    expect(generators.code()).toHaveLength(8);
    expect(generators.code()).toMatch(new RegExp(`^[${CODE_ALPHABET}]+$`));
    expect(generators.shortId()).toMatch(/^\d{4}-[A-Z]{4}$/);
    expect(generators.id()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('wraps the system timer', () => {
    const callback = vi.fn();
    vi.useFakeTimers();
    const handle = systemTimer.setInterval(callback, 1000);
    vi.advanceTimersByTime(2000);
    systemTimer.clearInterval(handle);
    vi.advanceTimersByTime(2000);
    vi.useRealTimers();
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
