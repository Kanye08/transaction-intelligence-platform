import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './app-factory';
import { bearer, login, resetDatabase, seedTwoTenants, SeededTenants } from './fixtures';

describe('Transaction listing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenants: SeededTenants;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
    tenants = await seedTwoTenants(prisma);
    tokenA = await login(app, tenants.orgA.email);
    tokenB = await login(app, tenants.orgB.email);

    // 40 transactions for org A across two accounts, plus 3 for org B.
    const rows = Array.from({ length: 40 }, (_, index) => ({
      organisationId: tenants.orgA.id,
      accountId: tenants.orgA.accountIds[index % 2]!,
      externalReference: `LIST-${index.toString().padStart(3, '0')}`,
      amountMinor: BigInt((index + 1) * 100_00),
      currency: 'NGN',
      direction: index % 3 === 0 ? 'INFLOW' : 'OUTFLOW',
      description: index % 5 === 0 ? 'IKEDC prepaid electricity token' : `Payment to vendor ${index}`,
      merchant: index % 5 === 0 ? 'IKEDC' : `Vendor ${index}`,
      transactionDate: new Date(Date.UTC(2026, 0, 1 + index, 12, 0, 0)),
      category: index % 5 === 0 ? 'UTILITIES' : 'OTHER',
      classificationStatus: index % 7 === 0 ? 'PENDING' : 'CLASSIFIED',
      confidence: index % 7 === 0 ? null : 0.9,
    }));

    await prisma.transaction.createMany({ data: rows });
    await prisma.transaction.createMany({
      data: Array.from({ length: 3 }, (_, index) => ({
        organisationId: tenants.orgB.id,
        accountId: tenants.orgB.accountIds[0]!,
        externalReference: `OTHER-${index}`,
        amountMinor: 500_00n,
        currency: 'NGN',
        direction: 'OUTFLOW',
        description: 'Diesel for generator',
        merchant: 'Total Energies',
        transactionDate: new Date(Date.UTC(2026, 0, 5, 12, 0, 0)),
        classificationStatus: 'CLASSIFIED',
        category: 'UTILITIES',
      })),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const list = (token: string, query = '') =>
    request(app.getHttpServer())
      .get(`/api/transactions${query}`)
      .set('Authorization', bearer(token));

  it('returns only the caller organisation transactions', async () => {
    const response = await list(tokenA, '?limit=200&includeTotal=true').expect(200);

    expect(response.body.total).toBe(40);
    expect(response.body.data).toHaveLength(40);
    expect(
      response.body.data.every((t: { description: string }) => t.description !== 'Diesel for generator'),
    ).toBe(true);

    const other = await list(tokenB, '?includeTotal=true').expect(200);
    expect(other.body.total).toBe(3);
  });

  it('omits the total unless it is asked for', async () => {
    const response = await list(tokenA).expect(200);
    expect(response.body.total).toBeUndefined();
    expect(response.body.pageInfo).toMatchObject({ limit: 25, hasMore: true });
    expect(response.body.pageInfo.nextCursor).toEqual(expect.any(String));
  });

  it('pages through the whole set without gaps or repeats', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const response: { body: { data: { id: string }[]; pageInfo: { nextCursor: string | null } } } =
        await list(tokenA, `?limit=7${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`).expect(
          200,
        );
      seen.push(...response.body.data.map((t) => t.id));
      cursor = response.body.pageInfo.nextCursor;
      pages += 1;
    } while (cursor && pages < 20);

    expect(seen).toHaveLength(40);
    expect(new Set(seen).size).toBe(40);
  });

  it('orders newest first', async () => {
    const response = await list(tokenA, '?limit=5').expect(200);
    const dates = response.body.data.map((t: { transactionDate: string }) => t.transactionDate);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('rejects a malformed cursor instead of returning wrong data', async () => {
    await list(tokenA, '?cursor=not-a-cursor').expect(400);
  });

  it('filters by account, direction, category and classification status', async () => {
    const byAccount = await list(
      tokenA,
      `?accountId=${tenants.orgA.accountIds[0]}&limit=200&includeTotal=true`,
    ).expect(200);
    expect(byAccount.body.total).toBe(20);

    const inflows = await list(tokenA, '?direction=INFLOW&limit=200&includeTotal=true').expect(200);
    expect(inflows.body.total).toBe(14);
    expect(
      inflows.body.data.every((t: { direction: string }) => t.direction === 'INFLOW'),
    ).toBe(true);

    const utilities = await list(tokenA, '?category=UTILITIES&limit=200&includeTotal=true').expect(200);
    expect(utilities.body.total).toBe(8);

    const pending = await list(
      tokenA,
      '?classificationStatus=PENDING&limit=200&includeTotal=true',
    ).expect(200);
    expect(pending.body.total).toBe(6);
  });

  it('filters by date range and amount range', async () => {
    const dateRange = await list(
      tokenA,
      '?dateFrom=2026-01-01T00:00:00.000Z&dateTo=2026-01-10T23:59:59.000Z&limit=200&includeTotal=true',
    ).expect(200);
    expect(dateRange.body.total).toBe(10);

    const amountRange = await list(
      tokenA,
      '?amountMin=500.00&amountMax=1000.00&limit=200&includeTotal=true',
    ).expect(200);
    expect(amountRange.body.total).toBe(6);
    expect(
      amountRange.body.data.every((t: { amountMinor: string }) => {
        const minor = BigInt(t.amountMinor);
        return minor >= 50_000n && minor <= 100_000n;
      }),
    ).toBe(true);
  });

  it('searches description, merchant and reference', async () => {
    const byMerchant = await list(tokenA, '?search=IKEDC&limit=200&includeTotal=true').expect(200);
    expect(byMerchant.body.total).toBe(8);

    const byDescription = await list(tokenA, '?search=electricity&limit=200&includeTotal=true').expect(
      200,
    );
    expect(byDescription.body.total).toBe(8);

    const byReference = await list(tokenA, '?search=LIST-007&includeTotal=true').expect(200);
    expect(byReference.body.total).toBe(1);
  });

  it('rejects nonsensical filters rather than ignoring them', async () => {
    await list(tokenA, '?direction=SIDEWAYS').expect(400);
    await list(tokenA, '?category=SNACKS').expect(400);
    await list(tokenA, '?amountMin=1,000').expect(400);
    await list(tokenA, '?limit=5000').expect(400);
    await list(tokenA, '?unknownFilter=1').expect(400);
  });

  it('exposes money as strings in every row', async () => {
    const response = await list(tokenA, '?limit=3').expect(200);
    for (const row of response.body.data) {
      expect(typeof row.amount).toBe('string');
      expect(typeof row.amountMinor).toBe('string');
      expect(row.formattedAmount.startsWith('₦')).toBe(true);
    }
  });

  describe('detail', () => {
    it('returns a transaction with its classification block', async () => {
      const [first] = (await list(tokenA, '?limit=1').expect(200)).body.data;
      const response = await request(app.getHttpServer())
        .get(`/api/transactions/${first.id}`)
        .set('Authorization', bearer(tokenA))
        .expect(200);

      expect(response.body.id).toBe(first.id);
      expect(response.body.classification).toHaveProperty('status');
      expect(response.body.reviewFlags).toEqual([]);
    });

    it("returns 404 for another organisation's transaction", async () => {
      const foreign = await prisma.transaction.findFirst({
        where: { organisationId: tenants.orgB.id },
      });

      await request(app.getHttpServer())
        .get(`/api/transactions/${foreign!.id}`)
        .set('Authorization', bearer(tokenA))
        .expect(404);
    });
  });
});
