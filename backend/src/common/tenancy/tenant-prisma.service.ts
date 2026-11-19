import { Injectable, InternalServerErrorException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Tenant isolation, in one place. Callers get a Prisma client extended to inject
 * the organisation filter into every operation on every tenant-owned model, and
 * to refuse operations it does not know how to scope. A service cannot forget
 * the filter, because the only route to tenant data already carries it.
 *
 * The organisation id always comes from the verified JWT, never from a request.
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

  /** Unscoped, for the few genuinely cross-tenant operations: login by email,
   *  and the worker claiming jobs. */
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
