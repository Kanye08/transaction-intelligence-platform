import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Thin wrapper around PrismaClient.
 *
 * It is the single place where database connection concerns live, which keeps
 * the swap to PostgreSQL a datasource change rather than a code change. The
 * SQLite pragmas below exist because the assessment runs concurrent ingestion
 * tests: WAL plus a busy timeout turn "database is locked" errors into short
 * waits, which is the closest SQLite gets to row-level concurrency.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      // Expected constraint violations (duplicate ingestion, idempotent flag
      // creation) are handled in code, so Prisma's own error logging is noise
      // during tests. PRISMA_LOG=query turns on statement logging when needed.
      log:
        process.env.PRISMA_LOG === 'query'
          ? [{ emit: 'stdout', level: 'query' }]
          : process.env.NODE_ENV === 'test'
            ? []
            : [{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.applySqlitePragmas();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  private async applySqlitePragmas(): Promise<void> {
    try {
      // Several PRAGMAs return a row, so all of them go through queryRaw.
      await this.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
      await this.$queryRawUnsafe('PRAGMA busy_timeout = 5000;');
      // With WAL, NORMAL keeps durability against process crashes and only
      // risks the last commits on an OS-level crash, in exchange for not
      // fsyncing on every commit. For a local development database driving
      // thousands of seeded jobs that trade is clearly worth it; a production
      // PostgreSQL deployment has nothing equivalent to tune here.
      await this.$queryRawUnsafe('PRAGMA synchronous = NORMAL;');
      await this.$queryRawUnsafe('PRAGMA foreign_keys = ON;');
    } catch (error) {
      this.logger.warn(`Could not apply SQLite pragmas: ${(error as Error).message}`);
    }
  }

  /** True when an error is a unique-constraint violation (duplicate row). */
  static isUniqueViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  /** True when an error is a failed CHECK/foreign-key style constraint. */
  static isConstraintViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2003', 'P2004', 'P2011'].includes(error.code)
    );
  }
}
