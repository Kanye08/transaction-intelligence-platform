import { Inject, Injectable, Logger } from '@nestjs/common';

import { Category } from '../../../common/domain/constants';
import { AppConfig, CONFIG_TOKEN, MockLlmMode } from '../../../config/configuration';
import {
  ClassificationProvider,
  ClassificationRequest,
  ClassificationResult,
  parseProviderResult,
  ProviderRateLimitedError,
  ProviderUnavailableError,
} from './classification-provider';

export const MOCK_LLM_PROVIDER_NAME = 'mock-llm';
export const MOCK_LLM_PROVIDER_VERSION = 'mock-gpt-1.0';

/** Weak signals an LLM would pick up on that the rule table does not encode. */
const SEMANTIC_HINTS: { pattern: RegExp; category: Category; confidence: number; reason: string }[] = [
  {
    pattern: /(laptop|macbook|monitor|office chair|printer|equipment|furniture)/i,
    category: 'EQUIPMENT',
    confidence: 0.82,
    reason: 'Reads as an equipment or office purchase rather than a recurring expense',
  },
  {
    pattern: /(consultant|retainer|legal fee|audit fee|accounting service|professional service)/i,
    category: 'PROFESSIONAL_SERVICES',
    confidence: 0.81,
    reason: 'Appears to be a professional services engagement',
  },
  {
    pattern: /(sponsorship|conference|exhibition|trade fair|promo|giveaway)/i,
    category: 'MARKETING',
    confidence: 0.79,
    reason: 'Language suggests brand promotion spend',
  },
  {
    pattern: /(fuel|petrol|diesel|generator|maintenance|repair|cleaning)/i,
    category: 'UTILITIES',
    confidence: 0.76,
    reason: 'Facilities and running-cost vocabulary',
  },
  {
    pattern: /(refund|reversal|chargeback)/i,
    category: 'REVENUE',
    confidence: 0.64,
    reason: 'Looks like a reversal against revenue',
  },
  {
    pattern: /(logistics|delivery|courier|haulage|dispatch|freight)/i,
    category: 'OTHER',
    confidence: 0.7,
    reason: 'Distribution or logistics cost',
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    // unref: a simulated slow provider must not keep the process alive.
    setTimeout(resolve, ms).unref();
  });
}

/**
 * A stand-in for a real LLM.
 *
 * It is deliberately *useful* rather than a stub: it produces plausible,
 * deterministic classifications from the transaction text, and it can be told
 * to misbehave in every way a real provider does - slowly, not at all,
 * rate-limited, or with output that is confident nonsense. The failure
 * handling in this codebase is therefore exercised by real code paths rather
 * than described in a README.
 *
 * Set MOCK_LLM_MODE, or call setMode() from a test.
 */
@Injectable()
export class MockLlmClassificationProvider implements ClassificationProvider {
  readonly name = MOCK_LLM_PROVIDER_NAME;
  readonly version = MOCK_LLM_PROVIDER_VERSION;

  private readonly logger = new Logger(MockLlmClassificationProvider.name);
  private mode: MockLlmMode;
  private calls = 0;

  constructor(@Inject(CONFIG_TOKEN) private readonly config: AppConfig) {
    this.mode = config.mockLlm.mode;
  }

  /** Test and demo hook: switch behaviour at runtime. */
  setMode(mode: MockLlmMode): void {
    this.mode = mode;
  }

  getMode(): MockLlmMode {
    return this.mode;
  }

  get callCount(): number {
    return this.calls;
  }

  resetCallCount(): void {
    this.calls = 0;
  }

  async classify(request: ClassificationRequest): Promise<ClassificationResult> {
    this.calls += 1;

    switch (this.mode) {
      case 'failure':
        throw new ProviderUnavailableError('Mock provider is configured to fail');

      case 'rate_limited':
        throw new ProviderRateLimitedError('Mock provider returned 429', 2000);

      case 'timeout':
        // Sleeps past the caller timeout; the caller is what gives up.
        await sleep(this.config.mockLlm.timeoutMs * 3);
        break;

      case 'latency':
        await sleep(this.config.mockLlm.latencyMs);
        break;

      case 'invalid':
        // Exactly the kind of output that must never reach the database.
        return parseProviderResult(
          { category: 'CRYPTO_SPECULATION', confidence: 'very high', reason: 'trust me' },
          this.name,
          this.version,
          'LLM',
        );

      default:
        await sleep(Math.min(this.config.mockLlm.latencyMs, 25));
        break;
    }

    // A configurable share of calls fails even in normal mode, which is what
    // a real provider does under load.
    if (this.config.mockLlm.failureRate > 0 && Math.random() < this.config.mockLlm.failureRate) {
      throw new ProviderUnavailableError('Mock provider random failure');
    }

    const raw = this.infer(request);
    // The mock validates its own output through the same gate a real provider
    // would go through - no shortcuts for being in-process.
    return parseProviderResult(raw, this.name, this.version, 'LLM');
  }

  private infer(request: ClassificationRequest): Record<string, unknown> {
    const text = `${request.description} ${request.merchant ?? ''}`;

    if (this.mode === 'low_confidence') {
      return {
        category: 'OTHER',
        confidence: 0.33,
        reason: 'Model was unable to identify the counterparty with confidence',
      };
    }

    for (const hint of SEMANTIC_HINTS) {
      if (hint.pattern.test(text)) {
        return {
          category: hint.category,
          confidence: hint.confidence,
          reason: `${hint.reason} (model inference)`,
        };
      }
    }

    // Fall back on direction, the way a model with no strong signal would:
    // money in is probably revenue, money out is unclear.
    if (request.direction === 'INFLOW') {
      return {
        category: 'REVENUE',
        confidence: 0.61,
        reason: 'Incoming payment with no clear counterparty; most likely revenue',
      };
    }

    return {
      category: 'OTHER',
      confidence: 0.38,
      reason: 'Outgoing payment with insufficient signal to categorise confidently',
    };
  }
}
