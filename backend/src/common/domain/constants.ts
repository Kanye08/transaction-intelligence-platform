/**
 * Domain vocabulary.
 *
 * SQLite has no enum type, so these string unions are the application-side
 * contract and the CHECK constraints in the initial migration are the
 * database-side one. Keeping both in step is deliberate: a bug in a service
 * cannot write a state the database considers invalid.
 */

export const TRANSACTION_DIRECTIONS = ['INFLOW', 'OUTFLOW'] as const;
export type TransactionDirection = (typeof TRANSACTION_DIRECTIONS)[number];

export const CATEGORIES = [
  'REVENUE',
  'PAYROLL',
  'SOFTWARE',
  'MARKETING',
  'TRAVEL',
  'UTILITIES',
  'RENT',
  'TAX',
  'TRANSFERS',
  'BANKING_FEES',
  // Beyond the categories named in the brief: a large share of real Nigerian
  // business spend is capital equipment and professional services, and
  // dropping both into "Other" makes the dashboard useless for exactly the
  // costs a finance team wants to see.
  'EQUIPMENT',
  'PROFESSIONAL_SERVICES',
  'OTHER',
] as const;
export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

export const CATEGORY_LABELS: Record<Category, string> = {
  REVENUE: 'Revenue',
  PAYROLL: 'Payroll',
  SOFTWARE: 'Software',
  MARKETING: 'Marketing',
  TRAVEL: 'Travel',
  UTILITIES: 'Utilities',
  RENT: 'Rent',
  TAX: 'Tax',
  TRANSFERS: 'Transfers',
  BANKING_FEES: 'Banking Fees',
  EQUIPMENT: 'Equipment',
  PROFESSIONAL_SERVICES: 'Professional Services',
  OTHER: 'Other',
};

/**
 * Classification lifecycle.
 *   PENDING         - persisted, awaiting classification
 *   CLASSIFIED      - automated decision with sufficient confidence
 *   PROVISIONAL     - automated decision below the confidence threshold
 *   FAILED_RETRYING - provider failed, another attempt is scheduled
 *   MANUAL          - a human set the category; automation must not overwrite it
 */
export const CLASSIFICATION_STATUSES = [
  'PENDING',
  'CLASSIFIED',
  'PROVISIONAL',
  'FAILED_RETRYING',
  'MANUAL',
] as const;
export type ClassificationStatus = (typeof CLASSIFICATION_STATUSES)[number];

export const CLASSIFICATION_SOURCES = ['RULES', 'LLM', 'MANUAL'] as const;
export type ClassificationSource = (typeof CLASSIFICATION_SOURCES)[number];

export const REVIEW_RULES = [
  'DUPLICATE_SUSPECTED',
  'UNUSUALLY_LARGE',
  'LOW_CONFIDENCE',
  'UNUSUAL_FREQUENCY',
] as const;
export type ReviewRule = (typeof REVIEW_RULES)[number];

export const REVIEW_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

export const REVIEW_STATUSES = ['OPEN', 'RESOLVED', 'DISMISSED'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const JOB_TYPES = ['CLASSIFY_TRANSACTION', 'DETECT_ANOMALIES'] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const CURRENCY_NGN = 'NGN';
