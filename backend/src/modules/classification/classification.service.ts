import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { AuthUser } from '../../common/auth/auth-user';
import { Category, ClassificationStatus } from '../../common/domain/constants';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { AppConfig, CONFIG_TOKEN } from '../../config/configuration';
import { assertTransition, statusForAutomatedResult } from './classification-state';
import {
  CLASSIFICATION_PROVIDER,
  ClassificationProvider,
  ClassificationResult,
} from './providers/classification-provider';

export interface ApplyOutcome {
  applied: boolean;
  status: ClassificationStatus;
  category: Category | null;
  /** Set when the result should be retried later (degraded provider). */
  retry: boolean;
  skippedReason?: string;
}

@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    @Inject(CLASSIFICATION_PROVIDER) private readonly provider: ClassificationProvider,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  get providerName(): string {
    return this.provider.name;
  }

  /**
   * Classifies one transaction and persists the decision.
   *
   * Called by the background worker, never by the ingestion path. Returns
   * whether the work should be retried so the worker can schedule it.
   */
  async classifyTransaction(
    organisationId: string,
    transactionId: string,
    attemptsRemaining: boolean,
  ): Promise<ApplyOutcome> {
    const db = this.tenantPrisma.forOrganisation(organisationId);
    const transaction = await db.transaction.findFirst({ where: { id: transactionId } });

    if (!transaction) {
      // The transaction was deleted, or the job belongs to another tenant.
      return { applied: false, status: 'PENDING', category: null, retry: false, skippedReason: 'not-found' };
    }

    const currentStatus = transaction.classificationStatus as ClassificationStatus;

    // A human has already decided. Automation stops here - this is the check
    // that stops a delayed job from silently reverting a correction.
    if (currentStatus === 'MANUAL') {
      return {
        applied: false,
        status: 'MANUAL',
        category: transaction.category as Category | null,
        retry: false,
        skippedReason: 'manually-classified',
      };
    }

    const result = await this.provider.classify({
      transactionId: transaction.id,
      description: transaction.description,
      merchant: transaction.merchant,
      direction: transaction.direction as 'INFLOW' | 'OUTFLOW',
      amountMinor: transaction.amountMinor,
      currency: transaction.currency,
      transactionDate: transaction.transactionDate,
    });

    const nextStatus = statusForAutomatedResult({
      confidence: result.confidence,
      threshold: this.config.classification.confidenceThreshold,
      degraded: result.degraded,
      attemptsRemaining,
    });

    assertTransition(currentStatus, nextStatus, result.source);

    const applied = await this.persist(organisationId, {
      transactionId: transaction.id,
      expectedVersion: transaction.classificationVersion,
      previousCategory: transaction.category as Category | null,
      originalCategory: transaction.originalCategory as Category | null,
      nextStatus,
      result,
    });

    if (!applied) {
      // Lost an optimistic-concurrency race: something else (very likely a
      // manual correction) changed the row after it was read.
      return {
        applied: false,
        status: currentStatus,
        category: transaction.category as Category | null,
        retry: false,
        skippedReason: 'concurrent-update',
      };
    }

    return {
      applied: true,
      status: nextStatus,
      category: result.category,
      retry: Boolean(result.degraded) && attemptsRemaining,
    };
  }

  /**
   * Writes the decision and its audit event atomically, guarded by the row
   * version so a stale job cannot overwrite a newer decision.
   */
  private async persist(
    organisationId: string,
    input: {
      transactionId: string;
      expectedVersion: number;
      previousCategory: Category | null;
      originalCategory: Category | null;
      nextStatus: ClassificationStatus;
      result: ClassificationResult;
    },
  ): Promise<boolean> {
    const db = this.tenantPrisma.forOrganisation(organisationId);

    return db.$transaction(async (tx) => {
      const updated = await tx.transaction.updateMany({
        where: {
          id: input.transactionId,
          classificationVersion: input.expectedVersion,
          // Belt and braces: never touch a manually classified row.
          classificationStatus: { not: 'MANUAL' },
        },
        data: {
          category: input.result.category,
          // The first automated decision is kept forever.
          originalCategory: input.originalCategory ?? input.result.category,
          confidence: input.result.confidence,
          classificationStatus: input.nextStatus,
          classificationSource: input.result.source,
          classificationProvider: `${input.result.provider}@${input.result.providerVersion}`,
          classificationVersion: { increment: 1 },
          classifiedAt: new Date(),
        },
      });

      if (updated.count === 0) return false;

      await tx.classificationEvent.create({
        data: {
          organisationId,
          transactionId: input.transactionId,
          previousCategory: input.previousCategory,
          newCategory: input.result.category,
          source: input.result.source,
          confidence: input.result.confidence,
          provider: input.result.provider,
          providerVersion: input.result.providerVersion,
          actorUserId: null,
          reason: input.result.reason,
        },
      });

      return true;
    });
  }

  /** Re-queues a transaction for classification (demo and operations hook). */
  async requestReclassification(user: AuthUser, transactionId: string): Promise<void> {
    const db = this.tenantPrisma.forOrganisation(user.organisationId);
    const transaction = await db.transaction.findFirst({
      where: { id: transactionId },
      select: { id: true },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');

    await db.job.create({
      data: {
        organisationId: user.organisationId,
        type: 'CLASSIFY_TRANSACTION',
        payload: JSON.stringify({ transactionId, requestedBy: user.userId }),
      },
    });
  }
}
