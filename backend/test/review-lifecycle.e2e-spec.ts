import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { PrismaService } from '../src/common/prisma/prisma.service';
import { ReviewDetectionService } from '../src/modules/review/review-detection.service';
import { createTestApp } from './app-factory';
import { bearer, login, resetDatabase, seedTwoTenants, SeededTenants } from './fixtures';

describe('Transaction review (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let detection: ReviewDetectionService;
  let tenants: SeededTenants;
  let tokenA: string;
  let tokenB: string;
  let counter = 0;

  const createTransaction = async (overrides: Record<string, unknown> = {}) => {
    counter += 1;
    return prisma.transaction.create({
      data: {
        organisationId: tenants.orgA.id,
        accountId: tenants.orgA.accountIds[0]!,
        externalReference: `RVW-${counter}`,
        amountMinor: 50_000_00n,
        currency: 'NGN',
        direction: 'OUTFLOW',
        description: 'Payment to Dangote Cement Plc',
        merchant: 'Dangote Cement',
        transactionDate: new Date('2026-04-10T10:00:00.000Z'),
        classificationStatus: 'CLASSIFIED',
        category: 'OTHER',
        confidence: 0.92,
        ...overrides,
      },
    });
  };

  const flagsFor = (transactionId: string) =>
    prisma.reviewFlag.findMany({ where: { transactionId } });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    detection = app.get(ReviewDetectionService);
    await resetDatabase(prisma);
    tenants = await seedTwoTenants(prisma);
    tokenA = await login(app, tenants.orgA.email);
    tokenB = await login(app, tenants.orgB.email);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('A. possible duplicate', () => {
    it('flags the same amount paid twice under different references', async () => {
      const first = await createTransaction({
        description: 'Payment to Dangote Cement REF 88213',
        transactionDate: new Date('2026-05-01T09:00:00.000Z'),
      });
      const second = await createTransaction({
        description: 'Payment to Dangote Cement REF 99120',
        transactionDate: new Date('2026-05-01T17:00:00.000Z'),
      });

      await detection.runForTransaction(tenants.orgA.id, second.id);
      const [flag] = await flagsFor(second.id);

      expect(flag?.rule).toBe('DUPLICATE_SUSPECTED');
      expect(flag?.severity).toBe('HIGH');
      expect(flag?.explanation).toContain('Possible duplicate payment');
      expect(flag?.explanation).toContain('₦50,000.00');

      const details = JSON.parse(flag!.details!);
      expect(details.matchedTransactionId).toBe(first.id);
      expect(details.hoursApart).toBe(8);
    });

    it('ignores the same amount days apart', async () => {
      await createTransaction({
        description: 'Monthly cleaning service',
        transactionDate: new Date('2026-06-01T09:00:00.000Z'),
        amountMinor: 77_000_00n,
      });
      const later = await createTransaction({
        description: 'Monthly cleaning service',
        transactionDate: new Date('2026-06-20T09:00:00.000Z'),
        amountMinor: 77_000_00n,
      });

      await detection.runForTransaction(tenants.orgA.id, later.id);
      const flags = await flagsFor(later.id);
      expect(flags.map((f) => f.rule)).not.toContain('DUPLICATE_SUSPECTED');
    });

    it('ignores unrelated payments of the same amount', async () => {
      await createTransaction({
        description: 'Diesel supply for generator',
        transactionDate: new Date('2026-07-01T09:00:00.000Z'),
        amountMinor: 31_000_00n,
      });
      const other = await createTransaction({
        description: 'Staff training workshop fee',
        transactionDate: new Date('2026-07-01T14:00:00.000Z'),
        amountMinor: 31_000_00n,
      });

      await detection.runForTransaction(tenants.orgA.id, other.id);
      expect((await flagsFor(other.id)).map((f) => f.rule)).not.toContain('DUPLICATE_SUSPECTED');
    });
  });

  describe('B. unusually large', () => {
    it('says nothing when there is not enough history to judge', async () => {
      const account = await prisma.account.create({
        data: {
          organisationId: tenants.orgA.id,
          name: 'Fresh Account',
          bankName: 'UBA',
          accountNumber: '0199999999',
        },
      });

      const big = await prisma.transaction.create({
        data: {
          organisationId: tenants.orgA.id,
          accountId: account.id,
          externalReference: 'NEW-ACCOUNT-BIG',
          amountMinor: 9_000_000_00n,
          currency: 'NGN',
          direction: 'OUTFLOW',
          description: 'First ever payment',
          transactionDate: new Date('2026-04-15T10:00:00.000Z'),
          classificationStatus: 'CLASSIFIED',
          category: 'OTHER',
          confidence: 0.9,
        },
      });

      await detection.runForTransaction(tenants.orgA.id, big.id);
      expect((await flagsFor(big.id)).map((f) => f.rule)).not.toContain('UNUSUALLY_LARGE');
    });

    it('flags an outlier once there is a baseline', async () => {
      const account = await prisma.account.create({
        data: {
          organisationId: tenants.orgA.id,
          name: 'Busy Account',
          bankName: 'Access Bank',
          accountNumber: '0188888888',
        },
      });

      await prisma.transaction.createMany({
        data: Array.from({ length: 30 }, (_, index) => ({
          organisationId: tenants.orgA.id,
          accountId: account.id,
          externalReference: `BASE-${index}`,
          amountMinor: BigInt(40_000_00 + index * 500_00),
          currency: 'NGN',
          direction: 'OUTFLOW',
          description: `Routine supplier payment ${index}`,
          transactionDate: new Date(Date.UTC(2026, 3, 1 + (index % 25), 10)),
          classificationStatus: 'CLASSIFIED',
          category: 'OTHER',
          confidence: 0.9,
        })),
      });

      const outlier = await prisma.transaction.create({
        data: {
          organisationId: tenants.orgA.id,
          accountId: account.id,
          externalReference: 'OUTLIER-1',
          amountMinor: 12_000_000_00n,
          currency: 'NGN',
          direction: 'OUTFLOW',
          description: 'Equipment purchase',
          transactionDate: new Date('2026-04-28T10:00:00.000Z'),
          classificationStatus: 'CLASSIFIED',
          category: 'OTHER',
          confidence: 0.9,
        },
      });

      await detection.runForTransaction(tenants.orgA.id, outlier.id);
      const flag = (await flagsFor(outlier.id)).find((f) => f.rule === 'UNUSUALLY_LARGE');

      expect(flag).toBeDefined();
      expect(flag?.explanation).toContain('unusually large');
      expect(flag?.explanation).toContain('standard deviations');

      const details = JSON.parse(flag!.details!);
      expect(details.sampleSize).toBeGreaterThanOrEqual(20);
      expect(Number(details.zScore)).toBeGreaterThan(3);
      // The maths is reported in exact kobo strings, never floats.
      expect(typeof details.meanMinor).toBe('string');
    });
  });

  describe('C. low confidence', () => {
    it('flags a classification below the review threshold', async () => {
      const uncertain = await createTransaction({
        description: 'Unclear vendor payment',
        merchant: 'Unknown Ltd',
        confidence: 0.31,
        classificationStatus: 'PROVISIONAL',
        transactionDate: new Date('2026-08-01T10:00:00.000Z'),
      });

      await detection.runForTransaction(tenants.orgA.id, uncertain.id);
      const flag = (await flagsFor(uncertain.id)).find((f) => f.rule === 'LOW_CONFIDENCE');

      expect(flag?.explanation).toContain('31% confidence');
      expect(flag?.explanation).toContain('should be confirmed by a person');
    });

    it('leaves a confident classification alone', async () => {
      const confident = await createTransaction({
        description: 'Confident payment',
        merchant: 'Known Ltd',
        confidence: 0.97,
        transactionDate: new Date('2026-08-02T10:00:00.000Z'),
      });

      await detection.runForTransaction(tenants.orgA.id, confident.id);
      expect((await flagsFor(confident.id)).map((f) => f.rule)).not.toContain('LOW_CONFIDENCE');
    });
  });

  describe('D. unusual frequency', () => {
    it('flags repeated payments to the same counterparty in the window', async () => {
      const base = Date.UTC(2026, 8, 1, 8);
      await prisma.transaction.createMany({
        data: Array.from({ length: 6 }, (_, index) => ({
          organisationId: tenants.orgA.id,
          accountId: tenants.orgA.accountIds[1]!,
          externalReference: `FREQ-${index}`,
          amountMinor: 2_500_00n,
          currency: 'NGN',
          direction: 'OUTFLOW',
          description: 'Airtime top-up',
          merchant: 'QuickTopup NG',
          transactionDate: new Date(base + index * 60 * 60 * 1000),
          classificationStatus: 'CLASSIFIED',
          category: 'UTILITIES',
          confidence: 0.9,
        })),
      });

      const last = await prisma.transaction.create({
        data: {
          organisationId: tenants.orgA.id,
          accountId: tenants.orgA.accountIds[1]!,
          externalReference: 'FREQ-LAST',
          amountMinor: 2_500_00n,
          currency: 'NGN',
          direction: 'OUTFLOW',
          description: 'Airtime top-up',
          merchant: 'QuickTopup NG',
          transactionDate: new Date(base + 7 * 60 * 60 * 1000),
          classificationStatus: 'CLASSIFIED',
          category: 'UTILITIES',
          confidence: 0.9,
        },
      });

      await detection.runForTransaction(tenants.orgA.id, last.id);
      const flag = (await flagsFor(last.id)).find((f) => f.rule === 'UNUSUAL_FREQUENCY');

      expect(flag?.explanation).toContain('QuickTopup NG');
      expect(flag?.explanation).toContain('retry loop or duplicated billing');
      expect(JSON.parse(flag!.details!).occurrences).toBeGreaterThan(5);
    });
  });

  describe('detection is repeatable', () => {
    it('does not pile up duplicate flags when it runs again', async () => {
      const transaction = await createTransaction({
        description: 'Repeat detection check',
        confidence: 0.2,
        classificationStatus: 'PROVISIONAL',
        transactionDate: new Date('2026-09-10T10:00:00.000Z'),
      });

      await detection.runForTransaction(tenants.orgA.id, transaction.id);
      await detection.runForTransaction(tenants.orgA.id, transaction.id);
      await detection.runForTransaction(tenants.orgA.id, transaction.id);

      const flags = await flagsFor(transaction.id);
      expect(flags.filter((f) => f.rule === 'LOW_CONFIDENCE')).toHaveLength(1);
    });
  });

  describe('review queue', () => {
    it('lists open flags with their explanation and transaction', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/review/flags?status=OPEN&limit=100')
        .set('Authorization', bearer(tokenA))
        .expect(200);

      expect(response.body.total).toBeGreaterThan(0);
      const [first] = response.body.data;
      expect(first.explanation.length).toBeGreaterThan(20);
      expect(first.transaction).toMatchObject({
        formattedAmount: expect.stringContaining('₦'),
      });
      expect(typeof first.transaction.amountMinor).toBe('string');
    });

    it('filters by rule and severity', async () => {
      const duplicates = await request(app.getHttpServer())
        .get('/api/review/flags?rule=DUPLICATE_SUSPECTED')
        .set('Authorization', bearer(tokenA))
        .expect(200);

      expect(
        duplicates.body.data.every((f: { rule: string }) => f.rule === 'DUPLICATE_SUSPECTED'),
      ).toBe(true);

      const high = await request(app.getHttpServer())
        .get('/api/review/flags?severity=HIGH')
        .set('Authorization', bearer(tokenA))
        .expect(200);

      expect(high.body.data.every((f: { severity: string }) => f.severity === 'HIGH')).toBe(true);
    });

    it('rejects an unknown filter value', async () => {
      await request(app.getHttpServer())
        .get('/api/review/flags?rule=NOT_A_RULE')
        .set('Authorization', bearer(tokenA))
        .expect(400);
    });

    it('summarises the queue for the dashboard', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/review/summary')
        .set('Authorization', bearer(tokenA))
        .expect(200);

      expect(response.body.open).toBeGreaterThan(0);
      expect(Object.keys(response.body.byRule).length).toBeGreaterThan(0);
    });

    it('records who resolved a flag, when and why', async () => {
      const open = await prisma.reviewFlag.findFirstOrThrow({
        where: { organisationId: tenants.orgA.id, status: 'OPEN' },
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/review/flags/${open.id}`)
        .set('Authorization', bearer(tokenA))
        .send({ action: 'RESOLVE', note: 'Confirmed with the supplier, payment was correct' })
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'RESOLVED',
        resolvedBy: 'Ada Obi',
        resolutionNote: 'Confirmed with the supplier, payment was correct',
      });
      expect(response.body.resolvedAt).not.toBeNull();
    });

    it('dismisses a false positive', async () => {
      const open = await prisma.reviewFlag.findFirstOrThrow({
        where: { organisationId: tenants.orgA.id, status: 'OPEN' },
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/review/flags/${open.id}`)
        .set('Authorization', bearer(tokenA))
        .send({ action: 'DISMISS', note: 'Expected seasonal spike' })
        .expect(200);

      expect(response.body.status).toBe('DISMISSED');
    });

    it('refuses to close an already closed flag', async () => {
      const closed = await prisma.reviewFlag.findFirstOrThrow({
        where: { organisationId: tenants.orgA.id, status: { not: 'OPEN' } },
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/review/flags/${closed.id}`)
        .set('Authorization', bearer(tokenA))
        .send({ action: 'RESOLVE' })
        .expect(400);

      expect(response.body.detail).toContain('already');
    });

    it('keeps the queue inside the tenant boundary', async () => {
      const foreign = await prisma.reviewFlag.findFirstOrThrow({
        where: { organisationId: tenants.orgA.id },
      });

      await request(app.getHttpServer())
        .patch(`/api/review/flags/${foreign.id}`)
        .set('Authorization', bearer(tokenB))
        .send({ action: 'DISMISS' })
        .expect(404);

      const otherQueue = await request(app.getHttpServer())
        .get('/api/review/flags?limit=100')
        .set('Authorization', bearer(tokenB))
        .expect(200);

      expect(otherQueue.body.total).toBe(0);
    });
  });
});
