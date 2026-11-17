import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './app-factory';
import { bearer, login, resetDatabase, seedTwoTenants, SeededTenants } from './fixtures';

describe('Dashboard aggregates (e2e)', () => {
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

    // Known figures: inflow 1,500,000.50  outflow 451,000.75  net 1,048,999.75
    await prisma.transaction.createMany({
      data: [
        {
          organisationId: tenants.orgA.id,
          accountId: tenants.orgA.accountIds[0]!,
          externalReference: 'DASH-IN-1',
          amountMinor: 100_000_025n, // 1,000,000.25
          currency: 'NGN',
          direction: 'INFLOW',
          description: 'Paystack settlement',
          merchant: 'Paystack',
          transactionDate: new Date('2026-02-10T10:00:00.000Z'),
          category: 'REVENUE',
          classificationStatus: 'CLASSIFIED',
          confidence: 0.95,
        },
        {
          organisationId: tenants.orgA.id,
          accountId: tenants.orgA.accountIds[0]!,
          externalReference: 'DASH-IN-2',
          amountMinor: 50_000_025n, // 500,000.25
          currency: 'NGN',
          direction: 'INFLOW',
          description: 'Invoice payment from customer',
          transactionDate: new Date('2026-02-15T10:00:00.000Z'),
          category: 'REVENUE',
          classificationStatus: 'CLASSIFIED',
          confidence: 0.9,
        },
        {
          organisationId: tenants.orgA.id,
          accountId: tenants.orgA.accountIds[0]!,
          externalReference: 'DASH-OUT-1',
          amountMinor: 30_000_050n, // 300,000.50
          currency: 'NGN',
          direction: 'OUTFLOW',
          description: 'Salary payment',
          transactionDate: new Date('2026-02-25T10:00:00.000Z'),
          category: 'PAYROLL',
          classificationStatus: 'CLASSIFIED',
          confidence: 0.97,
        },
        {
          organisationId: tenants.orgA.id,
          accountId: tenants.orgA.accountIds[1]!,
          externalReference: 'DASH-OUT-2',
          amountMinor: 15_000_025n, // 150,000.25
          currency: 'NGN',
          direction: 'OUTFLOW',
          description: 'AWS invoice',
          transactionDate: new Date('2026-03-02T10:00:00.000Z'),
          category: 'SOFTWARE',
          classificationStatus: 'PROVISIONAL',
          confidence: 0.55,
        },
        {
          organisationId: tenants.orgA.id,
          accountId: tenants.orgA.accountIds[1]!,
          externalReference: 'DASH-PENDING',
          amountMinor: 1_000_00n,
          currency: 'NGN',
          direction: 'OUTFLOW',
          description: 'Unclassified payment',
          transactionDate: new Date('2026-03-03T10:00:00.000Z'),
          classificationStatus: 'PENDING',
        },
        // Another tenant: must never appear in org A figures.
        {
          organisationId: tenants.orgB.id,
          accountId: tenants.orgB.accountIds[0]!,
          externalReference: 'DASH-OTHER',
          amountMinor: 999_999_999n,
          currency: 'NGN',
          direction: 'INFLOW',
          description: 'Other tenant revenue',
          transactionDate: new Date('2026-02-20T10:00:00.000Z'),
          category: 'REVENUE',
          classificationStatus: 'CLASSIFIED',
          confidence: 0.99,
        },
      ],
    });

    await prisma.reviewFlag.create({
      data: {
        organisationId: tenants.orgA.id,
        transactionId: (await prisma.transaction.findFirstOrThrow({
          where: { externalReference: 'DASH-OUT-2' },
        })).id,
        rule: 'LOW_CONFIDENCE',
        severity: 'LOW',
        explanation: 'Confidence below threshold',
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const summary = (token: string, query = '') =>
    request(app.getHttpServer())
      .get(`/api/dashboard/summary${query}`)
      .set('Authorization', bearer(token));

  it('totals inflows, outflows and net cash flow exactly', async () => {
    const response = await summary(tokenA).expect(200);

    expect(response.body.totals.inflow).toMatchObject({
      amount: '1500000.50',
      amountMinor: '150000050',
      formattedAmount: '₦1,500,000.50',
    });
    expect(response.body.totals.outflow).toMatchObject({
      amount: '451000.75',
      amountMinor: '45100075',
    });
    // Net is inflow minus outflow, to the kobo.
    expect(response.body.totals.net).toMatchObject({
      amount: '1048999.75',
      amountMinor: '104899975',
    });
    expect(response.body.totals.transactionCount).toBe(5);
  });

  it('never mixes another organisation into the figures', async () => {
    const other = await summary(tokenB).expect(200);

    expect(other.body.totals.inflow.amount).toBe('9999999.99');
    expect(other.body.totals.outflow.amount).toBe('0.00');
    expect(other.body.review.openFlags).toBe(0);
  });

  it('breaks spending down by category with percentages', async () => {
    const response = await summary(tokenA).expect(200);
    const byCategory = response.body.spendingByCategory;

    const payroll = byCategory.find((row: { category: string }) => row.category === 'PAYROLL');
    expect(payroll).toMatchObject({
      label: 'Payroll',
      amount: '300000.50',
      transactionCount: 1,
    });
    expect(payroll.percentage).toBeCloseTo(66.5, 0);

    // Unclassified spend is shown rather than hidden.
    const unclassified = byCategory.find(
      (row: { category: string }) => row.category === 'UNCLASSIFIED',
    );
    expect(unclassified.label).toBe('Awaiting classification');

    // Largest first.
    const amounts = byCategory.map((row: { amountMinor: string }) => BigInt(row.amountMinor));
    expect([...amounts].sort((a, b) => (b > a ? 1 : -1))).toEqual(amounts);
  });

  it('reports classification status and the review backlog', async () => {
    const response = await summary(tokenA).expect(200);

    expect(response.body.classificationStatus).toMatchObject({
      CLASSIFIED: 3,
      PROVISIONAL: 1,
      PENDING: 1,
    });
    expect(response.body.review).toMatchObject({
      openFlags: 1,
      byRule: { LOW_CONFIDENCE: 1 },
    });
  });

  it('respects a date range', async () => {
    const february = await summary(
      tokenA,
      '?dateFrom=2026-02-01T00:00:00.000Z&dateTo=2026-02-28T23:59:59.000Z',
    ).expect(200);

    expect(february.body.totals.inflow.amount).toBe('1500000.50');
    expect(february.body.totals.outflow.amount).toBe('300000.50');
    expect(february.body.totals.transactionCount).toBe(3);
    expect(february.body.range).toEqual({
      from: '2026-02-01T00:00:00.000Z',
      to: '2026-02-28T23:59:59.000Z',
    });
  });

  it('can be narrowed to one account', async () => {
    const response = await summary(tokenA, `?accountId=${tenants.orgA.accountIds[1]}`).expect(200);
    expect(response.body.totals.inflow.amount).toBe('0.00');
    expect(response.body.totals.outflow.amount).toBe('151000.25');
  });

  it('handles an empty period without breaking', async () => {
    const response = await summary(
      tokenA,
      '?dateFrom=2030-01-01T00:00:00.000Z&dateTo=2030-12-31T00:00:00.000Z',
    ).expect(200);

    expect(response.body.totals).toMatchObject({
      inflow: { amount: '0.00', formattedAmount: '₦0.00' },
      outflow: { amount: '0.00' },
      net: { amount: '0.00' },
      transactionCount: 0,
    });
    expect(response.body.spendingByCategory).toEqual([]);
    expect(response.body.recentTransactions).toEqual([]);
  });

  it('includes recent activity for the dashboard feed', async () => {
    const response = await summary(tokenA).expect(200);
    expect(response.body.recentTransactions.length).toBeGreaterThan(0);
    expect(response.body.recentTransactions[0]).toMatchObject({
      formattedAmount: expect.stringContaining('₦'),
    });
  });

  it('rejects an invalid date filter', async () => {
    await summary(tokenA, '?dateFrom=last-tuesday').expect(400);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/dashboard/summary').expect(401);
  });
});
