import { Injectable, Logger } from '@nestjs/common';

import { JobType } from '../../common/domain/constants';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface EnqueueJobInput {
  organisationId: string;
  type: JobType;
  payload: Record<string, unknown>;
  runAt?: Date;
  maxAttempts?: number;
}

/**
 * Minimal Prisma surface the enqueue needs, so a job can be written inside
 * the same database transaction as the row that triggered it.
 */
export interface JobWriter {
  job: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
}

/**
 * Job creation. The worker that consumes these lives in jobs.worker.ts.
 *
 * Enqueueing takes an optional transaction client: a classification job is
 * written in the same transaction as the transaction row itself, so a
 * committed transaction always has its follow-up work scheduled, and a rolled
 * back one never leaves an orphan job.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async enqueue(input: EnqueueJobInput, client?: JobWriter): Promise<string> {
    const writer = client ?? (this.prisma as unknown as JobWriter);
    const job = await writer.job.create({
      data: {
        organisationId: input.organisationId,
        type: input.type,
        payload: JSON.stringify(input.payload),
        runAt: input.runAt ?? new Date(),
        maxAttempts: input.maxAttempts ?? 5,
      },
    });
    return job.id;
  }

  /** Queue depth by status, for the health/metrics view. */
  async stats(organisationId?: string): Promise<Record<string, number>> {
    const grouped = await this.prisma.job.groupBy({
      by: ['status'],
      where: organisationId ? { organisationId } : undefined,
      _count: { _all: true },
    });

    return grouped.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = row._count._all;
      return acc;
    }, {});
  }
}
