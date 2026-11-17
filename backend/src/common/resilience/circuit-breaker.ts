export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitOpenError extends Error {
  constructor(name: string, readonly retryAfterMs: number) {
    super(`Circuit "${name}" is open; calls are being rejected for ${retryAfterMs}ms`);
    this.name = 'CircuitOpenError';
  }
}

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold: number;
  resetMs: number;
  now?: () => number;
}

/**
 * Circuit breaker.
 *
 * After `failureThreshold` consecutive failures the circuit opens and calls
 * fail immediately for `resetMs`. This matters at scale: when a provider is
 * down, the worst thing a queue of hundreds of thousands of jobs can do is
 * keep calling it - each attempt costs a timeout, holds a connection and
 * delays the recovery of the provider itself. One probe call (HALF_OPEN)
 * decides whether service has returned.
 */
export class CircuitBreaker {
  private failures = 0;
  private state: CircuitState = 'CLOSED';
  private openedAt = 0;
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? Date.now;
  }

  getState(): CircuitState {
    this.refresh();
    return this.state;
  }

  /** ms until the next attempt is allowed; 0 when calls are flowing. */
  retryAfterMs(): number {
    this.refresh();
    if (this.state !== 'OPEN') return 0;
    return Math.max(0, this.options.resetMs - (this.now() - this.openedAt));
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.refresh();

    if (this.state === 'OPEN') {
      throw new CircuitOpenError(this.options.name, this.retryAfterMs());
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  onFailure(): void {
    this.failures += 1;
    if (this.failures >= this.options.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = this.now();
    }
  }

  reset(): void {
    this.failures = 0;
    this.state = 'CLOSED';
    this.openedAt = 0;
  }

  /** Moves OPEN -> HALF_OPEN once the cool-off has elapsed. */
  private refresh(): void {
    if (this.state === 'OPEN' && this.now() - this.openedAt >= this.options.resetMs) {
      this.state = 'HALF_OPEN';
      // One call is let through; its outcome closes or re-opens the circuit.
      this.failures = this.options.failureThreshold - 1;
    }
  }
}

/** Rejects if the operation has not settled within `ms`. */
export async function withTimeout<T>(
  operation: Promise<T>,
  ms: number,
  onTimeout: () => Error,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(onTimeout()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Exponential backoff with full jitter.
 *
 * Jitter is not decoration: without it, every job that failed during an
 * outage retries at the same instant and re-creates the outage. Full jitter
 * spreads the retries across the whole window.
 */
export function backoffDelayMs(attempt: number, baseMs = 1000, maxMs = 5 * 60_000): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(Math.random() * exponential);
}
