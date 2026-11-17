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
      log:
        process.env.PRISMA_LOG === 'query'
          ? [{ emit: 'stdout', level: 'query' }]
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
      // journal_mode returns a row, so it must go through $queryRawUnsafe.
      await this.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
      await this.$executeRawUnsafe('PRAGMA busy_timeout = 5000;');
      await this.$executeRawUnsafe('PRAGMA foreign_keys = ON;');
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
