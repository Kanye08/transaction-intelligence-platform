import { Inject, Injectable, Logger } from '@nestjs/common';

import { ReviewRule, ReviewSeverity } from '../../common/domain/constants';
import { Money } from '../../common/money/money';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ScopedPrisma, TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { AppConfig, CONFIG_TOKEN } from '../../config/configuration';
import {
  assessLargeAmount,
  descriptionSimilarity,
  DUPLICATE_SIMILARITY_THRESHOLD,
  severityForZScore,
} from './anomaly-statistics';

export interface Detection {
  rule: ReviewRule;
  severity: ReviewSeverity;
  explanation: string;
  details: Record<string, unknown>;
}

interface TransactionRow {
  id: string;
  accountId: string;
  amountMinor: bigint;
  currency: string;
  direction: string;
  description: string;
  merchant: string | null;
  transactionDate: Date;
  externalReference: string;
  category: string | null;
  confidence: number | null;
  classificationStatus: string;
}

/** History window used for the statistical rules. Bounded on purpose. */
const HISTORY_LIMIT = 120;

/**
 * Four independent detectors. Each is a separate method with no shared state, so
 * each can be tested and tuned alone, and a noisy one can be dropped without
 * touching the others. Every flag carries an explanation and the numbers behind
 * it: a flag a reviewer cannot understand is worse than no flag.
 */
