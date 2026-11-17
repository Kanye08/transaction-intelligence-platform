import {
  Category,
  CATEGORIES,
  ClassificationSource,
  isCategory,
  TransactionDirection,
} from '../../../common/domain/constants';

/** What a provider is told about a transaction. */
export interface ClassificationRequest {
  transactionId: string;
  description: string;
  merchant: string | null;
  direction: TransactionDirection;
  amountMinor: bigint;
  currency: string;
  transactionDate: Date;
}

/** What a provider must return. */
export interface ClassificationResult {
  category: Category;
  /** 0..1. Drives both the review threshold and whether the LLM is consulted. */
  confidence: number;
  source: ClassificationSource;
  provider: string;
  providerVersion: string;
  /** Plain-language justification, surfaced in the audit trail and the UI. */
  reason: string;
  matchedRule?: string;
  /**
   * True when the answer is a degraded fallback: the model was needed but
   * unavailable, so a weaker result is being returned. The caller decides
   * whether to retry later - the data is usable in the meantime.
   */
  degraded?: boolean;
  degradedReason?: string;
}

/**
 * The seam that makes the classifier replaceable.
 *
 * Ingestion, the worker, the audit trail and the API know only this interface.
 * Swapping the mock LLM for a real one, or adding a fine-tuned model, is a new
 * implementation and a configuration change - no changes to business logic.
 */
export interface ClassificationProvider {
  readonly name: string;
  readonly version: string;
  classify(request: ClassificationRequest): Promise<ClassificationResult>;
}

export class ProviderUnavailableError extends Error {
  constructor(message = 'Classification provider is unavailable') {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

export class ProviderTimeoutError extends Error {
  constructor(message = 'Classification provider timed out') {
    super(message);
    this.name = 'ProviderTimeoutError';
  }
}

export class ProviderRateLimitedError extends Error {
  constructor(
    message = 'Classification provider rate limited the request',
    readonly retryAfterMs = 1000,
  ) {
    super(message);
    this.name = 'ProviderRateLimitedError';
  }
}

export class InvalidProviderResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidProviderResponseError';
  }
}

/**
 * Strict validation of whatever a provider returns.
 *
 * An LLM can and will produce a category that does not exist, a confidence of
 * "high", or prose instead of JSON. Nothing reaches the database before it has
 * passed through here, so a hallucinated category becomes a handled provider
 * failure rather than corrupt financial data.
 */
export function parseProviderResult(
  raw: unknown,
  provider: string,
  version: string,
  source: ClassificationSource,
): ClassificationResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidProviderResponseError(`${provider} returned a non-object response`);
  }

  const payload = raw as Record<string, unknown>;
  const category = payload['category'];
  const confidence = payload['confidence'];
  const reason = payload['reason'];

  if (!isCategory(category)) {
    throw new InvalidProviderResponseError(
      `${provider} returned unknown category "${String(category)}". ` +
        `Allowed: ${CATEGORIES.join(', ')}`,
    );
  }

  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new InvalidProviderResponseError(
      `${provider} returned an out-of-range confidence: ${String(confidence)}`,
    );
  }

  return {
    category,
    confidence,
    source,
    provider,
    providerVersion: version,
    reason:
      typeof reason === 'string' && reason.trim().length > 0
        ? reason.trim().slice(0, 500)
        : `Classified as ${category} by ${provider}`,
    matchedRule: typeof payload['matchedRule'] === 'string' ? payload['matchedRule'] : undefined,
  };
}

export const CLASSIFICATION_PROVIDER = Symbol('CLASSIFICATION_PROVIDER');
