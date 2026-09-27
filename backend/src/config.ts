import { z } from 'zod';

const SECRET_MIN_LENGTH = 32;
const PLACEHOLDER_MARKER = 'change_me';

const int = (def: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(def);

const secret = z.string().min(SECRET_MIN_LENGTH);

/** `false`, `true`, or a comma-separated list of trusted proxy addresses / CIDR ranges. */
const trustProxy = z
  .string()
  .regex(/^(true|false|[0-9a-fA-F:./]+(,[0-9a-fA-F:./]+)*)$/)
  .transform((value): boolean | string[] => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value.split(',');
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
  PORT: int(3000, 0, 65535),
  HOST: z.string().min(1).default('0.0.0.0'),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
  API_KEYS: z
    .string()
    .transform((value) => value.split(',').map((key) => key.trim()))
    .pipe(z.array(secret).min(1)),
  CODE_HMAC_KEY: secret,
  HANDOFF_SECRET: secret,
  SESSION_SECRET: secret,
  PUBLIC_URL: z.url({ protocol: /^https?$/ }).transform((value) => new URL(value).origin),
  TRUST_PROXY: trustProxy,
  CODE_LENGTH: int(6, 6, 12),
  DEFAULT_EXPIRES_IN_SECONDS: int(600, 1, 2_592_000),
  MIN_EXPIRES_IN_SECONDS: int(60, 1, 2_592_000),
  MAX_EXPIRES_IN_SECONDS: int(86_400, 1, 2_592_000),
  DEFAULT_MAX_ATTEMPTS: int(5, 1, 10),
  SESSION_TTL_SECONDS: int(3600, 60, 86_400),
  RETENTION_DAYS: int(365, 1, 3650),
  EXPIRY_SWEEP_INTERVAL_SECONDS: int(60, 1, 3600),
  RATE_LIMIT_WINDOW_SECONDS: int(60, 1, 3600),
  RATE_LIMIT_API_MAX: int(600, 1, 100_000),
  RATE_LIMIT_VERIFY_IP_MAX: int(30, 1, 10_000),
  RATE_LIMIT_VERIFY_REQUEST_MAX: int(10, 1, 10_000),
  RATE_LIMIT_HANDOFF_IP_MAX: int(10, 1, 10_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

const SECRET_NAMES = ['CODE_HMAC_KEY', 'HANDOFF_SECRET', 'SESSION_SECRET'] as const;

function namedSecrets(config: Config): [string, string][] {
  return [
    ...SECRET_NAMES.map((name): [string, string] => [name, config[name]]),
    ...config.API_KEYS.map((key, index): [string, string] => [`API_KEYS[${String(index)}]`, key]),
  ];
}

function crossChecks(config: Config): string[] {
  const problems: string[] = [];
  const secrets = namedSecrets(config);
  secrets.forEach(([name, value], index) => {
    for (const [otherName, otherValue] of secrets.slice(index + 1)) {
      if (value === otherValue) problems.push(`${name} must differ from ${otherName}`);
    }
    const deployed = config.NODE_ENV === 'staging' || config.NODE_ENV === 'production';
    if (deployed && value.toLowerCase().includes(PLACEHOLDER_MARKER)) {
      problems.push(`${name} still holds a placeholder value`);
    }
  });
  const { MIN_EXPIRES_IN_SECONDS: min, MAX_EXPIRES_IN_SECONDS: max } = config;
  const def = config.DEFAULT_EXPIRES_IN_SECONDS;
  if (!(min <= def && def <= max)) {
    problems.push(
      'DEFAULT_EXPIRES_IN_SECONDS must lie between MIN_EXPIRES_IN_SECONDS and MAX_EXPIRES_IN_SECONDS',
    );
  }
  return problems;
}

/** Reads and validates the whole configuration. Error messages name variables, never values. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.map(String).join('.')} is missing or invalid (${issue.code})`,
    );
    throw new ConfigError(`Invalid configuration: ${problems.join('; ')}`);
  }
  const problems = crossChecks(parsed.data);
  if (problems.length > 0) {
    throw new ConfigError(`Invalid configuration: ${problems.join('; ')}`);
  }
  return parsed.data;
}
