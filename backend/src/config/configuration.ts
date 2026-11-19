/**
 * Everything tunable, parsed once at boot and validated eagerly so a
 * misconfigured deployment fails fast instead of behaving strangely later.
 */

export type ClassificationProviderName = 'rules' | 'mock-llm' | 'hybrid';

export type MockLlmMode =
  | 'normal'
  | 'latency'
  | 'failure'
  | 'timeout'
  | 'rate_limited'
  | 'invalid'
  | 'low_confidence';

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  logLevel: string;

  auth: {
    jwtSecret: string;
    jwtExpiresIn: string;
    bcryptRounds: number;
    loginRateLimit: number;
    loginRateTtlMs: number;
  };

  classification: {
    provider: ClassificationProviderName;
    /** Rule confidence at or above which the LLM is not consulted at all. */
    confidenceThreshold: number;
    /** Confidence below which a transaction is flagged for human review. */
    lowConfidenceReviewThreshold: number;
    maxAttempts: number;
    retryBaseMs: number;
    retryMaxMs: number;
    circuitBreakerFailureThreshold: number;
    circuitBreakerResetMs: number;
  };

  mockLlm: {
    mode: MockLlmMode;
    latencyMs: number;
    timeoutMs: number;
    failureRate: number;
  };

  worker: {
    enabled: boolean;
    pollIntervalMs: number;
    batchSize: number;
  };

  anomaly: {
    largeAmountSigma: number;
    minSampleSize: number;
    duplicateWindowHours: number;
    frequencyWindowHours: number;
    frequencyThreshold: number;
  };
}

class ConfigError extends Error {}

function str(key: string, fallback?: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    throw new ConfigError(`Missing required environment variable: ${key}`);
  }
  return value;
}

function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new ConfigError(`Environment variable ${key} must be a number, received "${raw}"`);
  }
  return parsed;
}

function int(key: string, fallback: number): number {
  const parsed = num(key, fallback);
  if (!Number.isInteger(parsed)) {
    throw new ConfigError(`Environment variable ${key} must be an integer, received "${parsed}"`);
  }
  return parsed;
}

function bool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function oneOf<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const raw = (process.env[key] ?? fallback) as T;
  if (!allowed.includes(raw)) {
    throw new ConfigError(
      `Environment variable ${key} must be one of ${allowed.join(', ')} - received "${raw}"`,
    );
  }
  return raw;
}

function ratio(key: string, fallback: number): number {
  const value = num(key, fallback);
  if (value < 0 || value > 1) {
    throw new ConfigError(`Environment variable ${key} must be between 0 and 1, received ${value}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  const nodeEnv = oneOf('NODE_ENV', ['development', 'production', 'test'] as const, 'development');
  const jwtSecret = str('JWT_SECRET', nodeEnv === 'production' ? undefined : 'dev-only-secret');

  const placeholderSecret = /^(dev-only|replace-me|changeme)/i.test(jwtSecret) || jwtSecret.length < 32;
  if (nodeEnv === 'production' && placeholderSecret) {
    throw new ConfigError(
      'JWT_SECRET must be a generated secret of at least 32 characters in production. ' +
        'Run `node scripts/ensure-env.mjs` after deleting .env, or set JWT_SECRET explicitly.',
    );
  }

  return Object.freeze({
    nodeEnv,
    port: int('PORT', 3000),
    logLevel: str('LOG_LEVEL', nodeEnv === 'test' ? 'silent' : 'info'),

    auth: {
      jwtSecret,
      jwtExpiresIn: str('JWT_EXPIRES_IN', '12h'),
      bcryptRounds: int('BCRYPT_ROUNDS', nodeEnv === 'test' ? 4 : 10),
      loginRateLimit: int('LOGIN_RATE_LIMIT', 10),
      loginRateTtlMs: int('LOGIN_RATE_TTL_MS', 60_000),
    },

    classification: {
      provider: oneOf('CLASSIFICATION_PROVIDER', ['rules', 'mock-llm', 'hybrid'] as const, 'hybrid'),
      confidenceThreshold: ratio('CLASSIFICATION_CONFIDENCE_THRESHOLD', 0.75),
      lowConfidenceReviewThreshold: ratio('LOW_CONFIDENCE_REVIEW_THRESHOLD', 0.6),
      // 10 attempts on a 2-minute base, capped at 30 minutes, spans roughly
      // six hours of provider downtime before a transaction settles.
      maxAttempts: int('CLASSIFICATION_MAX_ATTEMPTS', 10),
      retryBaseMs: int('CLASSIFICATION_RETRY_BASE_MS', 120_000),
      retryMaxMs: int('CLASSIFICATION_RETRY_MAX_MS', 1_800_000),
      circuitBreakerFailureThreshold: int('CIRCUIT_BREAKER_FAILURE_THRESHOLD', 5),
      circuitBreakerResetMs: int('CIRCUIT_BREAKER_RESET_MS', 30_000),
    },

    mockLlm: {
      mode: oneOf(
        'MOCK_LLM_MODE',
        ['normal', 'latency', 'failure', 'timeout', 'rate_limited', 'invalid', 'low_confidence'] as const,
        'normal',
      ),
      latencyMs: int('MOCK_LLM_LATENCY_MS', 120),
      timeoutMs: int('MOCK_LLM_TIMEOUT_MS', 3000),
      failureRate: ratio('MOCK_LLM_FAILURE_RATE', 0),
    },

    worker: {
      enabled: bool('WORKER_ENABLED', nodeEnv !== 'test'),
      pollIntervalMs: int('WORKER_POLL_INTERVAL_MS', 1000),
      batchSize: int('WORKER_BATCH_SIZE', 25),
    },

    anomaly: {
      largeAmountSigma: num('ANOMALY_LARGE_AMOUNT_SIGMA', 3),
      minSampleSize: int('ANOMALY_MIN_SAMPLE_SIZE', 20),
      duplicateWindowHours: num('ANOMALY_DUPLICATE_WINDOW_HOURS', 24),
      frequencyWindowHours: num('ANOMALY_FREQUENCY_WINDOW_HOURS', 24),
      frequencyThreshold: int('ANOMALY_FREQUENCY_THRESHOLD', 5),
    },
  });
}

export const CONFIG_TOKEN = 'APP_CONFIG';
