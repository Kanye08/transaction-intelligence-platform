/**
 * Drains the job queue and exits. Used by `npm run setup` so a fresh install
 * arrives already classified, and available as `npm run db:classify`. It runs
 * the real worker against the real providers - there is no separate seeding path
 * that could drift from production behaviour.
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { PrismaService } from '../common/prisma/prisma.service';
import { JobsWorker } from '../modules/jobs/jobs.worker';

async function main(): Promise<void> {
  const context = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  const worker = context.get(JobsWorker);
  const prisma = context.get(PrismaService);

  const pending = await prisma.job.count({ where: { status: 'PENDING' } });
  console.log(`[jobs] draining ${pending} pending job(s)...`);

  const started = Date.now();
  const processed = await worker.drain(10_000);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  const [byStatus, flags] = await Promise.all([
    prisma.transaction.groupBy({ by: ['classificationStatus'], _count: { _all: true } }),
    prisma.reviewFlag.count({ where: { status: 'OPEN' } }),
  ]);

  console.log(`[jobs] processed ${processed} job(s) in ${seconds}s`);
  for (const row of byStatus) {
    console.log(`[jobs]   ${row.classificationStatus}: ${row._count._all}`);
  }
  console.log(`[jobs]   open review flags: ${flags}`);

  await context.close();
}

main().catch((error) => {
  console.error('[jobs] failed:', error);
  process.exitCode = 1;
});
