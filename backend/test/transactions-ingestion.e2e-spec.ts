import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './app-factory';
import { bearer, login, resetDatabase, seedTwoTenants, SeededTenants } from './fixtures';

describe('Transaction ingestion (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenants: SeededTenants;
  let tokenA: string;
  let tokenB: string;

  const transaction = (overrides: Record<string, unknown> = {}) => ({
    accountId: tenants.orgA.accountIds[0],
    externalReference: `REF-${Math.random().toString(36).slice(2, 10)}`,
    amount: '12999.75',
    direction: 'OUTFLOW',
    description: 'MTN VTU airtime purchase',
    merchant: 'MTN Nigeria',
    transactionDate: '2026-03-14T09:30:00.000Z',
    ...overrides,
  });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
    tenants = await seedTwoTenants(prisma);
    tokenA = await login(app, tenants.orgA.email);
    tokenB = await login(app, tenants.orgB.email);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('single import', () => {
    it('stores the amount exactly and returns it as strings only', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', bearer(tokenA))
        .send(transaction({ externalReference: 'EXACT-1', amount: '12999.75' }))
        .expect(201);

      expect(response.body.status).toBe('CREATED');
      expect(response.body.transaction).toMatchObject({
        amount: '12999.75',
        amountMinor: '1299975',
        currency: 'NGN',
        formattedAmount: '₦12,999.75',
      });

      // The stored column is an integer number of kobo, not a float.
      const stored = await prisma.transaction.findFirst({
        where: { externalReference: 'EXACT-1' },
      });
      expect(stored?.amountMinor).toBe(1299975n);
    });

    it('accepts credit/debit as aliases for inflow/outflow', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', bearer(tokenA))
        .send(transaction({ externalReference: 'ALIAS-1', direction: 'credit' }))
        .expect(201);

      expect(response.body.transaction.direction).toBe('INFLOW');
    });

    it('persists as PENDING without waiting for any classifier', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', bearer(tokenA))
        .send(transaction({ externalReference: 'PENDING-1' }))
        .expect(201);

      expect(response.body.transaction.classification.status).toBe('PENDING');
      expect(response.body.transaction.classification.category).toBeNull();

      // ...and the follow-up work is durably scheduled in the same commit.
      const job = await prisma.job.findFirst({
        where: {
          type: 'CLASSIFY_TRANSACTION',
          payload: { contains: response.body.transaction.id },
        },
      });
      expect(job).toMatchObject({ status: 'PENDING', organisationId: tenants.orgA.id });
    });

    it.each([
      ['12999.754', 'fractional kobo'],
      ['12,999.75', 'thousands separators'],
      ['-50.00', 'a negative amount'],
      ['0.00', 'zero'],
    ])('rejects %s (%s)', async (amount) => {
      await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', bearer(tokenA))
        .send(transaction({ amount }))
        .expect(400);
    });

    it('rejects a numeric amount outright', async () => {
      await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', bearer(tokenA))
        .send(transaction({ amount: 12999.75 }))
        .expect(400);
    });

    it("refuses to post into another organisation's account", async () => {
      const response = await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', bearer(tokenA))
        .send(transaction({ accountId: tenants.orgB.accountIds[0] }))
        .expect(404);

      expect(response.body.detail).toContain('Account not found');
    });
  });

  describe('duplicate prevention', () => {
    it('returns the existing transaction instead of creating a second one', async () => {
      const payload = transaction({ externalReference: 'DUP-1' });

      const first = await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', bearer(tokenA))
        .send(payload)
        .expect(201);

      const second = await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', bearer(tokenA))
        .send(payload)
        .expect(200);

      expect(second.body.status).toBe('DUPLICATE');
      expect(second.body.transaction.id).toBe(first.body.transaction.id);

      const count = await prisma.transaction.count({ where: { externalReference: 'DUP-1' } });
      expect(count).toBe(1);
    });

    it('lets both tenants use the same external reference independently', async () => {
      const reference = 'SHARED-REF-1';

      await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', bearer(tokenA))
        .send(transaction({ externalReference: reference }))
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', bearer(tokenB))
        .send(transaction({ externalReference: reference, accountId: tenants.orgB.accountIds[0] }))
        .expect(201);

      expect(await prisma.transaction.count({ where: { externalReference: reference } })).toBe(2);
    });

    it('survives concurrent imports of the same transaction', async () => {
      const payload = transaction({ externalReference: 'CONCURRENT-1' });

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(app.getHttpServer())
            .post('/api/transactions')
            .set('Authorization', bearer(tokenA))
            .send(payload),
        ),
      );

      const created = responses.filter((r) => r.body.status === 'CREATED');
      const duplicates = responses.filter((r) => r.body.status === 'DUPLICATE');

      // Exactly one row exists; the database decided, not the application.
      expect(created).toHaveLength(1);
      expect(duplicates).toHaveLength(4);
      expect(await prisma.transaction.count({ where: { externalReference: 'CONCURRENT-1' } })).toBe(1);

      const ids = new Set(responses.map((r) => r.body.transaction.id));
      expect(ids.size).toBe(1);
    });
  });

  describe('idempotency', () => {
    it('replays the original response for a repeated key', async () => {
      const payload = transaction({ externalReference: 'IDEM-1' });

      const first = await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', bearer(tokenA))
        .set('Idempotency-Key', 'key-idem-1')
        .send(payload)
        .expect(201);

      const replay = await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', bearer(tokenA))
        .set('Idempotency-Key', 'key-idem-1')
        .send(payload)
        .expect(201);

      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);
      expect(await prisma.transaction.count({ where: { externalReference: 'IDEM-1' } })).toBe(1);
    });

    it('rejects the same key with a different payload', async () => {
      await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', bearer(tokenA))
        .set('Idempotency-Key', 'key-idem-2')
        .send(transaction({ externalReference: 'IDEM-2', amount: '100.00' }))
        .expect(201);

      const conflict = await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', bearer(tokenA))
        .set('Idempotency-Key', 'key-idem-2')
        .send(transaction({ externalReference: 'IDEM-2', amount: '200.00' }))
        .expect(409);

      expect(conflict.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('scopes keys per organisation', async () => {
      await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', bearer(tokenA))
        .set('Idempotency-Key', 'shared-key')
        .send(transaction({ externalReference: 'IDEM-A' }))
        .expect(201);

      // Same key, different tenant: unaffected.
      await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', bearer(tokenB))
        .set('Idempotency-Key', 'shared-key')
        .send(transaction({ externalReference: 'IDEM-B', accountId: tenants.orgB.accountIds[0] }))
        .expect(201);
    });

    it('creates one transaction when the same key arrives concurrently', async () => {
      const payload = transaction({ externalReference: 'IDEM-CONCURRENT' });

      const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
          request(app.getHttpServer())
            .post('/api/transactions')
            .set('Authorization', bearer(tokenA))
            .set('Idempotency-Key', 'key-concurrent')
            .send(payload),
        ),
      );

      const statuses = responses.map((r) => r.status).sort();
      expect(statuses).toContain(201);
      // Losers are told the request is in flight or get the replayed answer.
      expect(statuses.every((status) => [201, 200, 409].includes(status))).toBe(true);
      expect(
        await prisma.transaction.count({ where: { externalReference: 'IDEM-CONCURRENT' } }),
      ).toBe(1);
    });

    it('releases the key when the request itself failed', async () => {
      const bad = transaction({ accountId: 'no-such-account', externalReference: 'IDEM-FAIL' });

      await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', bearer(tokenA))
        .set('Idempotency-Key', 'key-retry')
        .send(bad)
        .expect(404);

      // Same key may now be retried with a corrected payload.
      await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', bearer(tokenA))
        .set('Idempotency-Key', 'key-retry')
        .send(transaction({ externalReference: 'IDEM-FAIL' }))
        .expect(201);
    });
  });

  describe('batch import', () => {
    it('processes valid rows and reports the failures individually', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/transactions/batch')
        .set('Authorization', bearer(tokenA))
        .send({
          transactions: [
            transaction({ externalReference: 'BATCH-1' }),
            transaction({ externalReference: 'BATCH-2', amount: '1.01' }),
            transaction({ externalReference: 'BATCH-3', amount: 'not-money' }),
            transaction({ externalReference: 'BATCH-4', direction: 'SIDEWAYS' }),
            transaction({ externalReference: 'BATCH-5', accountId: tenants.orgB.accountIds[0] }),
            transaction({ externalReference: 'BATCH-1' }),
          ],
        })
        .expect(207);

      expect(response.body.summary).toEqual({ total: 6, created: 2, duplicates: 1, failed: 3 });

      const byReference = Object.fromEntries(
        response.body.results.map((r: { externalReference: string; status: string }) => [
          r.externalReference,
          r.status,
        ]),
      );
      expect(byReference).toMatchObject({
        'BATCH-1': 'DUPLICATE', // second occurrence overwrites in the map
        'BATCH-2': 'CREATED',
        'BATCH-3': 'FAILED',
        'BATCH-4': 'FAILED',
        'BATCH-5': 'FAILED',
      });

      // The valid rows really are in the database.
      expect(await prisma.transaction.count({ where: { externalReference: 'BATCH-1' } })).toBe(1);
      expect(await prisma.transaction.count({ where: { externalReference: 'BATCH-2' } })).toBe(1);
      expect(await prisma.transaction.count({ where: { externalReference: 'BATCH-3' } })).toBe(0);
    });

    it('explains why each row failed', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/transactions/batch')
        .set('Authorization', bearer(tokenA))
        .send({ transactions: [transaction({ externalReference: 'BATCH-ERR', amount: '1.234' })] })
        .expect(207);

      expect(response.body.results[0].errors[0]).toMatch(/decimal string/);
    });

    it('rejects an empty or oversized batch envelope', async () => {
      await request(app.getHttpServer())
        .post('/api/transactions/batch')
        .set('Authorization', bearer(tokenA))
        .send({ transactions: [] })
        .expect(400);

      await request(app.getHttpServer())
        .post('/api/transactions/batch')
        .set('Authorization', bearer(tokenA))
        .send({ transactions: Array.from({ length: 501 }, () => transaction()) })
        .expect(400);
    });

    it('schedules classification for every created row', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/transactions/batch')
        .set('Authorization', bearer(tokenA))
        .send({
          transactions: [
            transaction({ externalReference: 'BATCH-JOB-1' }),
            transaction({ externalReference: 'BATCH-JOB-2' }),
          ],
        })
        .expect(207);

      const created = response.body.results.filter(
        (r: { status: string }) => r.status === 'CREATED',
      );
      expect(created).toHaveLength(2);

      for (const row of created) {
        const job = await prisma.job.findFirst({
          where: { type: 'CLASSIFY_TRANSACTION', payload: { contains: row.transactionId } },
        });
        expect(job).not.toBeNull();
      }
    });
  });
});
