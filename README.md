# Transaction Intelligence Platform

A multi-tenant platform where Nigerian businesses import transactions, have them categorised
automatically, review the ones that look wrong, and correct the categories by hand without losing
the record of what the system originally decided.

Built for the Sycamore Capital technical assessment. Node.js, TypeScript, NestJS, Prisma and
SQLite, with a React frontend. Nothing else needs installing.

## Quick start

```bash
git clone https://github.com/Kanye08/transaction-intelligence-platform.git
cd transaction-intelligence-platform
npm install
npm run setup
npm start          # http://localhost:3000
npm test
```

`npm run setup` applies migrations, builds both workspaces, seeds 1,847 transactions and then runs
them through the classifier. It takes about two and a half minutes, nearly all of it classification,
and leaves the app populated so there is something to look at straight away.

Node 20.11 or newer (`.nvmrc` pins 24). `npm install` writes a `.env` from `.env.example` with a
generated JWT secret.

### Logins

Password for all four accounts: `Password123!`

| Organisation | Email | Role |
|---|---|---|
| Lagos Foods Ltd | `ada@lagosfoods.ng` | Owner |
| Lagos Foods Ltd | `tunde@lagosfoods.ng` | Member |
| Abuja Logistics Ltd | `bola@abujalogistics.ng` | Owner |
| Abuja Logistics Ltd | `chidi@abujalogistics.ng` | Member |

The two organisations have separate accounts, transactions and review queues.

### Commands

| Command | What it does |
|---|---|
| `npm run setup` | Migrate, build, seed, classify. Safe to re-run. |
| `npm start` | Serves the API and the built frontend on port 3000. |
| `npm run dev` | API on 3000 in watch mode, Vite on 5173 proxying `/api`. |
| `npm test` | 198 tests. |
| `npm run test:unit` / `npm run test:e2e` | Unit tests only / integration tests only. |
| `npm run typecheck` | `tsc --noEmit` on backend and frontend. |
| `npm run db:reset` | Drop the database, migrate, seed and classify again. |
| `npm run db:classify` | Drain the job queue manually (runs the built worker, so build first). |
| `npm run db:studio` | Prisma Studio. |

Swagger UI is at `/api/docs`, the spec at `/openapi.json`, and a health check at `/api/health`.

### Postman

[`postman/transaction-intelligence.postman_collection.json`](postman/transaction-intelligence.postman_collection.json)
covers all 17 endpoints. Import it, run **Auth > Login** first (it stores the token and every other
request uses it), then **Accounts > List accounts** and **Transactions > Import a transaction**,
which fill in the account and transaction ids the rest of the requests need. `baseUrl` defaults to
`http://localhost:3000`.

It is organised to show the behaviour that matters: importing the same reference twice, replaying
an `Idempotency-Key`, a batch where two rows succeed and two fail, correcting a category and
reading the history afterwards, and two requests showing that another organisation's data comes
back as 404.

## How it works

A request arrives with a bearer token. A global guard verifies it and puts the user and their
organisation id on the request. Services then read and write through a tenant-scoped Prisma client,
so a query can only ever see that organisation's rows.

Importing a transaction writes the row and a classification job in the same database transaction,
then returns. It never calls the classifier. A background worker picks the job up, asks the
configured provider for a category, writes the decision and an audit event, and runs the four
detection rules over the transaction. If the provider is slow or down, the transaction is already
stored and readable; only its category is late.

```
backend/src/
  common/
    auth/          JWT guard, @Public, @CurrentUser
    domain/        categories, statuses and rule names
    filters/       RFC 7807 error responses
    middleware/    request correlation id
    money/         integer-kobo money utility
    prisma/        PrismaClient wrapper and SQLite pragmas
    resilience/    circuit breaker, timeout, jittered backoff
    tenancy/       tenant-scoped Prisma client
  modules/
    accounts/ auth/ dashboard/ health/ idempotency/ jobs/ review/ transactions/
    classification/
      providers/                  rules, mock-llm, hybrid
      classification-state.ts     allowed status transitions
      classification.service.ts   applies a decision, guarded by row version
      classification-correction.service.ts   manual corrections and history
  scripts/process-jobs.ts
backend/prisma/   schema, migration, seed
backend/test/     integration tests
frontend/src/     api client, auth context, four screens
```

## Money

₦12,999.75 is stored as the BigInt `1299975`: integer kobo, in a `BIGINT` column. No monetary value
is ever a JavaScript `number`.

