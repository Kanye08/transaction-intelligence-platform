-- Initial schema for the Transaction Intelligence Platform.
--
-- CHECK constraints below are hand-written: Prisma cannot express them and
-- SQLite cannot add them via ALTER TABLE. They make the database - not just
-- the application layer - the authority on money, direction and lifecycle
-- states. On PostgreSQL most of these become native enum types.

-- CreateTable
CREATE TABLE "organisations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "users_role_check" CHECK ("role" IN ('OWNER', 'MEMBER')),
    CONSTRAINT "users_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "accounts_currency_check" CHECK (length("currency") = 3),
    CONSTRAINT "accounts_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalReference" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "direction" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "merchant" TEXT,
    "transactionDate" DATETIME NOT NULL,
    "originalCategory" TEXT,
    "category" TEXT,
    "confidence" REAL,
    "classificationSource" TEXT,
    "classificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "classificationProvider" TEXT,
    "classificationVersion" INTEGER NOT NULL DEFAULT 0,
    "classifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transactions_amount_check" CHECK ("amountMinor" > 0),
    CONSTRAINT "transactions_currency_check" CHECK (length("currency") = 3),
    CONSTRAINT "transactions_direction_check" CHECK ("direction" IN ('INFLOW', 'OUTFLOW')),
    CONSTRAINT "transactions_status_check" CHECK ("classificationStatus" IN ('PENDING', 'CLASSIFIED', 'PROVISIONAL', 'FAILED_RETRYING', 'MANUAL')),
    CONSTRAINT "transactions_source_check" CHECK ("classificationSource" IS NULL OR "classificationSource" IN ('RULES', 'LLM', 'MANUAL')),
    CONSTRAINT "transactions_confidence_check" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
    CONSTRAINT "transactions_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "classification_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "previousCategory" TEXT,
    "newCategory" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" REAL,
    "provider" TEXT,
    "providerVersion" TEXT,
    "actorUserId" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "classification_events_source_check" CHECK ("source" IN ('RULES', 'LLM', 'MANUAL')),
    CONSTRAINT "classification_events_confidence_check" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
    CONSTRAINT "classification_events_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "classification_events_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "classification_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "review_flags" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedByUserId" TEXT,
    "resolvedAt" DATETIME,
    "resolutionNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "review_flags_status_check" CHECK ("status" IN ('OPEN', 'RESOLVED', 'DISMISSED')),
    CONSTRAINT "review_flags_severity_check" CHECK ("severity" IN ('LOW', 'MEDIUM', 'HIGH')),
    CONSTRAINT "review_flags_resolution_check" CHECK (("status" = 'OPEN' AND "resolvedAt" IS NULL) OR ("status" <> 'OPEN' AND "resolvedAt" IS NOT NULL)),
    CONSTRAINT "review_flags_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "review_flags_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "review_flags_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" DATETIME,
    "lockedBy" TEXT,
    "lastError" TEXT,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "jobs_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD')),
    CONSTRAINT "jobs_attempts_check" CHECK ("attempts" >= 0 AND "maxAttempts" > 0),
    CONSTRAINT "jobs_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "idempotency_records_status_check" CHECK ("status" IN ('IN_PROGRESS', 'COMPLETED')),
    CONSTRAINT "idempotency_records_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "organisations_slug_key" ON "organisations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organisationId_idx" ON "users"("organisationId");

-- CreateIndex
CREATE INDEX "accounts_organisationId_idx" ON "accounts"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_organisationId_accountNumber_key" ON "accounts"("organisationId", "accountNumber");

-- CreateIndex
CREATE INDEX "transactions_organisationId_transactionDate_id_idx" ON "transactions"("organisationId", "transactionDate", "id");

-- CreateIndex
CREATE INDEX "transactions_organisationId_classificationStatus_idx" ON "transactions"("organisationId", "classificationStatus");

-- CreateIndex
CREATE INDEX "transactions_organisationId_category_idx" ON "transactions"("organisationId", "category");

-- CreateIndex
CREATE INDEX "transactions_organisationId_direction_idx" ON "transactions"("organisationId", "direction");

-- CreateIndex
CREATE INDEX "transactions_organisationId_merchant_idx" ON "transactions"("organisationId", "merchant");

-- CreateIndex
CREATE INDEX "transactions_accountId_transactionDate_idx" ON "transactions"("accountId", "transactionDate");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_organisationId_accountId_externalReference_key" ON "transactions"("organisationId", "accountId", "externalReference");

-- CreateIndex
CREATE INDEX "classification_events_transactionId_createdAt_idx" ON "classification_events"("transactionId", "createdAt");

-- CreateIndex
CREATE INDEX "classification_events_organisationId_createdAt_idx" ON "classification_events"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "review_flags_organisationId_status_createdAt_idx" ON "review_flags"("organisationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "review_flags_organisationId_rule_idx" ON "review_flags"("organisationId", "rule");

-- CreateIndex
CREATE UNIQUE INDEX "review_flags_transactionId_rule_key" ON "review_flags"("transactionId", "rule");

-- CreateIndex
CREATE INDEX "jobs_status_runAt_idx" ON "jobs"("status", "runAt");

-- CreateIndex
CREATE INDEX "jobs_organisationId_status_idx" ON "jobs"("organisationId", "status");

-- CreateIndex
CREATE INDEX "idempotency_records_organisationId_createdAt_idx" ON "idempotency_records"("organisationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_organisationId_key_key" ON "idempotency_records"("organisationId", "key");
