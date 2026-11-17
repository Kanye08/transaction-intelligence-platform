import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { PrismaService } from '../src/common/prisma/prisma.service';
import { TenantPrismaService } from '../src/common/tenancy/tenant-prisma.service';
import { createTestApp } from './app-factory';
import { bearer, login, resetDatabase, seedTwoTenants, SeededTenants } from './fixtures';

/**
 * Isolation is a security property, so it is tested from the outside (through
 * the HTTP API, with real tokens) and from the inside (through the scoped
 * Prisma client that every service is required to use).
 */
describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: TenantPrismaService;
  let tenants: SeededTenants;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    tenantPrisma = app.get(TenantPrismaService);
    await resetDatabase(prisma);
    tenants = await seedTwoTenants(prisma);
    tokenA = await login(app, tenants.orgA.email);
    tokenB = await login(app, tenants.orgB.email);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists only the accounts of the caller organisation', async () => {
    const responseA = await request(app.getHttpServer())
      .get('/api/accounts')
      .set('Authorization', bearer(tokenA))
      .expect(200);

    const ids = responseA.body.map((account: { id: string }) => account.id);
    expect(ids.sort()).toEqual(tenants.orgA.accountIds.sort());
    expect(ids).not.toContain(tenants.orgB.accountIds[0]);
  });

  it("returns 404, not 403, for another organisation's account", async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/accounts/${tenants.orgB.accountIds[0]}`)
      .set('Authorization', bearer(tokenA))
      .expect(404);

    // The response must not reveal that the resource exists elsewhere.
    expect(JSON.stringify(response.body)).not.toContain(tenants.orgB.id);
    expect(response.body.detail).toBe('Account not found');
  });

  it('ignores an organisation id supplied by the client', async () => {
    // Query string, body and header are all attacker-controlled; the tenant
    // comes from the verified token only.
    await request(app.getHttpServer())
      .get(`/api/accounts/${tenants.orgB.accountIds[0]}?organisationId=${tenants.orgB.id}`)
      .set('Authorization', bearer(tokenA))
      .set('x-organisation-id', tenants.orgB.id)
      .expect(404);

    const stillScoped = await request(app.getHttpServer())
      .get(`/api/accounts?organisationId=${tenants.orgB.id}`)
      .set('Authorization', bearer(tokenA))
      .expect(200);

    expect(stillScoped.body).toHaveLength(tenants.orgA.accountIds.length);
  });

  it('keeps /auth/me inside the caller organisation', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', bearer(tokenB))
      .expect(200);

    expect(response.body.organisation.id).toBe(tenants.orgB.id);
  });

  describe('scoped Prisma client', () => {
    it('cannot read another tenant rows even when asked by id', async () => {
      const dbA = tenantPrisma.forOrganisation(tenants.orgA.id);

      const foreignAccount = await dbA.account.findFirst({
        where: { id: tenants.orgB.accountIds[0] },
      });
      expect(foreignAccount).toBeNull();

      const foreignUnique = await dbA.account.findUnique({
        where: { id: tenants.orgB.accountIds[0] },
      });
      expect(foreignUnique).toBeNull();

      const all = await dbA.account.findMany();
      expect(all.every((account) => account.organisationId === tenants.orgA.id)).toBe(true);
    });

    it('cannot update or delete another tenant rows', async () => {
      const dbA = tenantPrisma.forOrganisation(tenants.orgA.id);

      const updated = await dbA.account.updateMany({
        where: { id: tenants.orgB.accountIds[0] },
        data: { name: 'Hijacked' },
      });
      expect(updated.count).toBe(0);

      const deleted = await dbA.account.deleteMany({
        where: { id: tenants.orgB.accountIds[0] },
      });
      expect(deleted.count).toBe(0);

      const untouched = await prisma.account.findUnique({
        where: { id: tenants.orgB.accountIds[0] },
      });
      expect(untouched?.name).not.toBe('Hijacked');
    });

    it('overrides an organisation id passed into a query or a write', async () => {
      const dbA = tenantPrisma.forOrganisation(tenants.orgA.id);

      // Even if a service were to pass the wrong tenant explicitly, the scope
      // wins: the filter is overwritten rather than merged, so the query can
      // only ever return rows belonging to the caller.
      const spoofedRead = await dbA.account.findMany({
        where: { organisationId: tenants.orgB.id },
      });
      expect(spoofedRead.every((account) => account.organisationId === tenants.orgA.id)).toBe(true);

      const created = await dbA.account.create({
        data: {
          organisationId: tenants.orgB.id,
          name: 'Smuggled account',
          bankName: 'UBA',
          accountNumber: '9999999999',
        },
      });
      expect(created.organisationId).toBe(tenants.orgA.id);

      await prisma.account.delete({ where: { id: created.id } });
    });

    it('counts and aggregates only within the tenant', async () => {
      const dbA = tenantPrisma.forOrganisation(tenants.orgA.id);
      const dbB = tenantPrisma.forOrganisation(tenants.orgB.id);

      expect(await dbA.account.count()).toBe(tenants.orgA.accountIds.length);
      expect(await dbB.account.count()).toBe(tenants.orgB.accountIds.length);
      expect(await prisma.account.count()).toBe(
        tenants.orgA.accountIds.length + tenants.orgB.accountIds.length,
      );
    });
  });
});