Amounts arrive as decimal strings and are parsed digit by digit in
[`money.ts`](backend/src/common/money/money.ts), never through `parseFloat`. A JSON number is
rejected outright, because the precision is already lost by the time it gets here. Fractional kobo,
thousands separators, currency symbols and exponent notation are rejected too. Sums and averages
stay in BigInt, and `allocate()` spreads remainders a kobo at a time so split amounts add back up.

Responses carry the amount three ways, all strings:

```json
{ "amount": "12999.75", "amountMinor": "1299975", "currency": "NGN", "formattedAmount": "₦12,999.75" }
```

`amountMinor` is a string because JSON has no integer type wide enough and `JSON.stringify` cannot
serialise BigInt at all.

The one place floating point appears is the standard deviation used by the unusually-large rule. It
decides whether to flag something; it never produces an amount. 39 unit tests cover the money
utility, including values past `Number.MAX_SAFE_INTEGER`.

## Multi-tenancy and security

The organisation id comes from the verified JWT. An `organisationId` in a query string, body or
header is ignored.

[`tenant-prisma.service.ts`](backend/src/common/tenancy/tenant-prisma.service.ts) returns a Prisma
client extended so that every operation on a tenant-owned model gets the organisation filter put
into its `where`, and the tenant id overwritten in its `data`. A service cannot forget the filter,
because the only way to reach tenant data is through that client, and passing the wrong id does not
help because the scope overwrites it. Operations the extension does not recognise throw instead of
running unscoped.

Cross-tenant requests return 404 rather than 403, since 403 confirms the record exists.

Also in place: bcrypt password hashing, rate limiting on login, Helmet headers (relaxed only for
the Swagger page, which needs an inline script), validation that rejects unknown fields, error
responses that never include stack traces, and a correlation id on every response and log line.

## Classification

Three providers implement one interface
([`classification-provider.ts`](backend/src/modules/classification/providers/classification-provider.ts)),
selected with `CLASSIFICATION_PROVIDER`:

| Provider | What it is |
|---|---|
| `rules` | 17 rule groups over about 85 Nigerian keywords: MTN, IKEDC, DSTV, FIRS and PAYE, bank charges, Paystack and Flutterwave settlements, AWS, Air Peace, salary, rent, stamp duty. |
| `mock-llm` | A stand-in model with deterministic inference, which can also be told to be slow, time out, fail, rate-limit, return invalid output, or answer with low confidence. |
| `hybrid` *(default)* | Rules first, model only when the rules are unsure. |

Hybrid runs the rules, and if their confidence is at or above `CLASSIFICATION_CONFIDENCE_THRESHOLD`
(0.75) it stops there. Otherwise it calls the model behind a timeout and a circuit breaker,
validates the response, and uses it only if its confidence beats the rule result. On the seeded
data, 1,243 of 1,847 transactions (67%) are classified by rules alone and 604 (33%) by the model.

Every provider response is checked against the category list and a 0 to 1 confidence before it can
reach the database, so an invented category or a confidence of `"very high"` is treated as a
provider failure rather than written down.

Statuses are `PENDING`, `CLASSIFIED`, `PROVISIONAL` (below the threshold, still reviewable),
`FAILED_RETRYING` and `MANUAL`. Once a human sets a category, automation leaves it alone. The
allowed transitions live in
[`classification-state.ts`](backend/src/modules/classification/classification-state.ts).

Low-confidence results keep the best answer available and are marked provisional rather than being
relabelled `Other`.

### Failure handling

Calls to the model have a timeout. Failed jobs are retried with exponential backoff and full
jitter, so a backlog does not retry in lockstep and recreate the outage. After five consecutive
failures the circuit breaker opens and calls fail immediately until it half-opens and a probe
succeeds. The budget is 10 attempts on a two-minute base capped at 30 minutes, which covers roughly
six hours of downtime; past that a transaction settles as `PROVISIONAL` and waits in the review
queue. All of those numbers are environment variables.

Tests drive each failure mode (`failure`, `timeout`, `rate_limited`, `invalid`) through the real
pipeline and check that the system recovers on its own once the provider returns.

### Background jobs

A `jobs` table and a poll loop. A job is claimed with `UPDATE ... WHERE id = ? AND status =
'PENDING'` rather than a select followed by an update, so two workers cannot take the same job.
Anything left `PROCESSING` by a crash goes back in the queue at boot.

This is sized for the assessment, not for production. It keeps Redis out of the setup.
[`jobs.service.ts`](backend/src/modules/jobs/jobs.service.ts) is the seam: BullMQ, SQS or RabbitMQ
would replace the worker and the enqueue call, and nothing above them would change.

## Audit history and corrections

