import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * The one place database connection concerns live, so moving to PostgreSQL is a
 * datasource change rather than a code change.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      // Duplicate ingestion and repeat flagging raise constraint errors that are
      // handled in code, so Prisma's own logging is noise during tests.
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
      // WAL plus a busy timeout is as close as SQLite gets to concurrent writers,
      // and NORMAL avoids an fsync per commit - worth it for a local database
      // seeding thousands of jobs. Several PRAGMAs return a row, hence queryRaw.
      await this.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
      await this.$queryRawUnsafe('PRAGMA busy_timeout = 5000;');
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
