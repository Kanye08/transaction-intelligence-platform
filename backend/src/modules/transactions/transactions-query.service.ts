import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AuthUser } from '../../common/auth/auth-user';
import { Money } from '../../common/money/money';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { QueryTransactionsDto } from './dto/query-transactions.dto';
import { toTransactionDto, TransactionDto } from './dto/transaction.dto';

export interface TransactionPage {
  data: TransactionDto[];
  pageInfo: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
  total?: number;
}

const DEFAULT_LIMIT = 25;

const INCLUDE_FOR_VIEW = {
  account: { select: { name: true } },
  reviewFlags: {
    orderBy: { createdAt: 'desc' },
    include: { resolvedBy: { select: { name: true } } },
  },
} as const;

/** Cursor = the sort key of the last row seen, base64url encoded. */
function encodeCursor(transactionDate: Date, id: string): string {
  return Buffer.from(`${transactionDate.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { transactionDate: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const transactionDate = iso ? new Date(iso) : new Date(Number.NaN);
  if (!id || Number.isNaN(transactionDate.getTime())) {
    throw new BadRequestException('Malformed pagination cursor');
  }
  return { transactionDate, id };
}

/**
 * Reads.
 *
 * Listing uses keyset (cursor) pagination ordered by (transactionDate, id):
 * page 10,000 costs the same as page 1, where OFFSET would make the database
 * walk every skipped row. The total count is opt-in for the same reason - it
 * is the expensive half of a listing query on a large tenant.
 */
@Injectable()
export class TransactionsQueryService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async list(user: AuthUser, query: QueryTransactionsDto): Promise<TransactionPage> {
    const db = this.tenantPrisma.forOrganisation(user.organisationId);
    const limit = query.limit ?? DEFAULT_LIMIT;
    const where = this.buildWhere(query);

    if (query.cursor) {
      const { transactionDate, id } = decodeCursor(query.cursor);
      // Strictly "after" the cursor in (date desc, id desc) order.
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            { transactionDate: { lt: transactionDate } },
            { transactionDate, id: { lt: id } },
          ],
        },
      ];
    }

    const rows = await db.transaction.findMany({
      where,
      include: INCLUDE_FOR_VIEW,
      orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }],
      take: limit + 1, // one extra row answers "is there a next page?"
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    const result: TransactionPage = {
      data: page.map(toTransactionDto),
      pageInfo: {
        limit,
        hasMore,
        nextCursor: hasMore && last ? encodeCursor(last.transactionDate, last.id) : null,
      },
    };

    if (query.includeTotal) {
      result.total = await db.transaction.count({ where });
    }

    return result;
  }

  async findOne(user: AuthUser, id: string): Promise<TransactionDto> {
    const db = this.tenantPrisma.forOrganisation(user.organisationId);
    const transaction = await db.transaction.findFirst({
      where: { id },
      include: INCLUDE_FOR_VIEW,
    });
    // A transaction in another organisation is simply "not found".
    if (!transaction) throw new NotFoundException('Transaction not found');
    return toTransactionDto(transaction);
  }

  buildWhere(query: QueryTransactionsDto): Prisma.TransactionWhereInput {
    const where: Prisma.TransactionWhereInput = {};

    if (query.accountId) where.accountId = query.accountId;
    if (query.direction) where.direction = query.direction;
    if (query.category) where.category = query.category;
    if (query.classificationStatus) where.classificationStatus = query.classificationStatus;

    if (query.dateFrom || query.dateTo) {
      where.transactionDate = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }

    if (query.amountMin || query.amountMax) {
      where.amountMinor = {
        ...(query.amountMin ? { gte: Money.parse(query.amountMin) } : {}),
        ...(query.amountMax ? { lte: Money.parse(query.amountMax) } : {}),
      };
    }

    if (query.search) {
      // SQLite LIKE is case-insensitive for ASCII, which is what the seeded
      // merchant and description data uses. On PostgreSQL this becomes
      // mode: 'insensitive' or a trigram index.
      where.OR = [
        { description: { contains: query.search } },
        { merchant: { contains: query.search } },
        { externalReference: { contains: query.search } },
      ];
    }

    switch (query.review) {
      case 'FLAGGED':
        where.reviewFlags = { some: {} };
        break;
      case 'OPEN':
        where.reviewFlags = { some: { status: 'OPEN' } };
        break;
      case 'CLEAR':
        where.reviewFlags = { none: { status: 'OPEN' } };
        break;
      default:
        break;
    }

    return where;
  }
}
