import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AuthUser } from '../../common/auth/auth-user';
import { AppConfig, CONFIG_TOKEN } from '../../config/configuration';
import { Money } from '../../common/money/money';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ScopedPrisma, TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { JobsService, JobWriter } from '../jobs/jobs.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { toTransactionDto, TransactionDto } from './dto/transaction.dto';

export type IngestOutcome = 'CREATED' | 'DUPLICATE' | 'FAILED';

export interface IngestResult {
  status: IngestOutcome;
  transaction: TransactionDto;
}

export interface BatchItemResult {
  index: number;
  externalReference: string | null;
  status: IngestOutcome;
  transactionId?: string;
  errors?: string[];
}

export interface BatchResult {
  summary: { total: number; created: number; duplicates: number; failed: number };
  results: BatchItemResult[];
}

const INCLUDE_FOR_VIEW = {
  account: { select: { name: true } },
  reviewFlags: {
    orderBy: { createdAt: 'desc' },
    include: { resolvedBy: { select: { name: true } } },
  },
} as const;

/**
 * Ingestion writes the row and schedules a job; whether the classification
 * provider is healthy, slow or on fire is the worker's problem.
 *
 * Duplicate prevention is the unique index on
 * (organisationId, accountId, externalReference), not a pre-check - that is what
 * makes concurrent imports of the same transaction safe. The code only turns the
 * constraint violation into a clean response.
 */
@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly jobs: JobsService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  async ingestOne(user: AuthUser, dto: CreateTransactionDto): Promise<IngestResult> {
    const db = this.tenantPrisma.forOrganisation(user.organisationId);
    await this.assertAccountExists(db, dto.accountId);
    return this.persist(db, user.organisationId, dto);
  }

  /** Every row is validated and written independently, so one bad row costs one
   *  row rather than the whole import. */
  async ingestBatch(user: AuthUser, items: unknown[]): Promise<BatchResult> {
    const db = this.tenantPrisma.forOrganisation(user.organisationId);
    const results: BatchItemResult[] = [];

    // Account existence is checked once per distinct account, not per row.
    const knownAccounts = new Map<string, boolean>();

    for (const [index, raw] of items.entries()) {
      const reference =
        typeof raw === 'object' && raw !== null
          ? ((raw as Record<string, unknown>)['externalReference'] as string | undefined) ?? null
          : null;

      const dto = plainToInstance(CreateTransactionDto, raw, { enableImplicitConversion: false });
      const violations = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
        validationError: { target: false },
      });

      if (violations.length > 0) {
        results.push({
          index,
          externalReference: reference,
          status: 'FAILED',
          errors: violations.flatMap((violation) => Object.values(violation.constraints ?? {})),
        });
        continue;
      }

      if (!knownAccounts.has(dto.accountId)) {
        const account = await db.account.findFirst({
          where: { id: dto.accountId },
          select: { id: true },
        });
        knownAccounts.set(dto.accountId, Boolean(account));
      }

      if (!knownAccounts.get(dto.accountId)) {
        results.push({
          index,
          externalReference: dto.externalReference,
          status: 'FAILED',
          errors: ['accountId does not reference an account in this organisation'],
        });
        continue;
      }

      try {
        const outcome = await this.persist(db, user.organisationId, dto);
        results.push({
          index,
          externalReference: dto.externalReference,
          status: outcome.status,
          transactionId: outcome.transaction.id,
        });
      } catch (error) {
        this.logger.warn(
          `Batch row ${index} (${dto.externalReference}) failed: ${(error as Error).message}`,
        );
        results.push({
          index,
          externalReference: dto.externalReference,
          status: 'FAILED',
          errors: [(error as Error).message],
        });
      }
    }

    return {
      summary: {
        total: items.length,
        created: results.filter((r) => r.status === 'CREATED').length,
        duplicates: results.filter((r) => r.status === 'DUPLICATE').length,
        failed: results.filter((r) => r.status === 'FAILED').length,
      },
      results,
    };
  }

  /** Writes the transaction and schedules its classification in one database
   *  transaction. */
  private async persist(
    db: ScopedPrisma,
    organisationId: string,
    dto: CreateTransactionDto,
  ): Promise<IngestResult> {
    const amountMinor = Money.parse(dto.amount);

    try {
      const created = await db.$transaction(async (tx) => {
        const transaction = await tx.transaction.create({
          data: {
            // Stated explicitly because Prisma's types require it, and
            // overwritten by the tenant scope anyway: the compiler stops you
            // forgetting a tenant, the scope stops you naming the wrong one.
            organisationId,
            accountId: dto.accountId,
            externalReference: dto.externalReference,
            amountMinor,
            currency: dto.currency ?? 'NGN',
            direction: dto.direction,
            description: dto.description,
            merchant: dto.merchant ?? null,
            transactionDate: new Date(dto.transactionDate),
            classificationStatus: 'PENDING',
          },
          include: INCLUDE_FOR_VIEW,
        });

        // Same transaction: a committed row always has work scheduled.
        await this.jobs.enqueue(
          {
            organisationId,
            type: 'CLASSIFY_TRANSACTION',
            payload: { transactionId: transaction.id },
            maxAttempts: this.config.classification.maxAttempts,
          },
          tx as unknown as JobWriter,
        );

        return transaction;
      });

      return { status: 'CREATED', transaction: toTransactionDto(created) };
    } catch (error) {
      if (!PrismaService.isUniqueViolation(error)) throw error;

      // The database refused the duplicate: return the row that won the race, so
      // concurrent callers all see the same single transaction.
      const existing = await db.transaction.findFirst({
        where: { accountId: dto.accountId, externalReference: dto.externalReference },
        include: INCLUDE_FOR_VIEW,
      });

      if (!existing) throw error;
      return { status: 'DUPLICATE', transaction: toTransactionDto(existing) };
    }
  }

  private async assertAccountExists(db: ScopedPrisma, accountId: string): Promise<void> {
    const account = await db.account.findFirst({ where: { id: accountId }, select: { id: true } });
    if (!account) {
      // Also the answer for an account belonging to another tenant.
      throw new NotFoundException('Account not found in this organisation');
    }
  }
}
