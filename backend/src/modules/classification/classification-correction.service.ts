import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { AuthUser } from '../../common/auth/auth-user';
import {
  Category,
  CATEGORY_LABELS,
  ClassificationSource,
  ClassificationStatus,
} from '../../common/domain/constants';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { ReviewService } from '../review/review.service';
import { assertTransition } from './classification-state';

export interface ClassificationHistoryEntry {
  id: string;
  previousCategory: Category | null;
  previousCategoryLabel: string | null;
  newCategory: Category;
  newCategoryLabel: string;
  source: ClassificationSource;
  confidence: number | null;
  provider: string | null;
  providerVersion: string | null;
  actor: string | null;
  reason: string | null;
  createdAt: string;
}

/**
 * Three things must survive a correction, because they are what a customer asks
 * for when they stop trusting the categories: the original automated decision,
 * so "what did the model say?" is answerable months later; who changed it, when
 * and why; and the guarantee that no queued job will undo it.
 */
@Injectable()
export class ClassificationCorrectionService {
  private readonly logger = new Logger(ClassificationCorrectionService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly review: ReviewService,
  ) {}

  async correct(
    user: AuthUser,
    transactionId: string,
    category: Category,
    reason?: string,
  ): Promise<{ transactionId: string; category: Category; status: ClassificationStatus }> {
    const db = this.tenantPrisma.forOrganisation(user.organisationId);
    const transaction = await db.transaction.findFirst({ where: { id: transactionId } });
    if (!transaction) throw new NotFoundException('Transaction not found');

    const currentStatus = transaction.classificationStatus as ClassificationStatus;
    assertTransition(currentStatus, 'MANUAL', 'MANUAL');

    await db.$transaction(async (tx) => {
      const updated = await tx.transaction.updateMany({
        where: { id: transactionId, classificationVersion: transaction.classificationVersion },
        data: {
          category,
          // Preserved: whatever the automation decided first stays on the row.
          originalCategory: transaction.originalCategory ?? transaction.category,
          confidence: 1,
          classificationStatus: 'MANUAL',
          classificationSource: 'MANUAL',
          classificationProvider: null,
          classificationVersion: { increment: 1 },
          classifiedAt: new Date(),
        },
      });

      if (updated.count === 0) {
        // Someone else changed the row between read and write.
        throw new ConflictException(
          'This transaction was updated by another process. Reload it and try again.',
        );
      }

      // Append-only: corrections add history, they never rewrite it.
      await tx.classificationEvent.create({
        data: {
          organisationId: user.organisationId,
          transactionId,
          previousCategory: transaction.category,
          newCategory: category,
          source: 'MANUAL',
          confidence: 1,
          provider: null,
          providerVersion: null,
          actorUserId: user.userId,
          reason: reason ?? 'Manual correction',
        },
      });
    });

    // A human has now confirmed the category, so the low-confidence flag that
    // asked for exactly that is satisfied.
    const closed = await this.review.resolveLowConfidenceFor(
      user,
      transactionId,
      `Category confirmed manually as ${CATEGORY_LABELS[category]}`,
    );
    if (closed > 0) {
      this.logger.log(`Closed ${closed} low-confidence flag(s) after manual correction`);
    }

    return { transactionId, category, status: 'MANUAL' };
  }

  /** Full decision trail for one transaction, oldest first. */
  async history(user: AuthUser, transactionId: string): Promise<ClassificationHistoryEntry[]> {
    const db = this.tenantPrisma.forOrganisation(user.organisationId);

    const transaction = await db.transaction.findFirst({
      where: { id: transactionId },
      select: { id: true },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');

    const events = await db.classificationEvent.findMany({
      where: { transactionId },
      orderBy: { createdAt: 'asc' },
      include: { actor: { select: { name: true } } },
    });

    return events.map((event) => ({
      id: event.id,
      previousCategory: event.previousCategory as Category | null,
      previousCategoryLabel: event.previousCategory
        ? (CATEGORY_LABELS[event.previousCategory as Category] ?? event.previousCategory)
        : null,
      newCategory: event.newCategory as Category,
      newCategoryLabel: CATEGORY_LABELS[event.newCategory as Category] ?? event.newCategory,
      source: event.source as ClassificationSource,
      confidence: event.confidence,
      provider: event.provider,
      providerVersion: event.providerVersion,
      actor: event.actor?.name ?? null,
      reason: event.reason,
      createdAt: event.createdAt.toISOString(),
    }));
  }
}
