import { Injectable } from '@nestjs/common';

import { AuthUser } from '../../common/auth/auth-user';
import { CATEGORY_LABELS, Category } from '../../common/domain/constants';
import { Money, toMoneyView } from '../../common/money/money';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { DashboardQueryDto } from './dto/dashboard.dto';

export interface CategoryBreakdownItem {
  category: string;
  label: string;
  amount: string;
  amountMinor: string;
  formattedAmount: string;
  transactionCount: number;
  /** Share of total outflow, 0..100, rounded to one decimal. */
  percentage: number;
}

export interface DashboardSummary {
  range: { from: string | null; to: string | null };
  totals: {
    inflow: ReturnType<typeof toMoneyView>;
    outflow: ReturnType<typeof toMoneyView>;
    net: ReturnType<typeof toMoneyView>;
    transactionCount: number;
  };
  spendingByCategory: CategoryBreakdownItem[];
  classificationStatus: Record<string, number>;
  review: { openFlags: number; byRule: Record<string, number> };
  recentTransactions: {
    id: string;
    description: string;
    merchant: string | null;
    direction: string;
    formattedAmount: string;
    amountMinor: string;
    category: string | null;
    categoryLabel: string | null;
    classificationStatus: string;
    transactionDate: string;
  }[];
}

/**
 * Dashboard aggregates.
 *
 * Every figure is computed by the database (GROUP BY / SUM), not by loading
 * transactions into memory: the API cost of the dashboard must not grow with
 * the size of the tenant. Sums come back as BigInt kobo and are formatted at
 * the edge, so the totals are exact at any volume.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async summary(user: AuthUser, query: DashboardQueryDto): Promise<DashboardSummary> {
    const db = this.tenantPrisma.forOrganisation(user.organisationId);

    const dateFilter =
      query.dateFrom || query.dateTo
        ? {
            transactionDate: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {};

    const where = {
      ...dateFilter,
      ...(query.accountId ? { accountId: query.accountId } : {}),
    };

    const [byDirection, byCategory, byStatus, openFlags, flagsByRule, recent] = await Promise.all([
      db.transaction.groupBy({
        by: ['direction'],
        where,
        _sum: { amountMinor: true },
        _count: { _all: true },
      }),
      db.transaction.groupBy({
        by: ['category'],
        where: { ...where, direction: 'OUTFLOW' },
        _sum: { amountMinor: true },
        _count: { _all: true },
      }),
      db.transaction.groupBy({ by: ['classificationStatus'], where, _count: { _all: true } }),
      db.reviewFlag.count({ where: { status: 'OPEN' } }),
      db.reviewFlag.groupBy({ by: ['rule'], where: { status: 'OPEN' }, _count: { _all: true } }),
      db.transaction.findMany({
        where,
        orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }],
        take: 8,
      }),
    ]);

    const inflow = this.sumFor(byDirection, 'INFLOW');
    const outflow = this.sumFor(byDirection, 'OUTFLOW');
    const net = Money.subtract(inflow, outflow);

    const transactionCount = byDirection.reduce((total, row) => total + row._count._all, 0);

    const spendingByCategory = byCategory
      .map((row) => {
        const amountMinor = row._sum.amountMinor ?? 0n;
        const category = row.category ?? 'UNCLASSIFIED';
        return {
          category,
          label:
            category === 'UNCLASSIFIED'
              ? 'Awaiting classification'
              : (CATEGORY_LABELS[category as Category] ?? category),
          amount: Money.toDecimalString(amountMinor),
          amountMinor: amountMinor.toString(),
          formattedAmount: Money.format(amountMinor),
          transactionCount: row._count._all,
          percentage:
            outflow > 0n
              ? Math.round((Number(amountMinor) / Number(outflow)) * 1000) / 10
              : 0,
        };
      })
      .sort((a, b) => (BigInt(b.amountMinor) > BigInt(a.amountMinor) ? 1 : -1));

    return {
      range: { from: query.dateFrom ?? null, to: query.dateTo ?? null },
      totals: {
        inflow: toMoneyView(inflow),
        outflow: toMoneyView(outflow),
        net: toMoneyView(net),
        transactionCount,
      },
      spendingByCategory,
      classificationStatus: Object.fromEntries(
        byStatus.map((row) => [row.classificationStatus, row._count._all]),
      ),
      review: {
        openFlags,
        byRule: Object.fromEntries(flagsByRule.map((row) => [row.rule, row._count._all])),
      },
      recentTransactions: recent.map((transaction) => ({
        id: transaction.id,
        description: transaction.description,
        merchant: transaction.merchant,
        direction: transaction.direction,
        formattedAmount: Money.format(transaction.amountMinor, transaction.currency),
        amountMinor: transaction.amountMinor.toString(),
        category: transaction.category,
        categoryLabel: transaction.category
          ? (CATEGORY_LABELS[transaction.category as Category] ?? transaction.category)
          : null,
        classificationStatus: transaction.classificationStatus,
        transactionDate: transaction.transactionDate.toISOString(),
      })),
    };
  }

  /**
   * Prisma returns SUM over a BigInt column as BigInt, and an empty group as
   * null - an empty dataset must read as zero, not NaN.
   */
  private sumFor(
    rows: { direction: string; _sum: { amountMinor: bigint | null } }[],
    direction: string,
  ): bigint {
    const row = rows.find((candidate) => candidate.direction === direction);
    return row?._sum.amountMinor ?? 0n;
  }
}
