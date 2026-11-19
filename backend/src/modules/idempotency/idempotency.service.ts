import { ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';

export interface IdempotencyReplay {
  replayed: true;
  statusCode: number;
  body: unknown;
}

export interface IdempotencyProceed {
  replayed: false;
}

export type IdempotencyOutcome = IdempotencyReplay | IdempotencyProceed;

/** Deterministic JSON: key order must not change the fingerprint. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

/**
 * Idempotency-Key support, resting on the unique constraint on
 * (organisationId, key) rather than a read-then-write check: two concurrent
 * requests both insert, the database lets one through, and the loser is told the
 * request is in flight. A completed key replays its original response; the same
 * key with a different payload is a 409.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  fingerprint(payload: unknown): string {
    return createHash('sha256').update(stableStringify(payload)).digest('hex');
  }

  async begin(
    organisationId: string,
    key: string,
    endpoint: string,
    payload: unknown,
  ): Promise<IdempotencyOutcome> {
    const db = this.tenantPrisma.forOrganisation(organisationId);
    const requestHash = this.fingerprint(payload);

    try {
      await db.idempotencyRecord.create({ data: { organisationId, key, endpoint, requestHash } });
      return { replayed: false };
    } catch (error) {
      if (!PrismaService.isUniqueViolation(error)) throw error;
    }

    const existing = await db.idempotencyRecord.findFirst({ where: { key } });
    if (!existing) {
      // The row vanished between insert and read. Treating it as fresh is safe:
      // the transaction unique constraint is still the final guard.
      return { replayed: false };
    }

    if (existing.requestHash !== requestHash) {
      throw new ConflictException({
        message:
          'This Idempotency-Key was already used with a different request payload. ' +
          'Use a new key for a new request.',
        code: 'IDEMPOTENCY_KEY_REUSED',
      });
    }

    if (existing.status === 'COMPLETED' && existing.responseBody) {
      return {
        replayed: true,
        statusCode: existing.responseStatus ?? 200,
        body: JSON.parse(existing.responseBody) as unknown,
      };
    }

    throw new ConflictException({
      message: 'A request with this Idempotency-Key is still being processed. Retry shortly.',
      code: 'IDEMPOTENT_REQUEST_IN_PROGRESS',
    });
  }

  /** Stores the response so a later retry with the same key replays it. */
  async complete(
    organisationId: string,
    key: string,
    statusCode: number,
    body: unknown,
  ): Promise<void> {
    const db = this.tenantPrisma.forOrganisation(organisationId);
    await db.idempotencyRecord.updateMany({
      where: { key },
      data: {
        status: 'COMPLETED',
        responseStatus: statusCode,
        responseBody: JSON.stringify(body),
        completedAt: new Date(),
      },
    });
  }

  /** Releases a key whose request failed, so the caller can retry it. */
  async abandon(organisationId: string, key: string): Promise<void> {
    const db = this.tenantPrisma.forOrganisation(organisationId);
    await db.idempotencyRecord.deleteMany({ where: { key, status: 'IN_PROGRESS' } });
  }
}