@Injectable()
export class ReviewDetectionService {
  private readonly logger = new Logger(ReviewDetectionService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  /** Runs every rule for one transaction and persists any new flags. */
  async runForTransaction(organisationId: string, transactionId: string): Promise<Detection[]> {
    const db = this.tenantPrisma.forOrganisation(organisationId);
    const transaction = await db.transaction.findFirst({ where: { id: transactionId } });
    if (!transaction) return [];

    const detections = await this.detect(db, transaction);

    for (const detection of detections) {
      await this.persistFlag(db, organisationId, transactionId, detection);
    }

    return detections;
  }

  async detect(db: ScopedPrisma, transaction: TransactionRow): Promise<Detection[]> {
    const results = await Promise.all([
      this.detectPossibleDuplicate(db, transaction),
      this.detectUnusuallyLarge(db, transaction),
      Promise.resolve(this.detectLowConfidence(transaction)),
      this.detectUnusualFrequency(db, transaction),
    ]);

    return results.filter((result): result is Detection => result !== null);
  }

  /**
   * A. Possible duplicate - not the exact duplicate the unique constraint
   * already rejects at ingestion, but the same amount to the same account within
   * a short window under a different reference: a double-paid invoice, or one
   * file imported twice from two sources.
   */
  async detectPossibleDuplicate(
    db: ScopedPrisma,
    transaction: TransactionRow,
  ): Promise<Detection | null> {
    const windowMs = this.config.anomaly.duplicateWindowHours * 60 * 60 * 1000;
    const from = new Date(transaction.transactionDate.getTime() - windowMs);
    const to = new Date(transaction.transactionDate.getTime() + windowMs);

    const candidates = await db.transaction.findMany({
      where: {
        id: { not: transaction.id },
        accountId: transaction.accountId,
        amountMinor: transaction.amountMinor,
        direction: transaction.direction,
        transactionDate: { gte: from, lte: to },
      },
      take: 20,
    });

    const match = candidates.find(
      (candidate) =>
        descriptionSimilarity(candidate.description, transaction.description) >=
        DUPLICATE_SIMILARITY_THRESHOLD,
    );

    if (!match) return null;

    const hoursApart =
      Math.abs(match.transactionDate.getTime() - transaction.transactionDate.getTime()) / 3_600_000;

    return {
      rule: 'DUPLICATE_SUSPECTED',
      severity: 'HIGH',
      explanation:
        `Possible duplicate payment: ${Money.format(transaction.amountMinor, transaction.currency)} ` +
        `to the same account with a near-identical description was recorded ` +
        `${hoursApart.toFixed(1)} hours apart under reference ${match.externalReference}.`,
      details: {
        matchedTransactionId: match.id,
        matchedExternalReference: match.externalReference,
        hoursApart: Number(hoursApart.toFixed(2)),
        similarity: Number(
          descriptionSimilarity(match.description, transaction.description).toFixed(2),
        ),
        windowHours: this.config.anomaly.duplicateWindowHours,
      },
    };
  }

  /**
   * B. Unusually large, compared against the same account and direction: an
   * account that pays salaries has a different normal from one buying airtime.
   */
  async detectUnusuallyLarge(
    db: ScopedPrisma,
    transaction: TransactionRow,
  ): Promise<Detection | null> {
    const history = await db.transaction.findMany({
      where: {
        id: { not: transaction.id },
        accountId: transaction.accountId,
        direction: transaction.direction,
        transactionDate: { lte: transaction.transactionDate },
      },
      orderBy: { transactionDate: 'desc' },
      take: HISTORY_LIMIT,
      select: { amountMinor: true },
    });

    const verdict = assessLargeAmount(
      transaction.amountMinor,
      history.map((row) => row.amountMinor),
      {
        sigma: this.config.anomaly.largeAmountSigma,
        minSampleSize: this.config.anomaly.minSampleSize,
      },
    );

    if (!verdict.flagged) return null;

    return {
      rule: 'UNUSUALLY_LARGE',
      severity: severityForZScore(verdict.zScore),
      explanation:
        `${Money.format(transaction.amountMinor, transaction.currency)} is unusually large for this ` +
        `account: the average of the last ${verdict.sampleSize} comparable transactions is ` +
        `${Money.format(verdict.meanMinor, transaction.currency)}, and this is ` +
        `${verdict.zScore?.toFixed(1)} standard deviations above it ` +
        `(threshold ${Money.format(verdict.thresholdMinor, transaction.currency)}).`,
      details: {
        sampleSize: verdict.sampleSize,
        meanMinor: verdict.meanMinor.toString(),
        stdDevMinor: verdict.stdDevMinor.toString(),
        thresholdMinor: verdict.thresholdMinor.toString(),
        zScore: verdict.zScore,
        sigma: this.config.anomaly.largeAmountSigma,
      },
    };
  }

  /**
   * C. Low confidence: categorised, but not confidently enough to be trusted in
   * a report without a human glance.
   */
  detectLowConfidence(transaction: TransactionRow): Detection | null {
    const threshold = this.config.classification.lowConfidenceReviewThreshold;
    const confidence = transaction.confidence;

    if (confidence === null) return null;
    // Confidence alone decides. A PROVISIONAL status at, say, 0.68 is a
    // reasonable answer that simply fell short of the auto-accept bar; only
    // genuinely weak answers are worth a person's time, or the queue fills
    // with noise and gets ignored - which is worse than having no queue.
    if (confidence >= threshold) return null;

    return {
      rule: 'LOW_CONFIDENCE',
      severity: confidence < threshold / 2 ? 'MEDIUM' : 'LOW',
      explanation:
        `Classified as ${transaction.category ?? 'uncategorised'} with ${(confidence * 100).toFixed(0)}% ` +
        `confidence, below the ${(threshold * 100).toFixed(0)}% review threshold. ` +
        `The category may be wrong and should be confirmed by a person.`,
      details: {
        confidence,
        threshold,
        classificationStatus: transaction.classificationStatus,
        category: transaction.category,
      },
    };
  }

  /**
   * D. Unusual frequency: the same counterparty paid an unusual number of times
   * in the window - a retry loop, repeated billing, or a compromised card.
   */
  async detectUnusualFrequency(
    db: ScopedPrisma,
    transaction: TransactionRow,
  ): Promise<Detection | null> {
    if (!transaction.merchant) return null;

    const windowMs = this.config.anomaly.frequencyWindowHours * 60 * 60 * 1000;
    const from = new Date(transaction.transactionDate.getTime() - windowMs);

    const occurrences = await db.transaction.count({
      where: {
        merchant: transaction.merchant,
        direction: transaction.direction,
        transactionDate: { gte: from, lte: transaction.transactionDate },
      },
    });

    if (occurrences <= this.config.anomaly.frequencyThreshold) return null;

    return {
      rule: 'UNUSUAL_FREQUENCY',
      severity: occurrences >= this.config.anomaly.frequencyThreshold * 2 ? 'HIGH' : 'MEDIUM',
      explanation:
        `${occurrences} payments to ${transaction.merchant} were recorded in the last ` +
        `${this.config.anomaly.frequencyWindowHours} hours, above the expected maximum of ` +
        `${this.config.anomaly.frequencyThreshold}. This can indicate a retry loop or duplicated billing.`,
      details: {
        merchant: transaction.merchant,
        occurrences,
        windowHours: this.config.anomaly.frequencyWindowHours,
        threshold: this.config.anomaly.frequencyThreshold,
      },
    };
  }

  /** One flag per rule per transaction, so re-running detection is idempotent -
   *  which it has to be, because the worker retries. */
  private async persistFlag(
    db: ScopedPrisma,
    organisationId: string,
    transactionId: string,
    detection: Detection,
  ): Promise<void> {
    try {
      await db.reviewFlag.create({
        data: {
          organisationId,
          transactionId,
          rule: detection.rule,
          severity: detection.severity,
          explanation: detection.explanation,
          details: JSON.stringify(detection.details),
        },
      });
    } catch (error) {
      if (PrismaService.isUniqueViolation(error)) return; // already flagged
      throw error;
    }
  }
}
