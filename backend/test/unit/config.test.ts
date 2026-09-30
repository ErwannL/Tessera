import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';
import { baseEnv, randomSecret } from '../helpers/env.js';

process.env.TEST_DATABASE_URL ??= 'postgres://unused:unused@localhost/unused';

function failure(env: Record<string, string | undefined>): string {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as Error).message;
  }
  throw new Error('expected configuration to be rejected');
}

describe('loadConfig', () => {
  it('parses a complete configuration and applies defaults', () => {
    const config = loadConfig(baseEnv());
    expect(config).toMatchObject({
      NODE_ENV: 'test',
      PORT: 3000,
      CODE_LENGTH: 6,
      DEFAULT_EXPIRES_IN_SECONDS: 600,
      MIN_EXPIRES_IN_SECONDS: 60,
      MAX_EXPIRES_IN_SECONDS: 86_400,
      DEFAULT_MAX_ATTEMPTS: 5,
      SESSION_TTL_SECONDS: 3600,
      RETENTION_DAYS: 365,
      EXPIRY_SWEEP_INTERVAL_SECONDS: 60,
      TRUST_PROXY: false,
      PUBLIC_URL: 'http://tessera.test',
    });
    expect(config.API_KEYS).toHaveLength(2);
  });

  it.each([
    ['true', true],
    ['false', false],
    ['10.0.0.0/8,127.0.0.1', ['10.0.0.0/8', '127.0.0.1']],
  ])('parses TRUST_PROXY=%s', (value, expected) => {
    expect(loadConfig(baseEnv({ TRUST_PROXY: value })).TRUST_PROXY).toEqual(expected);
  });

  it('EMBED_ORIGINS: empty by default, otherwise a list of http(s) origins', () => {
    expect(loadConfig(baseEnv()).EMBED_ORIGINS).toEqual([]);
    expect(loadConfig(baseEnv({ EMBED_ORIGINS: '  ' })).EMBED_ORIGINS).toEqual([]);
    expect(
      loadConfig(baseEnv({ EMBED_ORIGINS: 'http://localhost:3002 https://a.dev/ https://a.dev' }))
        .EMBED_ORIGINS,
    ).toEqual(['http://localhost:3002', 'https://a.dev']);
    for (const bad of ['*', 'https://*.a.dev', 'ftp://a.dev', 'https://a.dev/path', 'a.dev']) {
      expect(failure(baseEnv({ EMBED_ORIGINS: `https://ok.dev ${bad}` }))).toContain(
        'EMBED_ORIGINS',
      );
    }
  });

  it('TESSERA_ORQEA_URL: defaults to Orqea, http(s) only', () => {
    expect(loadConfig(baseEnv()).TESSERA_ORQEA_URL).toBe('https://orqea.dev');
    expect(failure(baseEnv({ TESSERA_ORQEA_URL: 'javascript:alert(1)' }))).toContain(
      'TESSERA_ORQEA_URL',
    );
  });

  it('keeps only the origin of PUBLIC_URL', () => {
    expect(loadConfig(baseEnv({ PUBLIC_URL: 'https://t.example.com/x/' })).PUBLIC_URL).toBe(
      'https://t.example.com',
    );
  });

  it.each([
    'NODE_ENV',
    'DATABASE_URL',
    'API_KEYS',
    'CODE_HMAC_KEY',
    'HANDOFF_SECRET',
    'SESSION_SECRET',
    'PUBLIC_URL',
    'TRUST_PROXY',
  ])('refuses to start without %s', (name) => {
    expect(failure(baseEnv({ [name]: undefined }))).toContain(name);
  });

  it.each([
    ['NODE_ENV', 'prod'],
    ['PORT', '70000'],
    ['PORT', 'abc'],
    ['DATABASE_URL', 'mysql://x'],
    ['PUBLIC_URL', 'ftp://x'],
    ['TRUST_PROXY', 'yes please'],
    ['CODE_LENGTH', '5'],
    ['CODE_LENGTH', '13'],
    ['DEFAULT_MAX_ATTEMPTS', '11'],
    ['SESSION_TTL_SECONDS', '10'],
    ['RETENTION_DAYS', '0'],
    ['EXPIRY_SWEEP_INTERVAL_SECONDS', '0'],
    ['LOG_LEVEL', 'loud'],
    ['RATE_LIMIT_API_MAX', '0'],
  ])('rejects invalid %s=%s', (name, value) => {
    expect(failure(baseEnv({ [name]: value }))).toContain(name);
  });

  it('rejects short secrets without printing their value', () => {
    const message = failure(baseEnv({ SESSION_SECRET: 'tiny-secret-value' }));
    expect(message).toContain('SESSION_SECRET');
    expect(message).not.toContain('tiny-secret-value');
  });

  it('rejects a short API key among several', () => {
    const message = failure(baseEnv({ API_KEYS: `${randomSecret()},short-key-value` }));
    expect(message).toContain('API_KEYS');
    expect(message).not.toContain('short-key-value');
  });

  it('rejects two equal secrets and names both, never the value', () => {
    const shared = randomSecret();
    const message = failure(baseEnv({ HANDOFF_SECRET: shared, SESSION_SECRET: shared }));
    expect(message).toContain('HANDOFF_SECRET must differ from SESSION_SECRET');
    expect(message).not.toContain(shared);
  });

  it('rejects an API key equal to a secret', () => {
    const shared = randomSecret();
    const message = failure(baseEnv({ API_KEYS: shared, CODE_HMAC_KEY: shared }));
    expect(message).toContain('CODE_HMAC_KEY must differ from API_KEYS[0]');
  });

  it('rejects placeholder secrets in staging and production only', () => {
    const placeholder = 'CHANGE_ME_this_is_not_a_real_secret_value';
    for (const env of ['staging', 'production']) {
      const message = failure(baseEnv({ NODE_ENV: env, CODE_HMAC_KEY: placeholder }));
      expect(message).toContain('CODE_HMAC_KEY still holds a placeholder value');
      expect(message).not.toContain(placeholder);
    }
    expect(
      loadConfig(baseEnv({ NODE_ENV: 'development', CODE_HMAC_KEY: placeholder })).NODE_ENV,
    ).toBe('development');
  });

  it('requires DEFAULT_EXPIRES_IN_SECONDS within the configured bounds', () => {
    expect(failure(baseEnv({ DEFAULT_EXPIRES_IN_SECONDS: '30' }))).toContain(
      'DEFAULT_EXPIRES_IN_SECONDS must lie between',
    );
    expect(failure(baseEnv({ MAX_EXPIRES_IN_SECONDS: '300' }))).toContain(
      'DEFAULT_EXPIRES_IN_SECONDS must lie between',
    );
  });
});
