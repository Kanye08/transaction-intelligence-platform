import { Injectable, InternalServerErrorException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Tenant isolation, enforced in one place.
 *
 * Instead of every service remembering to add `organisationId` to every query,
 * callers obtain a scoped client from here. A Prisma client extension injects
 * the tenant filter into every operation on every tenant-owned model, and
 * refuses to run operations it does not know how to scope. Forgetting the
 * filter is therefore not something a service *can* do: the only way to reach
 * tenant data is through a client that already carries the boundary.
 *
 * The organisation id always comes from the verified JWT (see JwtAuthGuard),
 * never from a request body, query string or path parameter.
 */

/** Models that belong to exactly one organisation. */
const TENANT_MODELS = new Set([
  'User',
  'Account',
  'Transaction',
  'ClassificationEvent',
  'ReviewFlag',
  'Job',
  'IdempotencyRecord',
]);

/** Operations whose `where` must carry the tenant filter. */
const WHERE_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

/** Operations whose `data` must carry the tenant id. */
const DATA_OPERATIONS = new Set(['create', 'createMany']);

type AnyArgs = Record<string, unknown>;

function withTenantData(data: unknown, organisationId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((row) => ({ ...(row as AnyArgs), organisationId }));
  }
  return { ...(data as AnyArgs), organisationId };
}

export type ScopedPrisma = ReturnType<TenantPrismaService['forOrganisation']>;

@Injectable()
export class TenantPrismaService {
  /** Extended clients are cheap but not free; one per tenant is reused. */
  private readonly cache = new Map<string, ReturnType<TenantPrismaService['build']>>();

  constructor(private readonly prisma: PrismaService) {}

  /** The unscoped client, for the few genuinely cross-tenant operations
   *  (login by email, the background worker claiming jobs). Every use is
   *  deliberate and reviewed. */
  get raw(): PrismaService {
    return this.prisma;
  }

  forOrganisation(organisationId: string) {
    if (!organisationId) {
      throw new InternalServerErrorException('Tenant scope requested without an organisation id');
    }
    const cached = this.cache.get(organisationId);
    if (cached) return cached;

    const client = this.build(organisationId);
    this.cache.set(organisationId, client);
    return client;
  }

  private build(organisationId: string) {
    return this.prisma.$extends({
      name: 'tenant-scope',
      query: {
        $allModels: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          async $allOperations({ model, operation, args, query }: any) {
            if (!TENANT_MODELS.has(model)) {
              return query(args);
            }

            if (WHERE_OPERATIONS.has(operation)) {
              const next: AnyArgs = { ...(args as AnyArgs) };
              next['where'] = { ...((args as AnyArgs)['where'] as AnyArgs | undefined), organisationId };
              return query(next);
            }

            if (DATA_OPERATIONS.has(operation)) {
              const next: AnyArgs = { ...(args as AnyArgs) };
              next['data'] = withTenantData((args as AnyArgs)['data'], organisationId);
              return query(next);
            }

            if (operation === 'upsert') {
              const next: AnyArgs = { ...(args as AnyArgs) };
              next['where'] = { ...((args as AnyArgs)['where'] as AnyArgs | undefined), organisationId };
              next['create'] = withTenantData((args as AnyArgs)['create'], organisationId);
              return query(next);
            }

            // Unknown operation: fail loudly rather than silently run unscoped.
            throw new InternalServerErrorException(
              `Operation "${operation}" on tenant model "${model}" has no tenant-scoping rule`,
            );
          },
        },
      },
    });
  }
}
