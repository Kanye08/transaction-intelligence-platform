import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { PrismaService } from '../src/common/prisma/prisma.service';
import { HybridClassificationProvider } from '../src/modules/classification/providers/hybrid.provider';
import { MockLlmClassificationProvider } from '../src/modules/classification/providers/mock-llm.provider';
import { JobsWorker } from '../src/modules/jobs/jobs.worker';
import { createTestApp } from './app-factory';
import { bearer, login, resetDatabase, seedTwoTenants, SeededTenants } from './fixtures';

/**
 * The classification pipeline end to end: ingest, queue, classify, audit,
 * flag, correct - including every way the provider can let us down.
 */
describe('Classification pipeline (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: JobsWorker;
  let llm: MockLlmClassificationProvider;
  let hybrid: HybridClassificationProvider;
  let tenants: SeededTenants;
  let tokenA: string;
  let tokenB: string;
  let counter = 0;

  const ingest = async (
    token: string,
    overrides: Record<string, unknown> = {},
    accountId?: string,
  ) => {
    counter += 1;
    const response = await request(app.getHttpServer())
      .post('/api/transactions')
      .set('Authorization', bearer(token))
      .send({
        accountId: accountId ?? tenants.orgA.accountIds[0],
        externalReference: `CLS-${counter}`,
        amount: '45000.00',
        direction: 'OUTFLOW',
        description: 'Salary payment for March 2026',
        merchant: null,
        transactionDate: '2026-03-25T10:00:00.000Z',
        ...overrides,
      })
      .expect(201);
    return response.body.transaction.id as string;
  };

  const reload = (id: string) => prisma.transaction.findUniqueOrThrow({ where: { id } });
  const jobFor = (id: string) =>
    prisma.job.findFirstOrThrow({
      where: { type: 'CLASSIFY_TRANSACTION', payload: { contains: id } },
      orderBy: { createdAt: 'desc' },
    });

  /** Retries scheduled with backoff are due immediately, for the test. */
  const makeRetriesDue = () =>
    prisma.job.updateMany({ where: { status: 'PENDING' }, data: { runAt: new Date(0) } });

  /** Same, but only for one transaction's job. */
  const makeJobDue = (transactionId: string) =>
    prisma.job.updateMany({
      where: { status: 'PENDING', payload: { contains: transactionId } },
      data: { runAt: new Date(0) },
    });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    worker = app.get(JobsWorker);
    llm = app.get(MockLlmClassificationProvider);
    hybrid = app.get(HybridClassificationProvider);
    await resetDatabase(prisma);
    tenants = await seedTwoTenants(prisma);
    tokenA = await login(app, tenants.orgA.email);
    tokenB = await login(app, tenants.orgB.email);
  });

  beforeEach(() => {
    llm.setMode('normal');
    llm.resetCallCount();
    hybrid.resetMetrics();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('happy path', () => {
    it('classifies a transaction the rules understand, without calling the model', async () => {
      const id = await ingest(tokenA);
      await worker.drain();

      const transaction = await reload(id);
      expect(transaction.classificationStatus).toBe('CLASSIFIED');
      expect(transaction.category).toBe('PAYROLL');
      expect(transaction.classificationSource).toBe('RULES');
      expect(transaction.confidence).toBeGreaterThan(0.9);
      expect(transaction.classifiedAt).not.toBeNull();

      // Cost control: a confident rule never reaches the LLM.
      expect(llm.callCount).toBe(0);
    });

    it('records an audit event for the automated decision', async () => {
      const id = await ingest(tokenA, { description: 'IKEDC prepaid token purchase' });
      await worker.drain();

      const response = await request(app.getHttpServer())
        .get(`/api/transactions/${id}/classification-history`)
        .set('Authorization', bearer(tokenA))
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toMatchObject({
        previousCategory: null,
        newCategory: 'UTILITIES',
        source: 'RULES',
        actor: null,
      });
      expect(response.body[0].reason).toContain('matched');
    });

    it('escalates an ambiguous transaction to the model', async () => {
      const id = await ingest(tokenA, {
        description: 'Payment for consultant retainer',
        merchant: 'Olu & Co',
      });
      await worker.drain();

      expect(llm.callCount).toBe(1);
      const transaction = await reload(id);
      expect(transaction.classificationSource).toBe('LLM');
      expect(transaction.category).not.toBeNull();
    });

    it('marks a low-confidence result provisional and flags it for review', async () => {
      llm.setMode('low_confidence');
      const id = await ingest(tokenA, {
        description: 'Zxqy unknown vendor payment',
        merchant: 'Unknown Ltd',
      });
      await worker.drain();

      const transaction = await reload(id);
      expect(transaction.classificationStatus).toBe('PROVISIONAL');

      const flag = await prisma.reviewFlag.findFirst({
        where: { transactionId: id, rule: 'LOW_CONFIDENCE' },
      });
      expect(flag).not.toBeNull();
      expect(flag?.explanation).toContain('confidence');
      expect(flag?.status).toBe('OPEN');
    });

    it('marks the queue job completed', async () => {
      const id = await ingest(tokenA);
      await worker.drain();
      expect((await jobFor(id)).status).toBe('COMPLETED');
    });
  });

  describe('provider failures never damage stored data', () => {
    it.each(['failure', 'timeout', 'rate_limited', 'invalid'] as const)(
      'survives provider mode "%s"',
      async (mode) => {
        llm.setMode(mode);
        const id = await ingest(tokenA, {
          description: 'Ambiguous payment to Jumia',
          merchant: 'Jumia',
        });

        await worker.drain();
        const transaction = await reload(id);

        // The transaction is intact and still retrievable.
        expect(transaction.amountMinor).toBe(4500000n);
        expect(transaction.description).toContain('Jumia');

        // It is scheduled for another attempt rather than abandoned...
        expect(transaction.classificationStatus).toBe('FAILED_RETRYING');
        // ...and no invented category was written.
        expect(['OTHER', null]).toContain(transaction.category);

        const job = await jobFor(id);
        expect(job.status).toBe('PENDING');
        expect(job.attempts).toBeGreaterThan(0);
        expect(new Date(job.runAt).getTime()).toBeGreaterThanOrEqual(Date.now() - 1000);
      },
      20000,
    );

    it('keeps serving the API while the provider is down', async () => {
      llm.setMode('failure');
      const id = await ingest(tokenA, { description: 'Jumia order', merchant: 'Jumia' });
      await worker.drain();

      const response = await request(app.getHttpServer())
        .get(`/api/transactions/${id}`)
        .set('Authorization', bearer(tokenA))
        .expect(200);

      expect(response.body.id).toBe(id);
      expect(response.body.classification.status).toBe('FAILED_RETRYING');
    });

    it('does not repeat an identical audit entry on every retry', async () => {
      llm.setMode('failure');
      const id = await ingest(tokenA, { description: 'Conference sponsorship package', merchant: null });

      // Several failed attempts, all of which fall back to the same rules answer.
      for (let i = 0; i < 3; i += 1) {
        await makeJobDue(id);
        await worker.drain();
      }

      const events = await prisma.classificationEvent.findMany({ where: { transactionId: id } });
      expect(events).toHaveLength(1);

      // ...and a genuinely different answer is still recorded. Resetting the
      // breaker stands in for its cool-off window elapsing.
      llm.setMode('normal');
      hybrid.resetMetrics();
      await makeJobDue(id);
      await worker.drain();

      const after = await prisma.classificationEvent.findMany({
        where: { transactionId: id },
        orderBy: { createdAt: 'asc' },
      });
      expect(after.length).toBeGreaterThan(1);
      expect(after.at(-1)?.source).toBe('LLM');
    }, 20000);

    it('recovers automatically once the provider comes back', async () => {
      llm.setMode('failure');
      const id = await ingest(tokenA, {
        // No rule matches 'sponsorship', so this genuinely needs the model.
        description: 'Conference sponsorship package',
        merchant: null,
      });
      await worker.drain();
      expect((await reload(id)).classificationStatus).toBe('FAILED_RETRYING');

      // Provider recovers; the queued retry is picked up and succeeds.
      llm.setMode('normal');
      await makeRetriesDue();
      await worker.drain();

      const recovered = await reload(id);
      expect(recovered.classificationStatus).toBe('CLASSIFIED');
      expect(recovered.classificationSource).toBe('LLM');
      expect((await jobFor(id)).status).toBe('COMPLETED');
    });

    it('stops hammering a dead provider once the circuit opens', async () => {
      llm.setMode('failure');
      hybrid.resetMetrics();
      llm.resetCallCount();

      for (let i = 0; i < 12; i += 1) {
        await ingest(tokenA, { description: `Jumia order ${i}`, merchant: 'Jumia' });
      }
      await worker.drain();

      // The breaker trips after the configured number of failures, so the
      // provider is called far fewer times than there were transactions.
      expect(llm.callCount).toBeLessThanOrEqual(6);
      expect(hybrid.getCircuitState()).toBe('OPEN');
    });

    it('gives up after the attempt limit and dead-letters the job', async () => {
      llm.setMode('failure');
      const id = await ingest(tokenA, { description: 'Jumia order final', merchant: 'Jumia' });

      // Burn through the attempts.
      for (let i = 0; i < 8; i += 1) {
        await makeRetriesDue();
        await worker.drain();
      }

      const job = await jobFor(id);
      expect(job.attempts).toBeGreaterThanOrEqual(job.maxAttempts);
      expect(['DEAD', 'COMPLETED']).toContain(job.status);

      const transaction = await reload(id);
      // Whatever happened to the job, the transaction is still usable and
      // still visible to a human.
      expect(transaction.amountMinor).toBe(4500000n);
      expect(['PROVISIONAL', 'FAILED_RETRYING', 'CLASSIFIED']).toContain(
        transaction.classificationStatus,
      );
    }, 20000);
  });

  describe('restart recovery', () => {
    it('re-queues jobs left in flight by a crashed process', async () => {
      const id = await ingest(tokenA);
      const job = await jobFor(id);

      // Simulate a process that died mid-job.
      await prisma.job.update({
        where: { id: job.id },
        data: { status: 'PROCESSING', lockedAt: new Date(), lockedBy: 'dead-worker' },
      });

      const recovered = await worker.recoverStuckJobs();
      expect(recovered).toBeGreaterThanOrEqual(1);
      expect((await jobFor(id)).status).toBe('PENDING');

      await worker.drain();
      expect((await reload(id)).classificationStatus).toBe('CLASSIFIED');
    });
  });

  describe('manual correction', () => {
    it('preserves the original decision, the actor and the reason', async () => {
      const id = await ingest(tokenA, { description: 'IKEDC prepaid token purchase' });
      await worker.drain();
      expect((await reload(id)).category).toBe('UTILITIES');

      await request(app.getHttpServer())
        .patch(`/api/transactions/${id}/classification`)
        .set('Authorization', bearer(tokenA))
        .send({ category: 'RENT', reason: 'This was the office service charge, not power' })
        .expect(200);

      const corrected = await reload(id);
      expect(corrected.category).toBe('RENT');
      expect(corrected.classificationStatus).toBe('MANUAL');
      expect(corrected.classificationSource).toBe('MANUAL');
      // The machine's first answer is still on the record.
      expect(corrected.originalCategory).toBe('UTILITIES');

      const history = await request(app.getHttpServer())
        .get(`/api/transactions/${id}/classification-history`)
        .set('Authorization', bearer(tokenA))
        .expect(200);

      expect(history.body).toHaveLength(2);
      expect(history.body[1]).toMatchObject({
        previousCategory: 'UTILITIES',
        newCategory: 'RENT',
        source: 'MANUAL',
        actor: 'Ada Obi',
        reason: 'This was the office service charge, not power',
      });
    });

    it('is not overwritten by a classification job queued before it', async () => {
      const id = await ingest(tokenA, { description: 'Consultant retainer payment' });

      // The job is queued and still pending when the human corrects the row.
      await request(app.getHttpServer())
        .patch(`/api/transactions/${id}/classification`)
        .set('Authorization', bearer(tokenA))
        .send({ category: 'MARKETING', reason: 'Agency retainer' })
        .expect(200);

      await worker.drain();

      const after = await reload(id);
      expect(after.category).toBe('MARKETING');
      expect(after.classificationStatus).toBe('MANUAL');
      expect(after.classificationSource).toBe('MANUAL');

      // The automated attempt left no trace on the record.
      const events = await prisma.classificationEvent.findMany({ where: { transactionId: id } });
      expect(events).toHaveLength(1);
      expect(events[0]?.source).toBe('MANUAL');
    });

    it('survives an explicit reclassification request too', async () => {
      const id = await ingest(tokenA, { description: 'Consultant retainer payment' });
      await worker.drain();

      await request(app.getHttpServer())
        .patch(`/api/transactions/${id}/classification`)
        .set('Authorization', bearer(tokenA))
        .send({ category: 'TRAVEL' })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/transactions/${id}/reclassify`)
        .set('Authorization', bearer(tokenA))
        .expect(202);

      await makeRetriesDue();
      await worker.drain();

      expect((await reload(id)).category).toBe('TRAVEL');
    });

    it('closes the low-confidence flag that asked for a human decision', async () => {
      llm.setMode('low_confidence');
      const id = await ingest(tokenA, { description: 'Qqzz vendor payment', merchant: 'Qqzz' });
      await worker.drain();

      const flagBefore = await prisma.reviewFlag.findFirstOrThrow({
        where: { transactionId: id, rule: 'LOW_CONFIDENCE' },
      });
      expect(flagBefore.status).toBe('OPEN');

      await request(app.getHttpServer())
        .patch(`/api/transactions/${id}/classification`)
        .set('Authorization', bearer(tokenA))
        .send({ category: 'SOFTWARE', reason: 'Annual licence' })
        .expect(200);

      const flagAfter = await prisma.reviewFlag.findUniqueOrThrow({ where: { id: flagBefore.id } });
      expect(flagAfter.status).toBe('RESOLVED');
      expect(flagAfter.resolvedByUserId).toBe(tenants.orgA.userId);
    });

    it('rejects a category that is not in the taxonomy', async () => {
      const id = await ingest(tokenA);
      await request(app.getHttpServer())
        .patch(`/api/transactions/${id}/classification`)
        .set('Authorization', bearer(tokenA))
        .send({ category: 'CRYPTO' })
        .expect(400);
    });

    it("refuses to correct another organisation's transaction", async () => {
      const id = await ingest(tokenA);

      await request(app.getHttpServer())
        .patch(`/api/transactions/${id}/classification`)
        .set('Authorization', bearer(tokenB))
        .send({ category: 'RENT' })
        .expect(404);

      await request(app.getHttpServer())
        .get(`/api/transactions/${id}/classification-history`)
        .set('Authorization', bearer(tokenB))
        .expect(404);

      expect((await reload(id)).category).not.toBe('RENT');
    });
  });
});
