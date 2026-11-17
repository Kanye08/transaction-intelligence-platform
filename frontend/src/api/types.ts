export type Direction = 'INFLOW' | 'OUTFLOW';

export type ClassificationStatus =
  | 'PENDING'
  | 'CLASSIFIED'
  | 'PROVISIONAL'
  | 'FAILED_RETRYING'
  | 'MANUAL';

export type ClassificationSource = 'RULES' | 'LLM' | 'MANUAL';

export type ReviewRule =
  | 'DUPLICATE_SUSPECTED'
  | 'UNUSUALLY_LARGE'
  | 'LOW_CONFIDENCE'
  | 'UNUSUAL_FREQUENCY';

export type ReviewSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type ReviewStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';

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
  'EQUIPMENT',
  'PROFESSIONAL_SERVICES',
  'OTHER',
] as const;

export type Category = (typeof CATEGORIES)[number];

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

export const RULE_LABELS: Record<ReviewRule, string> = {
  DUPLICATE_SUSPECTED: 'Possible duplicate',
  UNUSUALLY_LARGE: 'Unusually large',
  LOW_CONFIDENCE: 'Low confidence',
  UNUSUAL_FREQUENCY: 'Unusual frequency',
};

export interface Organisation {
  id: string;
  name: string;
  slug: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  organisation: Organisation;
}

export interface LoginResponse {
  accessToken: string;
  expiresIn: string;
  user: User;
}

export interface Account {
  id: string;
  name: string;
  bankName: string;
  accountNumber: string;
  currency: string;
}

export interface Classification {
  category: Category | null;
  categoryLabel: string | null;
  originalCategory: Category | null;
  confidence: number | null;
  status: ClassificationStatus;
  source: ClassificationSource | null;
  provider: string | null;
  classifiedAt: string | null;
}

export interface ReviewFlagSummary {
  id: string;
  rule: ReviewRule;
  severity: ReviewSeverity;
  explanation: string;
  status: ReviewStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
}

export interface Transaction {
  id: string;
  externalReference: string;
  accountId: string;
  accountName: string | null;
  amount: string;
  amountMinor: string;
  currency: string;
  formattedAmount: string;
  direction: Direction;
  description: string;
  merchant: string | null;
  transactionDate: string;
  classification: Classification;
  reviewFlags: ReviewFlagSummary[];
  openFlagCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionPage {
  data: Transaction[];
  pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null };
  total?: number;
}

export interface MoneyView {
  amount: string;
  amountMinor: string;
  currency: string;
  formattedAmount: string;
}

export interface DashboardSummary {
  range: { from: string | null; to: string | null };
  totals: {
    inflow: MoneyView;
    outflow: MoneyView;
    net: MoneyView;
    transactionCount: number;
  };
  spendingByCategory: {
    category: string;
    label: string;
    amount: string;
    amountMinor: string;
    formattedAmount: string;
    transactionCount: number;
    percentage: number;
  }[];
  classificationStatus: Record<string, number>;
  review: { openFlags: number; byRule: Record<string, number> };
  recentTransactions: {
    id: string;
    description: string;
    merchant: string | null;
    direction: Direction;
    formattedAmount: string;
    amountMinor: string;
    category: string | null;
    categoryLabel: string | null;
    classificationStatus: ClassificationStatus;
    transactionDate: string;
  }[];
}

export interface ReviewFlag {
  id: string;
  rule: ReviewRule;
  severity: ReviewSeverity;
  status: ReviewStatus;
  explanation: string;
  details: Record<string, unknown> | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  transaction: {
    id: string;
    externalReference: string;
    description: string;
    merchant: string | null;
    direction: Direction;
    transactionDate: string;
    amount: string;
    amountMinor: string;
    formattedAmount: string;
    currency: string;
    category: Category | null;
    classificationStatus: ClassificationStatus;
    confidence: number | null;
    accountName: string | null;
  };
}

export interface ReviewFlagPage {
  data: ReviewFlag[];
  total: number;
  limit: number;
  offset: number;
}

export interface ReviewSummary {
  open: number;
  resolved: number;
  dismissed: number;
  byRule: Record<string, number>;
  bySeverity: Record<string, number>;
}

export interface ClassificationHistoryEntry {
  id: string;
  previousCategory: Category | null;
  previousCategoryLabel: string | null;
  newCategory: Category;
  newCategoryLabel: string;
  source: ClassificationSource;
  confidence: number | null;
  provider: string | null;
  providerVersion: string | null;
  actor: string | null;
  reason: string | null;
  createdAt: string;
}
