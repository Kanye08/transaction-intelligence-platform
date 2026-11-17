import { Money } from '../../common/money/money';
import {
  assessLargeAmount,
  descriptionSimilarity,
  normaliseDescription,
  severityForZScore,
} from './anomaly-statistics';

describe('assessLargeAmount', () => {
  const options = { sigma: 3, minSampleSize: 20 };

  /** 30 payments clustered around NGN 50,000. */
  const typicalHistory = Array.from({ length: 30 }, (_, index) =>
    Money.parse(`${50_000 + index * 100}.00`),
  );

  it('refuses to judge without enough history', () => {
    const verdict = assessLargeAmount(Money.parse('5000000.00'), typicalHistory.slice(0, 5), options);

    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toBe('insufficient-history');
    expect(verdict.zScore).toBeNull();
  });

  it('flags an amount far above the historical mean', () => {
    const verdict = assessLargeAmount(Money.parse('5000000.00'), typicalHistory, options);

    expect(verdict.flagged).toBe(true);
    expect(verdict.reason).toBe('above-threshold');
    expect(verdict.sampleSize).toBe(30);
    expect(verdict.zScore).toBeGreaterThan(3);
    // The mean is reported in exact kobo, not a float.
    expect(typeof verdict.meanMinor).toBe('bigint');
  });

  it('leaves an ordinary amount alone', () => {
    const verdict = assessLargeAmount(Money.parse('51000.00'), typicalHistory, options);
    expect(verdict.flagged).toBe(false);
    expect(verdict.reason).toBe('within-normal-range');
  });

  it('does not flag on a perfectly flat history, where nothing is unusual yet', () => {
    const flat = Array.from({ length: 25 }, () => Money.parse('10000.00'));
    const verdict = assessLargeAmount(Money.parse('10000.01'), flat, options);

    expect(verdict.stdDevMinor).toBe(0n);
    expect(verdict.flagged).toBe(false);
  });

  it('respects a stricter sigma', () => {
    const spread = Array.from({ length: 25 }, (_, i) => Money.parse(`${10_000 + i * 1_000}.00`));
    const amount = Money.parse('45000.00');

    expect(assessLargeAmount(amount, spread, { sigma: 1, minSampleSize: 20 }).flagged).toBe(true);
    expect(assessLargeAmount(amount, spread, { sigma: 6, minSampleSize: 20 }).flagged).toBe(false);
  });

  it('handles very large values without precision loss', () => {
    const history = Array.from({ length: 25 }, () => Money.parse('92233720368.55'));
    const verdict = assessLargeAmount(Money.parse('92233720368.55'), history, options);
    expect(verdict.meanMinor).toBe(Money.parse('92233720368.55'));
  });
});

describe('description similarity', () => {
  it('strips references, numbers and punctuation', () => {
    expect(normaliseDescription('NIP Transfer REF/123456 to GTBank')).toBe('nip transfer to gtbank');
  });

  it('treats the same payment under two references as similar', () => {
    const similarity = descriptionSimilarity(
      'Payment to Dangote Cement REF 88213',
      'Payment to Dangote Cement REF 99120',
    );
    expect(similarity).toBeGreaterThanOrEqual(0.6);
  });

  it('keeps unrelated descriptions apart', () => {
    expect(descriptionSimilarity('Salary payment March', 'DSTV subscription')).toBeLessThan(0.3);
  });

  it('returns zero when there is nothing to compare', () => {
    expect(descriptionSimilarity('', 'Salary')).toBe(0);
    expect(descriptionSimilarity('12345', '67890')).toBe(0);
  });
});

describe('severityForZScore', () => {
  it('scales with how far beyond normal the amount sits', () => {
    expect(severityForZScore(null)).toBe('LOW');
    expect(severityForZScore(3.2)).toBe('LOW');
    expect(severityForZScore(4.5)).toBe('MEDIUM');
    expect(severityForZScore(12)).toBe('HIGH');
  });
});
