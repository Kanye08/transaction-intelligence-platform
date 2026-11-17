import {
  assertTransition,
  canTransition,
  InvalidStateTransitionError,
  isAutomationAllowed,
  statusForAutomatedResult,
} from './classification-state';

describe('Classification state machine', () => {
  it('lets automation move a pending transaction to any automated state', () => {
    expect(canTransition('PENDING', 'CLASSIFIED', 'RULES')).toBe(true);
    expect(canTransition('PENDING', 'PROVISIONAL', 'LLM')).toBe(true);
    expect(canTransition('FAILED_RETRYING', 'CLASSIFIED', 'LLM')).toBe(true);
    expect(canTransition('CLASSIFIED', 'PROVISIONAL', 'RULES')).toBe(true);
  });

  it('never lets automation touch a manually classified transaction', () => {
    for (const source of ['RULES', 'LLM'] as const) {
      expect(canTransition('MANUAL', 'CLASSIFIED', source)).toBe(false);
      expect(canTransition('MANUAL', 'PROVISIONAL', source)).toBe(false);
      expect(canTransition('MANUAL', 'PENDING', source)).toBe(false);
    }
    expect(isAutomationAllowed('MANUAL')).toBe(false);
    expect(isAutomationAllowed('PROVISIONAL')).toBe(true);
  });

  it('never lets automation claim a manual decision', () => {
    expect(canTransition('PROVISIONAL', 'MANUAL', 'LLM')).toBe(false);
    expect(canTransition('PROVISIONAL', 'MANUAL', 'MANUAL')).toBe(true);
  });

  it('lets a person re-correct their own correction', () => {
    expect(canTransition('MANUAL', 'MANUAL', 'MANUAL')).toBe(true);
  });

  it('throws with a readable message on an illegal transition', () => {
    expect(() => assertTransition('MANUAL', 'CLASSIFIED', 'LLM')).toThrow(InvalidStateTransitionError);
    expect(() => assertTransition('MANUAL', 'CLASSIFIED', 'LLM')).toThrow(
      'Cannot move classification from MANUAL to CLASSIFIED via LLM',
    );
  });

  describe('status for an automated result', () => {
    const threshold = 0.75;

    it('is CLASSIFIED at or above the confidence threshold', () => {
      expect(statusForAutomatedResult({ confidence: 0.75, threshold, attemptsRemaining: true })).toBe('CLASSIFIED');
      expect(statusForAutomatedResult({ confidence: 0.99, threshold, attemptsRemaining: true })).toBe('CLASSIFIED');
    });

    it('is PROVISIONAL below it, so the answer stays reviewable', () => {
      expect(statusForAutomatedResult({ confidence: 0.74, threshold, attemptsRemaining: true })).toBe('PROVISIONAL');
    });

    it('keeps a degraded answer retryable while attempts remain', () => {
      expect(
        statusForAutomatedResult({ confidence: 0.9, threshold, degraded: true, attemptsRemaining: true }),
      ).toBe('FAILED_RETRYING');
    });

    it('settles a degraded answer as provisional once retries run out', () => {
      expect(
        statusForAutomatedResult({ confidence: 0.9, threshold, degraded: true, attemptsRemaining: false }),
      ).toBe('PROVISIONAL');
    });
  });
});
