import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  CircuitBreaker,
  CircuitOpenError,
  withTimeout,
} from '../../../common/resilience/circuit-breaker';
import { AppConfig, CONFIG_TOKEN } from '../../../config/configuration';
import {
  ClassificationProvider,
  ClassificationRequest,
  ClassificationResult,
  ProviderTimeoutError,
} from './classification-provider';
import { MockLlmClassificationProvider } from './mock-llm.provider';
import { RulesClassificationProvider } from './rules.provider';

export const HYBRID_PROVIDER_NAME = 'hybrid';

/**
 * Rules first, model only when it is worth it: run the deterministic rules, stop
 * if they are confident enough, otherwise ask the model behind a timeout and a
 * circuit breaker and take its answer only if it beats the rule result. If the
 * model is unavailable, keep the rule answer and mark it provisional rather than
 * inventing an "Other".
 */
@Injectable()
export class HybridClassificationProvider implements ClassificationProvider {
  readonly name = HYBRID_PROVIDER_NAME;
  readonly version = '1.0.0';

  private readonly logger = new Logger(HybridClassificationProvider.name);
  private readonly breaker: CircuitBreaker;
  private llmCalls = 0;

  constructor(
    private readonly rules: RulesClassificationProvider,
    private readonly llm: MockLlmClassificationProvider,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {
    this.breaker = new CircuitBreaker({
      name: 'classification-llm',
      failureThreshold: config.classification.circuitBreakerFailureThreshold,
      resetMs: config.classification.circuitBreakerResetMs,
    });
  }

  /** Observability hooks used by the worker logs and the tests. */
  get llmCallCount(): number {
    return this.llmCalls;
  }

  resetMetrics(): void {
    this.llmCalls = 0;
    this.breaker.reset();
  }

  getCircuitState(): string {
    return this.breaker.getState();
  }

  async classify(request: ClassificationRequest): Promise<ClassificationResult> {
    const ruleResult = this.rules.classifySync(request);

    if (ruleResult.confidence >= this.config.classification.confidenceThreshold) {
      return ruleResult;
    }

    try {
      this.llmCalls += 1;
      const llmResult = await this.breaker.execute(() =>
        withTimeout(
          this.llm.classify(request),
          this.config.mockLlm.timeoutMs,
          () => new ProviderTimeoutError(`${this.llm.name} exceeded ${this.config.mockLlm.timeoutMs}ms`),
        ),
      );

      // The model only wins if it is actually more confident than the rule.
      if (llmResult.confidence >= ruleResult.confidence) {
        return {
          ...llmResult,
          reason: `${llmResult.reason}. Rules were inconclusive (${ruleResult.matchedRule ?? 'no rule'}, confidence ${ruleResult.confidence.toFixed(2)})`,
        };
      }

      return {
        ...ruleResult,
        reason: `${ruleResult.reason}. Model suggested ${llmResult.category} with lower confidence (${llmResult.confidence.toFixed(2)})`,
      };
    } catch (error) {
      const reason = error instanceof CircuitOpenError ? 'circuit open' : (error as Error).name;
      this.logger.warn(
        `LLM classification unavailable (${reason}); falling back to the rules result for transaction ${request.transactionId}`,
      );

      // Degraded, not broken: keep the rule answer for another attempt.
      return {
        ...ruleResult,
        degraded: true,
        degradedReason: reason,
        reason: `${ruleResult.reason}. Model unavailable (${reason}), kept the rules result pending another attempt`,
      };
    }
  }
}
