import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { PrismaService } from '../src/common/prisma/prisma.service';

export const TEST_PASSWORD = 'Password123!';

export interface SeededOrganisation {
  id: string;
  slug: string;
  name: string;
  userId: string;
  email: string;
  accountIds: string[];
}

export interface SeededTenants {
  orgA: SeededOrganisation;
  orgB: SeededOrganisation;
}

/** Wipes every table in foreign-key-safe order. */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.classificationEvent.deleteMany();
  await prisma.reviewFlag.deleteMany();
  await prisma.job.deleteMany();
  await prisma.idempotencyRecord.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organisation.deleteMany();
}

/**
 * Two complete tenants with one user and two accounts each. Ids are fixed so
 * assertions can reference them directly and failures are reproducible.
 */
export async function seedTwoTenants(prisma: PrismaService): Promise<SeededTenants> {
  const bcrypt = await import('bcryptjs');
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);

  const definitions: SeededOrganisation[] = [
    {
      id: 'org-a',
      slug: 'lagos-foods',
      name: 'Lagos Foods Ltd',
      userId: 'user-a',
      email: 'ada@lagosfoods.ng',
      accountIds: ['acct-a1', 'acct-a2'],
    },
    {
      id: 'org-b',
      slug: 'abuja-logistics',
      name: 'Abuja Logistics Ltd',
      userId: 'user-b',
      email: 'bola@abujalogistics.ng',
      accountIds: ['acct-b1', 'acct-b2'],
    },
  ];

  for (const org of definitions) {
    await prisma.organisation.create({
      data: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        users: {
          create: {
            id: org.userId,
            email: org.email,
            name: org.slug === 'lagos-foods' ? 'Ada Obi' : 'Bola Ade',
            passwordHash,
            role: 'OWNER',
          },
        },
        accounts: {
          create: org.accountIds.map((id, index) => ({
            id,
            name: index === 0 ? 'Operations Current Account' : 'Collections Account',
            bankName: index === 0 ? 'GTBank' : 'Zenith Bank',
            accountNumber: `${org.slug === 'lagos-foods' ? '01' : '02'}0000000${index + 1}`,
            currency: 'NGN',
          })),
        },
      },
    });
  }

  const [orgA, orgB] = definitions as [SeededOrganisation, SeededOrganisation];
  return { orgA, orgB };
}

/** Logs in and returns the bearer token. */
export async function login(app: INestApplication, email: string): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: TEST_PASSWORD })
    .expect(200);
  return response.body.accessToken as string;
}

export function bearer(token: string): string {
  return `Bearer ${token}`;
}
