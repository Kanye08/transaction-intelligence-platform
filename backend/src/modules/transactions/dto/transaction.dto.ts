import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  Category,
  CATEGORY_LABELS,
  ClassificationSource,
  ClassificationStatus,
  isCategory,
  ReviewRule,
  ReviewSeverity,
  ReviewStatus,
  TransactionDirection,
} from '../../../common/domain/constants';
import { toMoneyView } from '../../../common/money/money';

export class ClassificationView {
  @ApiPropertyOptional({ example: 'UTILITIES' }) category!: Category | null;
  @ApiPropertyOptional({ example: 'Utilities' }) categoryLabel!: string | null;
  @ApiPropertyOptional({ example: 'UTILITIES', description: 'First automated decision, preserved' })
  originalCategory!: Category | null;
  @ApiPropertyOptional({ example: 0.94 }) confidence!: number | null;
  @ApiProperty({ example: 'CLASSIFIED' }) status!: ClassificationStatus;
  @ApiPropertyOptional({ example: 'RULES' }) source!: ClassificationSource | null;
  @ApiPropertyOptional({ example: 'rules@1' }) provider!: string | null;
  @ApiPropertyOptional() classifiedAt!: string | null;
}

export class ReviewFlagView {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'UNUSUALLY_LARGE' }) rule!: ReviewRule;
  @ApiProperty({ example: 'HIGH' }) severity!: ReviewSeverity;
  @ApiProperty() explanation!: string;
  @ApiProperty({ example: 'OPEN' }) status!: ReviewStatus;
  @ApiProperty() createdAt!: string;
  @ApiPropertyOptional() resolvedAt!: string | null;
  @ApiPropertyOptional() resolvedBy!: string | null;
  @ApiPropertyOptional() resolutionNote!: string | null;
}

export class TransactionDto {
  @ApiProperty() id!: string;
  @ApiProperty() externalReference!: string;
  @ApiProperty() accountId!: string;
  @ApiPropertyOptional() accountName!: string | null;

  @ApiProperty({ example: '12999.75', description: 'Decimal string' }) amount!: string;
  @ApiProperty({ example: '1299975', description: 'Integer kobo, as a string' })
  amountMinor!: string;
  @ApiProperty({ example: 'NGN' }) currency!: string;
  @ApiProperty({ example: '₦12,999.75' }) formattedAmount!: string;

  @ApiProperty({ example: 'OUTFLOW' }) direction!: TransactionDirection;
  @ApiProperty() description!: string;
  @ApiPropertyOptional() merchant!: string | null;
  @ApiProperty() transactionDate!: string;

  @ApiProperty({ type: ClassificationView }) classification!: ClassificationView;
  @ApiProperty({ type: [ReviewFlagView] }) reviewFlags!: ReviewFlagView[];
  @ApiProperty({ description: 'Unresolved flags on this transaction' }) openFlagCount!: number;

  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

/** The database row shape this mapper understands. */
interface TransactionRow {
  id: string;
  externalReference: string;
  accountId: string;
  amountMinor: bigint;
  currency: string;
  direction: string;
  description: string;
  merchant: string | null;
  transactionDate: Date;
  originalCategory: string | null;
  category: string | null;
  confidence: number | null;
  classificationStatus: string;
  classificationSource: string | null;
  classificationProvider: string | null;
  classifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  account?: { name: string } | null;
  reviewFlags?: {
    id: string;
    rule: string;
    severity: string;
    explanation: string;
    status: string;
    createdAt: Date;
    resolvedAt: Date | null;
    resolutionNote: string | null;
    resolvedBy?: { name: string } | null;
  }[];
}

/**
 * Single place where a transaction becomes an API payload. BigInt never
 * escapes: the amount is exposed as decimal, minor-unit and formatted strings.
 */
export function toTransactionDto(row: TransactionRow): TransactionDto {
  const money = toMoneyView(row.amountMinor, row.currency);
  const category = isCategory(row.category) ? row.category : null;
  const flags = (row.reviewFlags ?? []).map((flag) => ({
    id: flag.id,
    rule: flag.rule as ReviewRule,
    severity: flag.severity as ReviewSeverity,
    explanation: flag.explanation,
    status: flag.status as ReviewStatus,
    createdAt: flag.createdAt.toISOString(),
    resolvedAt: flag.resolvedAt ? flag.resolvedAt.toISOString() : null,
    resolvedBy: flag.resolvedBy?.name ?? null,
    resolutionNote: flag.resolutionNote ?? null,
  }));

  return {
    id: row.id,
    externalReference: row.externalReference,
    accountId: row.accountId,
    accountName: row.account?.name ?? null,

    amount: money.amount,
    amountMinor: money.amountMinor,
    currency: money.currency,
    formattedAmount: money.formattedAmount,

    direction: row.direction as TransactionDirection,
    description: row.description,
    merchant: row.merchant,
    transactionDate: row.transactionDate.toISOString(),

    classification: {
      category,
      categoryLabel: category ? CATEGORY_LABELS[category] : null,
      originalCategory: isCategory(row.originalCategory) ? row.originalCategory : null,
      confidence: row.confidence,
      status: row.classificationStatus as ClassificationStatus,
      source: row.classificationSource as ClassificationSource | null,
      provider: row.classificationProvider,
      classifiedAt: row.classifiedAt ? row.classifiedAt.toISOString() : null,
    },

    reviewFlags: flags,
    openFlagCount: flags.filter((flag) => flag.status === 'OPEN').length,

    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