`classification_events` is append-only. Each row records the previous and new category, the source
(`RULES`, `LLM` or `MANUAL`), confidence, provider and version, who made the change, a reason and a
timestamp. Identical consecutive decisions are not re-recorded, so a retry that produces the same
answer does not fill the history with noise.

A manual correction keeps `originalCategory`, stores who changed it and why, and sets the status to
`MANUAL`. A classification job queued before the correction cannot undo it: the worker checks the
status and the row version, and skips the stale job. Correcting a category also closes the
low-confidence flag that asked for a decision.

## Review

Four detection rules, each independently testable, each producing an explanation a reviewer can
read:

| Rule | What it looks for |
|---|---|
| `DUPLICATE_SUSPECTED` | Same account, amount and direction within 24 hours under a different reference, with a similar description (shared-word score of 0.6 or more). Exact duplicates are already rejected at ingestion; this catches the invoice paid twice. |
| `UNUSUALLY_LARGE` | More than 3 standard deviations above the mean of the last 120 transactions on the same account and direction, and only once there are at least 20 of them. Below that there is no verdict, because "unusual" means nothing on five transactions. |
| `LOW_CONFIDENCE` | Confidence below 0.6. A 0.68 answer is reasonable and is not flagged, to keep the queue worth reading. |
| `UNUSUAL_FREQUENCY` | More than 5 payments to the same counterparty in 24 hours, which usually means a retry loop or repeated billing. |

Thresholds are environment variables. Flags are unique per transaction and rule, so detection can
be re-run safely. A flag is `OPEN` until someone resolves or dismisses it, which records their name,
the time and their note.

The seed triggers all four: 104 open flags for Lagos Foods (76 low confidence, 15 unusually large,
10 duplicates, 3 frequency) and 52 for Abuja Logistics.

## Transactions

- Single and batch import (up to 500 rows), filtering, search and cursor pagination.
- Duplicates are prevented by `UNIQUE(organisationId, accountId, externalReference)` rather than a
  check before inserting, which loses under concurrency. Five simultaneous imports of the same
  transaction produce one row and four `DUPLICATE` responses.
- `Idempotency-Key` is backed by `UNIQUE(organisationId, key)`. The same key replays the original
  response, the same key with a different payload returns 409, and a request that failed releases
  its key for a retry.
- Batch import returns 207 with a result per row (`CREATED`, `DUPLICATE` or `FAILED` with its
  error). Rows are validated individually rather than by the global pipe, which would reject the
  whole batch over one bad row.
- Pagination is keyed on `(transactionDate, id)`, so a deep page costs the same as the first one.
  Totals are opt-in with `includeTotal=true`, since counting a whole organisation is the expensive
  part of the query.

## Database

Eight tables and 21 indexes. SQLite has no Prisma enums, so the initial migration hand-writes CHECK
constraints for `amountMinor > 0`, direction, classification status and source, confidence between
0 and 1, flag severity and status, and job status. Invalid states are refused by the database, not
only by the application.

SQLite's limits are real: one writer at a time, no case-insensitive or trigram search, no partial
indexes, no enums, and `synchronous = NORMAL` is set to keep seeding quick. Moving to PostgreSQL
means changing the datasource, turning the string-plus-CHECK columns into enums, switching search to
`mode: 'insensitive'` or a trigram index, and replacing the job table with a real queue. Application
code stays as it is, because all database access already goes through the scoped client.

## Testing

198 tests across 13 suites, all passing.

| Area | What is covered |
|---|---|
| Money | Parsing, formatting, fractional kobo, huge values, floating-point drift, allocation |
| Tenant isolation | Cross-tenant reads, updates, deletes and aggregates, spoofed organisation ids, forged tokens |
| Ingestion | Duplicates, concurrent imports, idempotency, partial batches |
| Classification | Whole pipeline, every provider failure mode, circuit breaker, recovery, restart, dead-lettering |
| Audit | Original preserved, actor recorded, stale job cannot overwrite a correction |
| Review | All four rules, the insufficient-history guard, repeat detection, flag lifecycle |
| Dashboard | Totals to the kobo, date and account filters, empty periods, isolation |

Integration tests run the real application, with the same modules, pipes, guards and error filter,
against a migrated SQLite database. The only mock is the AI provider, which is a mock by design.

## Design scenarios

### 1. The provider is unavailable for six hours

Ingestion does not depend on it, so imports keep returning 201 and every transaction stays
queryable with `PENDING` or `FAILED_RETRYING` on it. The backlog sits in the jobs table and
survives restarts.

