import { Money } from '../../common/money/money';

/**
 * The statistics behind the review rules, kept free of Prisma and Nest so the
 * thresholds can be unit tested directly - these are the numbers a finance team
 * will argue with.
 *
 * Money stays in BigInt kobo. The standard deviation is computed in floating
 * point only to decide whether to flag; no monetary value comes from a float.
 */

export interface LargeAmountVerdict {
  flagged: boolean;
  /** Why not, when the answer is no - useful in logs and tests. */
  reason: 'insufficient-history' | 'within-normal-range' | 'above-threshold';
  sampleSize: number;
  meanMinor: bigint;
  stdDevMinor: bigint;
  thresholdMinor: bigint;
  /** How many standard deviations above the mean this amount sits. */
  zScore: number | null;
}

/**
 * Flags an amount more than `sigma` standard deviations above the historical
 * mean. The minimum sample size is the important part: with five transactions of
 * history "unusual" is meaningless, so below it there is no verdict at all
 * rather than a misleading one.
 */
export function assessLargeAmount(
  amountMinor: bigint,
  historyMinor: bigint[],
  options: { sigma: number; minSampleSize: number },
): LargeAmountVerdict {
  const sampleSize = historyMinor.length;

  if (sampleSize < options.minSampleSize) {
    return {
      flagged: false,
      reason: 'insufficient-history',
      sampleSize,
      meanMinor: 0n,
      stdDevMinor: 0n,
      thresholdMinor: 0n,
      zScore: null,
    };
  }

  const mean = Money.mean(historyMinor);

  // Variance in kobo squared; through Number only to take the square root.
  const varianceFloat =
    historyMinor.reduce((acc, value) => {
      const delta = Number(value - mean);
      return acc + delta * delta;
    }, 0) / sampleSize;

  const stdDev = BigInt(Math.round(Math.sqrt(varianceFloat)));
  const threshold = mean + BigInt(Math.round(options.sigma * Number(stdDev)));
  const zScore = stdDev > 0n ? Number(amountMinor - mean) / Number(stdDev) : null;

  // A flat history would flag every amount a kobo above average.
  if (stdDev === 0n) {
    return {
      flagged: false,
      reason: 'within-normal-range',
      sampleSize,
      meanMinor: mean,
      stdDevMinor: stdDev,
      thresholdMinor: threshold,
      zScore,
    };
  }

  const flagged = amountMinor > threshold;
  return {
    flagged,
    reason: flagged ? 'above-threshold' : 'within-normal-range',
    sampleSize,
    meanMinor: mean,
    stdDevMinor: stdDev,
    thresholdMinor: threshold,
    zScore,
  };
}

/** Normalises a description for near-duplicate comparison. */
export function normaliseDescription(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(ref|txn|trx|rrn|id|no)\s*\w*/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Share of words two descriptions have in common. Jaccard is crude but
 * explainable, which matters more here than precision: a reviewer can see
 * exactly why two lines were called similar.
 */
export function descriptionSimilarity(a: string, b: string): number {
  const left = new Set(normaliseDescription(a).split(' ').filter(Boolean));
  const right = new Set(normaliseDescription(b).split(' ').filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;

  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

export const DUPLICATE_SIMILARITY_THRESHOLD = 0.6;

/** Severity scales with how far past the threshold the amount sits. */
export function severityForZScore(zScore: number | null): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (zScore === null) return 'LOW';
  if (zScore >= 6) return 'HIGH';
  if (zScore >= 4) return 'MEDIUM';
  return 'LOW';
}
