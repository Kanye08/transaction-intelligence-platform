import { ClassificationRequest, parseProviderResult, InvalidProviderResponseError } from './classification-provider';
import { RulesClassificationProvider } from './rules.provider';

describe('RulesClassificationProvider', () => {
  const provider = new RulesClassificationProvider();

  const request = (overrides: Partial<ClassificationRequest> = {}): ClassificationRequest => ({
    transactionId: 'txn-1',
    description: 'Payment',
    merchant: null,
    direction: 'OUTFLOW',
    amountMinor: 100_000n,
    currency: 'NGN',
    transactionDate: new Date('2026-03-01T10:00:00.000Z'),
    ...overrides,
  });

  it.each([
    ['Salary payment for March 2026', 'OUTFLOW', 'PAYROLL'],
    ['FIRS PAYE remittance Q1', 'OUTFLOW', 'TAX'],
    ['IKEDC prepaid token purchase', 'OUTFLOW', 'UTILITIES'],
    ['DSTV Compact subscription', 'OUTFLOW', 'UTILITIES'],
    ['MTN VTU airtime', 'OUTFLOW', 'UTILITIES'],
    ['AWS cloud services invoice', 'OUTFLOW', 'SOFTWARE'],
    ['Google Ads campaign spend', 'OUTFLOW', 'MARKETING'],
    ['Air Peace flight ticket Lagos-Abuja', 'OUTFLOW', 'TRAVEL'],
    ['Office rent for Q2 2026', 'OUTFLOW', 'RENT'],
    ['SMS alert charge', 'OUTFLOW', 'BANKING_FEES'],
    ['Stamp duty on transfer', 'OUTFLOW', 'BANKING_FEES'],
    ['Paystack settlement for 12 Mar', 'INFLOW', 'REVENUE'],
    ['Invoice payment from Dangote Ltd', 'INFLOW', 'REVENUE'],
  ])('classifies "%s" (%s) as %s', (description, direction, expected) => {
    const result = provider.classifySync(
      request({ description, direction: direction as 'INFLOW' | 'OUTFLOW' }),
    );
    expect(result.category).toBe(expected);
    expect(result.source).toBe('RULES');
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.reason).toContain('matched');
  });

  it('uses the merchant when the description is uninformative', () => {
    const result = provider.classifySync(request({ description: 'Card payment', merchant: 'Adobe' }));
    expect(result.category).toBe('SOFTWARE');
  });

  it('respects direction where it changes the meaning', () => {
    // "Salary" only makes sense as money going out.
    const outflow = provider.classifySync(request({ description: 'Salary payment', direction: 'OUTFLOW' }));
    expect(outflow.category).toBe('PAYROLL');

    const inflow = provider.classifySync(request({ description: 'Salary payment', direction: 'INFLOW' }));
    expect(inflow.category).not.toBe('PAYROLL');
  });

  it('is deterministic: the same input always gives the same answer', () => {
    const input = request({ description: 'GOtv Max subscription' });
    const first = provider.classifySync(input);
    const second = provider.classifySync(input);
    expect(second).toEqual(first);
  });

  it('returns a low-confidence answer for genuinely ambiguous merchants', () => {
    const result = provider.classifySync(request({ description: 'Jumia order payment' }));
    expect(result.confidence).toBeLessThan(0.6);
    expect(result.matchedRule).toBe('ambiguous-marketplace');
  });

  it('admits when nothing matched instead of guessing confidently', () => {
    const result = provider.classifySync(
      request({ description: 'Zxcvbnm qwerty payment', merchant: 'Unknown Ltd' }),
    );
    expect(result.category).toBe('OTHER');
    expect(result.confidence).toBeLessThanOrEqual(0.2);
    expect(result.matchedRule).toBe('no-match');
    expect(result.reason).toContain('No deterministic rule matched');
  });
});

describe('parseProviderResult', () => {
  it('accepts a well-formed result', () => {
    const result = parseProviderResult(
      { category: 'SOFTWARE', confidence: 0.9, reason: 'Known vendor' },
      'mock-llm',
      '1.0',
      'LLM',
    );
    expect(result).toMatchObject({ category: 'SOFTWARE', confidence: 0.9, source: 'LLM' });
  });

  it.each([
    [{ category: 'CRYPTO_SPECULATION', confidence: 0.9 }, 'an invented category'],
    [{ category: 'SOFTWARE', confidence: 'very high' }, 'a non-numeric confidence'],
    [{ category: 'SOFTWARE', confidence: 1.4 }, 'an out-of-range confidence'],
    [{ category: 'SOFTWARE', confidence: -0.1 }, 'a negative confidence'],
    [{ confidence: 0.5 }, 'a missing category'],
    ['Looks like software to me', 'prose instead of JSON'],
    [null, 'a null response'],
  ])('rejects %j (%s)', (payload) => {
    expect(() => parseProviderResult(payload, 'mock-llm', '1.0', 'LLM')).toThrow(
      InvalidProviderResponseError,
    );
  });

  it('supplies a reason when the provider omits one', () => {
    const result = parseProviderResult({ category: 'OTHER', confidence: 0.5 }, 'mock-llm', '1.0', 'LLM');
    expect(result.reason).toBe('Classified as OTHER by mock-llm');
  });

  it('truncates an overly long reason rather than storing unbounded text', () => {
    const result = parseProviderResult(
      { category: 'OTHER', confidence: 0.5, reason: 'x'.repeat(2000) },
      'mock-llm',
      '1.0',
      'LLM',
    );
    expect(result.reason).toHaveLength(500);
  });
});
