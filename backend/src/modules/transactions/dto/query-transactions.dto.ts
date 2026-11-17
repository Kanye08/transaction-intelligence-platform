import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsISO8601, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import {
  CATEGORIES,
  CLASSIFICATION_STATUSES,
  Category,
  ClassificationStatus,
  TRANSACTION_DIRECTIONS,
  TransactionDirection,
} from '../../../common/domain/constants';
import { IsMoneyString } from '../../../common/money/is-money-string.validator';

export const REVIEW_FILTERS = ['ANY', 'FLAGGED', 'OPEN', 'CLEAR'] as const;
export type ReviewFilter = (typeof REVIEW_FILTERS)[number];

export class QueryTransactionsDto {
  @ApiPropertyOptional({ description: 'Restrict to one account' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  accountId?: string;

  @ApiPropertyOptional({ enum: TRANSACTION_DIRECTIONS })
  @IsOptional()
  @IsIn(TRANSACTION_DIRECTIONS)
  direction?: TransactionDirection;

  @ApiPropertyOptional({ enum: CATEGORIES })
  @IsOptional()
  @IsIn(CATEGORIES)
  category?: Category;

  @ApiPropertyOptional({ enum: CLASSIFICATION_STATUSES })
  @IsOptional()
  @IsIn(CLASSIFICATION_STATUSES)
  classificationStatus?: ClassificationStatus;

  @ApiPropertyOptional({ description: 'Inclusive lower bound, ISO 8601' })
  @IsOptional()
  @IsISO8601({ strict: false })
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Inclusive upper bound, ISO 8601' })
  @IsOptional()
  @IsISO8601({ strict: false })
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Minimum amount, decimal string', example: '1000.00' })
  @IsOptional()
  @IsMoneyString()
  amountMin?: string;

  @ApiPropertyOptional({ description: 'Maximum amount, decimal string', example: '50000.00' })
  @IsOptional()
  @IsMoneyString()
  amountMax?: string;

  @ApiPropertyOptional({ description: 'Free text over description and merchant' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({
    enum: REVIEW_FILTERS,
    description:
      'ANY (default), FLAGGED (has any flag), OPEN (has an unresolved flag), CLEAR (no open flag)',
  })
  @IsOptional()
  @IsIn(REVIEW_FILTERS)
  review?: ReviewFilter;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Opaque cursor from the previous page. Cursor pagination keeps page ' +
      'retrieval O(limit) regardless of how deep the caller has scrolled.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  cursor?: string;

  @ApiPropertyOptional({
    description:
      'Include a total count. Off by default: counting an entire tenant history ' +
      'is the expensive part of a listing query.',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  includeTotal?: boolean;
}
