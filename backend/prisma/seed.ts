/**
 * Two complete tenants with ~1,850 realistic NGN transactions, queued for the
 * real classification and detection pipeline so the app is demonstrable
 * immediately: a populated dashboard, a browsable ledger, a review queue with
 * genuine flags.
 *
 * Amounts, merchants and ordering come from a fixed-seed PRNG, so every run
 * produces the same ledger. Dates are anchored to the day the seed runs so the
 * dashboard shows a recent window; SEED_ANCHOR_DATE pins them too.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { ORGANISATIONS, OccasionalPattern, OrganisationSeed } from './seed-data';

const prisma = new PrismaClient();

const DAYS_OF_HISTORY = 180;
const DEMO_PASSWORD = 'Password123!';

/** Mulberry32: tiny, fast, and identical on every platform and Node version. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRandom(20260314);

function parseMinor(decimal: string): bigint {
  const [major = '0', minor = ''] = decimal.split('.');
  return BigInt(major) * 100n + BigInt(minor.padEnd(2, '0').slice(0, 2));
}

function formatMinor(minor: bigint): string {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  return `${negative ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

/** Deterministic amount inside a range, to the kobo. */
function amountBetween(range: [string, string]): bigint {
  const low = parseMinor(range[0]);
  const high = parseMinor(range[1]);
  const spread = high - low;
  const offset = BigInt(Math.floor(random() * Number(spread)));
  return low + offset;
}

/** Varies a recurring amount by up to +/-12%, keeping it exact in kobo. */
function vary(amountMinor: bigint): bigint {
  const factor = 88 + Math.floor(random() * 25); // 88..112
  return (amountMinor * BigInt(factor)) / 100n;
}

function anchorDate(): Date {
  const override = process.env.SEED_ANCHOR_DATE;
  const base = override ? new Date(override) : new Date();
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 12, 0, 0));
}

interface TransactionSeed {
  organisationId: string;
  accountId: string;
  externalReference: string;
  amountMinor: bigint;
  currency: string;
  direction: string;
  description: string;
  merchant: string | null;
  transactionDate: Date;
  classificationStatus: string;
}

function pickOccasional(patterns: OccasionalPattern[]): OccasionalPattern {
  const total = patterns.reduce((sum, pattern) => sum + pattern.weight, 0);
  let target = random() * total;
  for (const pattern of patterns) {
    target -= pattern.weight;
    if (target <= 0) return pattern;
  }
  return patterns[patterns.length - 1]!;
}

function buildTransactions(org: OrganisationSeed, anchor: Date): TransactionSeed[] {
  const rows: TransactionSeed[] = [];
  let sequence = 0;

  const reference = (bank: string) =>
    `${bank.slice(0, 3).toUpperCase()}-${(sequence += 1).toString().padStart(6, '0')}`;

  const dayMs = 24 * 60 * 60 * 1000;

  for (let dayOffset = DAYS_OF_HISTORY; dayOffset >= 0; dayOffset -= 1) {
    const date = new Date(anchor.getTime() - dayOffset * dayMs);
    const dayIndex = DAYS_OF_HISTORY - dayOffset;

    // Recurring commitments land on their cycle.
    for (const pattern of org.recurring) {
      if (dayIndex % pattern.everyDays !== 0) continue;
      const account = org.accounts[pattern.accountIndex]!;
      const base = parseMinor(pattern.amount);
      rows.push({
        organisationId: org.id,
        accountId: account.id,
        externalReference: reference(account.bankName),
        amountMinor: pattern.varies ? vary(base) : base,
        currency: 'NGN',
        direction: pattern.direction,
        description: pattern.description,
        merchant: pattern.merchant,
        transactionDate: new Date(date.getTime() + Math.floor(random() * 8) * 3600_000),
        classificationStatus: 'PENDING',
      });
    }

    // Plus a handful of day-to-day movements.
    const dailyCount = 2 + Math.floor(random() * 5);
    for (let i = 0; i < dailyCount; i += 1) {
      const pattern = pickOccasional(org.occasional);
      const account = org.accounts[pattern.accountIndex]!;
      rows.push({
        organisationId: org.id,
        accountId: account.id,
        externalReference: reference(account.bankName),
        amountMinor: amountBetween(pattern.amountRange),
        currency: 'NGN',
        direction: pattern.direction,
        description: pattern.description,
        merchant: pattern.merchant,
        transactionDate: new Date(date.getTime() + Math.floor(random() * 10) * 3600_000),
        classificationStatus: 'PENDING',
      });
    }
  }

  rows.push(...buildAnomalies(org, anchor, reference));
  return rows;
}

/** Planted to trigger each detection rule, so every rule is demonstrable
 *  straight after setup. */