Retries use the backoff, jitter and circuit breaker described above, so the provider is called a
handful of times during the outage rather than once per queued job, and recovery is automatic: the
breaker half-opens, a probe succeeds, and the queue drains in `runAt` order. Classification is
driven off the stored row and guarded by a version check, so a retry cannot apply twice. Hybrid also
degrades usefully here, since the rules still classify most transactions without the model.

With the default budget a six-hour outage is survived. A longer one leaves transactions provisional
in the review queue rather than wrong, and `npm run db:classify` or the reclassify endpoint picks
them up afterwards. At real volume I would add alerts on queue depth and oldest pending job, a
notice in the UI that categorisation is behind, and a drain rate limit so recovery does not knock
the provider over again.

### 2. Keeping classification costs down at millions a day

Most of the saving is already here: rules run first and the model is only asked when they are
unsure, which on the seeded data is a third of transactions. The confidence threshold is the dial.

After that, in the order I would do them:

1. **Cache by merchant.** Descriptions repeat, so `(normalised merchant, direction) → category`
   removes most of the remaining calls. Invalidate when someone corrects that merchant.
2. **Turn corrections into rules.** Every manual correction is a labelled example, and a recurring
   one becomes a rule that costs nothing. The audit history is already the dataset.
3. **Batch requests.** Fifty transactions per call instead of one, since prompt overhead dominates
   on short inputs.
4. **Tier the models.** A cheap model by default, an expensive one only for ambiguous or
   high-value transactions.
5. **Trim the prompt.** Description, merchant, direction and an amount band, not the whole record.
6. **Track cost per thousand transactions** with a cap that falls back to rules-only.

Accuracy holds up because the transactions that skip the model are the ones a rule already matches
confidently.

### 3. Scaling from 100,000 to 10 million transactions a day

Already in place: tenant-scoped queries with composite indexes, cursor pagination, aggregates
computed in SQL, opt-in counting, asynchronous processing and stateless auth.

What would have to change:

- **PostgreSQL.** SQLite takes one writer; 10M a day is about 115 writes a second sustained, with
  much higher peaks.
- **Partition `transactions` by month**, since most queries look at a recent window and old
  partitions can be detached and archived.
- **A real queue** with many worker processes, replacing the polling table.
- **Read replicas** for dashboards and listings, which tolerate replica lag.
- **Pre-aggregated dashboard totals** per tenant, day and category instead of summing per request.
- **Connection pooling** with PgBouncer.
- **Backpressure**: per-tenant rate limits, a bounded queue, 429 with `Retry-After`.
- **Observability**: traces built on the existing correlation id, per-tenant latency and error
  metrics, alerts on queue depth and on how often humans correct the machine.
- **Retention**: hot for 90 days, then archive.

I would do PostgreSQL and the queue first, pre-aggregation next, and partitioning only when table
size actually demands it, load-testing each step.

### 4. A finance team no longer trusts the categories

Start with evidence. The audit history already says what the machine decided, with which provider
and confidence, and what the customer changed it to, so I would pull their corrections for the
period and group them. Distrust is rarely spread evenly; it is usually one merchant or one rule
that is consistently wrong, which is a rule fix rather than a model problem.

Then fix it in layers: add deterministic rules for the merchants they keep correcting, raise the
confidence threshold for that tenant so more transactions go to review instead of straight to the
dashboard, and re-run classification over the affected period. Their corrections are protected, so
re-running cannot undo their work.

The product side matters as much. Every category carries a reason and a confidence, and provisional
ones are marked as provisional instead of being presented as fact, so "Utilities, matched IKEDC"
reads differently from "Other, model was unsure". Finally, track the correction rate per tenant and
per category and show it falling, with an alert when it climbs, so the next regression is caught
here rather than by the customer.

## Known limitations

1. SQLite and an in-process worker are fine for this exercise and not for production.
2. The AI provider is a mock. A real one implements the same one-method interface; the failure
   handling around it is real.
3. `OWNER` and `MEMBER` exist but are not enforced as different permissions. Tenant isolation is.
4. No refresh tokens. A 12-hour JWT and client-side logout; a denylist would go where the logout
   endpoint is.
5. Search uses `LIKE`, which is fine at this size and not at millions of rows.
6. There is no import screen in the UI. Ingestion is covered by the API and the tests, and the UI
   covers the three screens the brief asks for.
7. Dashboard totals are computed per request.
8. No browser tests. The APIs behind each screen are integration-tested, the rendering is not.

## For production

Secrets in a managed store instead of `.env`, TLS behind a reverse proxy, log shipping with traces,
per-tenant rate limits and quotas, backups with a tested restore, migration-gated deploys, a runbook
for provider outages and queue backlogs, access logging on financial records, and a retention
policy.
