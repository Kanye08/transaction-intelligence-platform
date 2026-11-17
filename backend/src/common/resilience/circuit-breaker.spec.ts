import { backoffDelayMs, CircuitBreaker, CircuitOpenError, withTimeout } from './circuit-breaker';

describe('CircuitBreaker', () => {
  let now = 0;
  const breaker = () =>
    new CircuitBreaker({ name: 'test', failureThreshold: 3, resetMs: 1000, now: () => now });

  beforeEach(() => {
    now = 0;
  });

  const fail = () => Promise.reject(new Error('provider down'));

  it('stays closed while calls succeed', async () => {
    const circuit = breaker();
    await expect(circuit.execute(() => Promise.resolve('ok'))).resolves.toBe('ok');
    expect(circuit.getState()).toBe('CLOSED');
  });

  it('opens after the failure threshold and then fails fast', async () => {
    const circuit = breaker();

    for (let i = 0; i < 3; i += 1) {
      await expect(circuit.execute(fail)).rejects.toThrow('provider down');
    }
    expect(circuit.getState()).toBe('OPEN');

    // No call reaches the provider now: that is the point.
    const operation = jest.fn();
    await expect(circuit.execute(operation)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(operation).not.toHaveBeenCalled();
    expect(circuit.retryAfterMs()).toBe(1000);
  });

  it('probes once after the cool-off and closes on success', async () => {
    const circuit = breaker();
    for (let i = 0; i < 3; i += 1) {
      await circuit.execute(fail).catch(() => undefined);
    }

    now = 1000;
    expect(circuit.getState()).toBe('HALF_OPEN');

    await expect(circuit.execute(() => Promise.resolve('recovered'))).resolves.toBe('recovered');
    expect(circuit.getState()).toBe('CLOSED');
  });

  it('re-opens if the probe also fails', async () => {
    const circuit = breaker();
    for (let i = 0; i < 3; i += 1) {
      await circuit.execute(fail).catch(() => undefined);
    }

    now = 1000;
    await circuit.execute(fail).catch(() => undefined);
    expect(circuit.getState()).toBe('OPEN');
  });

  it('resets the failure count after a success', async () => {
    const circuit = breaker();
    await circuit.execute(fail).catch(() => undefined);
    await circuit.execute(fail).catch(() => undefined);
    await circuit.execute(() => Promise.resolve('ok'));
    await circuit.execute(fail).catch(() => undefined);

    expect(circuit.getState()).toBe('CLOSED');
  });
});

describe('withTimeout', () => {
  it('resolves when the operation finishes in time', async () => {
    await expect(withTimeout(Promise.resolve(1), 50, () => new Error('late'))).resolves.toBe(1);
  });

  it('rejects with the supplied error when it does not', async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 200));
    await expect(withTimeout(slow, 20, () => new Error('provider timed out'))).rejects.toThrow(
      'provider timed out',
    );
  });
});

describe('backoffDelayMs', () => {
  it('grows exponentially and stays within the jittered bound', () => {
    for (const attempt of [1, 2, 3, 4, 5]) {
      const ceiling = 1000 * 2 ** (attempt - 1);
      for (let i = 0; i < 50; i += 1) {
        const delay = backoffDelayMs(attempt);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThan(ceiling);
      }
    }
  });

  it('never exceeds the maximum', () => {
    expect(backoffDelayMs(30, 1000, 60_000)).toBeLessThan(60_000);
  });

  it('spreads retries instead of synchronising them', () => {
    const delays = new Set(Array.from({ length: 50 }, () => backoffDelayMs(5)));
    expect(delays.size).toBeGreaterThan(5);
  });
});
