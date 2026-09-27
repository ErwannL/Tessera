import { randomBytes } from 'node:crypto';

/** Secrets are generated at test time: none is ever committed. */
export const randomSecret = (): string => randomBytes(32).toString('base64url');

export function adminDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (url === undefined) throw new Error('TEST_DATABASE_URL must point to a disposable PostgreSQL');
  return url;
}

export function baseEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: adminDatabaseUrl(),
    API_KEYS: `${randomSecret()},${randomSecret()}`,
    CODE_HMAC_KEY: randomSecret(),
    HANDOFF_SECRET: randomSecret(),
    SESSION_SECRET: randomSecret(),
    PUBLIC_URL: 'http://tessera.test',
    TRUST_PROXY: 'false',
    LOG_LEVEL: 'info',
    ...overrides,
  };
}
