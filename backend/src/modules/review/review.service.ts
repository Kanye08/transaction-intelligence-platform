import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { AuthUser } from '../../common/auth/auth-user';
import { ReviewRule, ReviewSeverity, ReviewStatus } from '../../common/domain/constants';
import { toMoneyView } from '../../common/money/money';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';

export interface ReviewFlagListItem {
  id: string;
  rule: ReviewRule;
  severity: ReviewSeverity;
  status: ReviewStatus;
  explanation: string;
  details: Record<string, unknown> | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  transaction: {
    id: string;
    externalReference: string;
    description: string;
    merchant: string | null;
    direction: string;
    transactionDate: string;
    amount: string;
    amountMinor: string;
    formattedAmount: string;
    currency: string;
    category: string | null;
    classificationStatus: string;
    confidence: number | null;
    accountName: string | null;
  };
}

export interface ReviewQuery {
  status?: ReviewStatus;
  rule?: ReviewRule;
  severity?: ReviewSeverity;
  limit?: number;
  offset?: number;
}


/** Relations every flag view needs. */
const FLAG_INCLUDE = {
  resolvedBy: { select: { name: true } },
  transaction: { include: { account: { select: { name: true } } } },
} as const;

interface FlagRow {
  id: string;
  rule: string;
  severity: string;
  status: string;
  explanation: string;
  details: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  resolvedBy?: { name: string } | null;
  transaction: {
    id: string;
    externalReference: string;
    description: string;
    merchant: string | null;
    direction: string;
    transactionDate: Date;
    amountMinor: bigint;
    currency: string;
    category: string | null;
    classificationStatus: string;
    confidence: number | null;
    account?: { name: string } | null;
  };
}

/** Single mapper from database row to API shape. */
function toListItem(flag: FlagRow): ReviewFlagListItem {
  const money = toMoneyView(flag.transaction.amountMinor, flag.transaction.currency);
  return {
    id: flag.id,
    rule: flag.rule as ReviewRule,
    severity: flag.severity as ReviewSeverity,
    status: flag.status as ReviewStatus,
    explanation: flag.explanation,
    details: flag.details ? (JSON.parse(flag.details) as Record<string, unknown>) : null,
    createdAt: flag.createdAt.toISOString(),
    resolvedAt: flag.resolvedAt?.toISOString() ?? null,
    resolvedBy: flag.resolvedBy?.name ?? null,
    resolutionNote: flag.resolutionNote,
    transaction: {
      id: flag.transaction.id,
      externalReference: flag.transaction.externalReference,
      description: flag.transaction.description,
      merchant: flag.transaction.merchant,
      direction: flag.transaction.direction,
      transactionDate: flag.transaction.transactionDate.toISOString(),
      amount: money.amount,
      amountMinor: money.amountMinor,
      formattedAmount: money.formattedAmount,
      currency: money.currency,
      category: flag.transaction.category,
      classificationStatus: flag.transaction.classificationStatus,
      confidence: flag.transaction.confidence,
      accountName: flag.transaction.account?.name ?? null,
    },
  };
}

@Injectable()
export class ReviewService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async listFlags(
    user: AuthUser,
    query: ReviewQuery,
  ): Promise<{ data: ReviewFlagListItem[]; total: number; limit: number; offset: number }> {
    const db = this.tenantPrisma.forOrganisation(user.organisationId);
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.rule ? { rule: query.rule } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
    };

    const [rows, total] = await Promise.all([
      db.reviewFlag.findMany({
        where,
        // Highest severity first, then newest: the queue is ordered by what
        // a reviewer should look at first, not by insertion order.
        orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
        skip: offset,
        take: limit,
        include: FLAG_INCLUDE,
      }),
      db.reviewFlag.count({ where }),
    ]);

    return {
      data: rows.map((flag) => toListItem(flag)),
      total,
      limit,
      offset,
    };
  }

  /** Counts for the dashboard and the review screen header. */
  async summary(user: AuthUser): Promise<{
    open: number;
    resolved: number;
    dismissed: number;
    byRule: Record<string, number>;
    bySeverity: Record<string, number>;
  }> {
    const db = this.tenantPrisma.forOrganisation(user.organisationId);

    const [byStatus, byRule, bySeverity] = await Promise.all([
      db.reviewFlag.groupBy({ by: ['status'], _count: { _all: true } }),
      db.reviewFlag.groupBy({ by: ['rule'], where: { status: 'OPEN' }, _count: { _all: true } }),
      db.reviewFlag.groupBy({ by: ['severity'], where: { status: 'OPEN' }, _count: { _all: true } }),
    ]);

    const statusCounts = Object.fromEntries(byStatus.map((row) => [row.status, row._count._all]));

    return {
      open: statusCounts['OPEN'] ?? 0,
      resolved: statusCounts['RESOLVED'] ?? 0,
      dismissed: statusCounts['DISMISSED'] ?? 0,
      byRule: Object.fromEntries(byRule.map((row) => [row.rule, row._count._all])),
      bySeverity: Object.fromEntries(bySeverity.map((row) => [row.severity, row._count._all])),
    };
  }

  /**
   * Closes a flag. Only an open flag can be closed, and who closed it and why
   * is recorded - a review queue without accountability is just a list.
   */
  async resolve(
    user: AuthUser,
    flagId: string,
    action: 'RESOLVE' | 'DISMISS',
    note?: string,
  ): Promise<ReviewFlagListItem> {
    const db = this.tenantPrisma.forOrganisation(user.organisationId);
    const flag = await db.reviewFlag.findFirst({ where: { id: flagId } });
    if (!flag) throw new NotFoundException('Review flag not found');

    if (flag.status !== 'OPEN') {
      throw new BadRequestException(`This flag is already ${flag.status.toLowerCase()}`);
    }

    await db.reviewFlag.updateMany({
      where: { id: flagId, status: 'OPEN' },
      data: {
        status: action === 'RESOLVE' ? 'RESOLVED' : 'DISMISSED',
        resolvedAt: new Date(),
        resolvedByUserId: user.userId,
        resolutionNote: note ?? null,
      },
    });

    const [updated] = (await this.listFlagsByIds(user, [flagId])) as ReviewFlagListItem[];
    if (!updated) throw new NotFoundException('Review flag not found');
    return updated;
  }

  /** Auto-closes low-confidence flags when a human sets the category. */
  async resolveLowConfidenceFor(
    user: AuthUser,
    transactionId: string,
    note: string,
  ): Promise<number> {
    const db = this.tenantPrisma.forOrganisation(user.organisationId);
    const { count } = await db.reviewFlag.updateMany({
      where: { transactionId, rule: 'LOW_CONFIDENCE', status: 'OPEN' },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedByUserId: user.userId,
        resolutionNote: note,
      },
    });
    return count;
  }

  private async listFlagsByIds(user: AuthUser, ids: string[]): Promise<ReviewFlagListItem[]> {
    const db = this.tenantPrisma.forOrganisation(user.organisationId);
    const rows = await db.reviewFlag.findMany({
      where: { id: { in: ids } },
      include: FLAG_INCLUDE,
    });
    return rows.map((flag) => toListItem(flag));
  }
}