function buildAnomalies(
  org: OrganisationSeed,
  anchor: Date,
  reference: (bank: string) => string,
): TransactionSeed[] {
  const account = org.accounts[0]!;
  const dayMs = 24 * 60 * 60 * 1000;
  const rows: TransactionSeed[] = [];

  // A. Possible duplicate: same amount, same day, two references.
  const duplicateAmount = parseMinor('1875000.00');
  const duplicateDay = new Date(anchor.getTime() - 9 * dayMs);
  for (const hour of [9, 17]) {
    rows.push({
      organisationId: org.id,
      accountId: account.id,
      externalReference: reference(account.bankName),
      amountMinor: duplicateAmount,
      currency: 'NGN',
      direction: 'OUTFLOW',
      description: 'Payment to Dangote Cement Plc for bulk order',
      merchant: 'Dangote Cement',
      transactionDate: new Date(duplicateDay.getTime() + hour * 3600_000),
      classificationStatus: 'PENDING',
    });
  }

  // B. Unusually large: far beyond anything else on this account.
  rows.push({
    organisationId: org.id,
    accountId: account.id,
    externalReference: reference(account.bankName),
    amountMinor: parseMinor('48500000.00'),
    currency: 'NGN',
    direction: 'OUTFLOW',
    description: 'Facility expansion payment to contractor',
    merchant: 'Julius Berger',
    transactionDate: new Date(anchor.getTime() - 4 * dayMs),
    classificationStatus: 'PENDING',
  });

  // C. Low confidence: no rule matches, the model is unsure too.
  for (const [index, description] of [
    'Payment to Zenco Ventures',
    'Settlement - ref 88213/A',
    'Miscellaneous vendor disbursement',
  ].entries()) {
    rows.push({
      organisationId: org.id,
      accountId: account.id,
      externalReference: reference(account.bankName),
      amountMinor: amountBetween(['75000.00', '420000.00']),
      currency: 'NGN',
      direction: 'OUTFLOW',
      description,
      merchant: null,
      transactionDate: new Date(anchor.getTime() - (6 + index) * dayMs),
      classificationStatus: 'PENDING',
    });
  }

  // D. Unusual frequency: eight top-ups to one counterparty in a day.
  const frequencyDay = new Date(anchor.getTime() - 2 * dayMs);
  for (let i = 0; i < 8; i += 1) {
    rows.push({
      organisationId: org.id,
      accountId: account.id,
      externalReference: reference(account.bankName),
      amountMinor: parseMinor('37500.00'),
      currency: 'NGN',
      direction: 'OUTFLOW',
      description: 'Wallet top-up',
      merchant: 'QuickTopup NG',
      transactionDate: new Date(frequencyDay.getTime() + i * 2 * 3600_000),
      classificationStatus: 'PENDING',
    });
  }

  return rows;
}

async function main(): Promise<void> {
  const anchor = anchorDate();
  console.log('[seed] resetting data...');

  // Order matters: children before parents.
  await prisma.classificationEvent.deleteMany();
  await prisma.reviewFlag.deleteMany();
  await prisma.job.deleteMany();
  await prisma.idempotencyRecord.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organisation.deleteMany();

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  let totalTransactions = 0;

  for (const org of ORGANISATIONS) {
    console.log(`[seed] creating ${org.name}...`);
    await prisma.organisation.create({
      data: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        users: { create: org.users.map((user) => ({ ...user, passwordHash })) },
        accounts: { create: org.accounts.map((account) => ({ ...account, currency: 'NGN' })) },
      },
    });

    const rows = buildTransactions(org, anchor);
    // Chunked: SQLite has a bound-parameter limit per statement.
    for (let i = 0; i < rows.length; i += 200) {
      await prisma.transaction.createMany({ data: rows.slice(i, i + 200) });
    }
    totalTransactions += rows.length;
    console.log(`[seed]   ${rows.length} transactions across ${org.accounts.length} accounts`);
  }

  // Queue classification for every transaction, exactly as ingestion would.
  const transactions = await prisma.transaction.findMany({
    select: { id: true, organisationId: true },
  });
  for (let i = 0; i < transactions.length; i += 200) {
    await prisma.job.createMany({
      data: transactions.slice(i, i + 200).map((transaction) => ({
        organisationId: transaction.organisationId,
        type: 'CLASSIFY_TRANSACTION',
        payload: JSON.stringify({ transactionId: transaction.id }),
        maxAttempts: Number(process.env.CLASSIFICATION_MAX_ATTEMPTS ?? 10),
      })),
    });
  }

  console.log(`[seed] ${totalTransactions} transactions queued for classification`);
  console.log('[seed] login with:');
  for (const org of ORGANISATIONS) {
    for (const user of org.users) {
      console.log(`[seed]   ${user.email} / ${DEMO_PASSWORD}  (${org.name}, ${user.role})`);
    }
  }
}

main()
  .catch((error) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
