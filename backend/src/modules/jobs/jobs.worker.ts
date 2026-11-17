import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { backoffDelayMs } from '../../common/resilience/circuit-breaker';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppConfig, CONFIG_TOKEN } from '../../config/configuration';
import { ClassificationService } from '../classification/classification.service';
import { ReviewDetectionService } from '../review/review-detection.service';

interface ClaimedJob {
  id: string;
  organisationId: string | null;
  type: string;
  payload: string;
  attempts: number;
  maxAttempts: number;
}

/**
 * Database-backed background worker.
 *
 * Scope note, honestly stated: this is an assessment-scale queue. A table, a
 * poll loop and an atomic claim are enough for one process and thousands of
 * jobs, and they avoid making Redis a prerequisite for running the project.
 * At real volume this is replaced by BullMQ/SQS - the JobsService interface
 * is the seam where that swap happens, and nothing above it changes.
 *
 * What it does get right, because these are the parts that bite:
 *  - claiming is atomic, so two workers cannot take the same job;
 *  - retries are bounded, with exponential backoff and full jitter;
 *  - jobs left PROCESSING by a crash are recovered on the next boot;
 *  - a provider failure never damages the transaction that is already stored.
 */
@Injectable()
export class JobsWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobsWorker.name);
  private readonly workerId = `worker-${randomUUID().slice(0, 8)}`;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly classification: ClassificationService,
    private readonly detection: ReviewDetectionService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.worker.enabled) {
      this.logger.log('Background worker disabled by configuration');
      return;
    }

    await this.recoverStuckJobs();
    this.schedule();
    this.logger.log(`Background worker ${this.workerId} started`);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /**
   * Jobs that were being processed when the process died are still marked
   * PROCESSING. On boot they go back into the queue, which is what makes
   * "restart the app" a safe operation.
   */
  async recoverStuckJobs(): Promise<number> {
    const { count } = await this.prisma.job.updateMany({
      where: { status: 'PROCESSING' },
      data: { status: 'PENDING', lockedAt: null, lockedBy: null },
    });
    if (count > 0) {
      this.logger.warn(`Recovered ${count} job(s) left in flight by a previous run`);
    }
    return count;
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedule());
    }, this.config.worker.pollIntervalMs);
  }

  /** One polling cycle. Public so tests can drive the worker deterministically. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let processed = 0;

    try {
      for (let i = 0; i < this.config.worker.batchSize; i += 1) {
        const job = await this.claimNext();
        if (!job) break;
        await this.process(job);
        processed += 1;
      }
    } catch (error) {
      this.logger.error(`Worker cycle failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }

    return processed;
  }

  /** Drains the queue; used by the seed script and by tests. */
  async drain(maxCycles = 200): Promise<number> {
    let total = 0;
    for (let i = 0; i < maxCycles; i += 1) {
      const processed = await this.tick();
      total += processed;
      if (processed === 0) break;
    }
    return total;
  }

  /**
   * Atomic claim: UPDATE ... WHERE id = ? AND status = 'PENDING' succeeds for
   * exactly one worker. A SELECT-then-UPDATE would hand the same job to two.
   */
  private async claimNext(): Promise<ClaimedJob | null> {
    const candidate = await this.prisma.job.findFirst({
      where: { status: 'PENDING', runAt: { lte: new Date() } },
      orderBy: [{ runAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        organisationId: true,
        type: true,
        payload: true,
        attempts: true,
        maxAttempts: true,
      },
    });

    if (!candidate) return null;

    const claimed = await this.prisma.job.updateMany({
      where: { id: candidate.id, status: 'PENDING' },
      data: {
        status: 'PROCESSING',
        lockedAt: new Date(),
        lockedBy: this.workerId,
        attempts: { increment: 1 },
      },
    });

    if (claimed.count === 0) return null; // another worker got there first
    return { ...candidate, attempts: candidate.attempts + 1 };
  }

  private async process(job: ClaimedJob): Promise<void> {
    const attemptsRemaining = job.attempts < job.maxAttempts;

    try {
      const payload = JSON.parse(job.payload) as Record<string, unknown>;

      switch (job.type) {
        case 'CLASSIFY_TRANSACTION': {
          const transactionId = String(payload['transactionId']);
          if (!job.organisationId) throw new Error('Classification job without an organisation');

          const outcome = await this.classification.classifyTransaction(
            job.organisationId,
            transactionId,
            attemptsRemaining,
          );

          if (outcome.retry) {
            // The provider was degraded: keep the provisional answer, try
            // again later with backoff so recovery is automatic.
            await this.reschedule(job, 'Provider degraded; scheduled another attempt');
            return;
          }

          // Anomaly detection runs after classification so that
          // low-confidence results can be flagged in the same pass.
          if (outcome.applied) {
            await this.detection.runForTransaction(job.organisationId, transactionId);
          }
          break;
        }

        case 'DETECT_ANOMALIES': {
          const transactionId = String(payload['transactionId']);
          if (!job.organisationId) throw new Error('Detection job without an organisation');
          await this.detection.runForTransaction(job.organisationId, transactionId);
          break;
        }

        default:
          throw new Error(`Unknown job type: ${job.type}`);
      }

      await this.prisma.job.update({
        where: { id: job.id },
        data: { status: 'COMPLETED', completedAt: new Date(), lastError: null },
      });
    } catch (error) {
      const message = (error as Error).message;
      this.logger.warn(`Job ${job.id} (${job.type}) attempt ${job.attempts} failed: ${message}`);

      if (attemptsRemaining) {
        await this.reschedule(job, message);
      } else {
        // Dead-lettered, not lost: the row stays for inspection and replay.
        await this.prisma.job.update({
          where: { id: job.id },
          data: { status: 'DEAD', lastError: message, lockedAt: null, lockedBy: null },
        });
        this.logger.error(`Job ${job.id} exhausted ${job.maxAttempts} attempts: ${message}`);
      }
    }
  }

  private async reschedule(job: ClaimedJob, reason: string): Promise<void> {
    const delay = backoffDelayMs(job.attempts);
    await this.prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'PENDING',
        runAt: new Date(Date.now() + delay),
        lastError: reason,
        lockedAt: null,
        lockedBy: null,
      },
    });
  }
}
