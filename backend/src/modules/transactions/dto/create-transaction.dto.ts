import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { IsPositiveMoneyString } from '../../../common/money/is-money-string.validator';
import { TRANSACTION_DIRECTIONS, TransactionDirection } from '../../../common/domain/constants';

/** Bank statements commonly use credit/debit; both vocabularies are accepted. */
const DIRECTION_ALIASES: Record<string, TransactionDirection> = {
  INFLOW: 'INFLOW',
  OUTFLOW: 'OUTFLOW',
  CREDIT: 'INFLOW',
  DEBIT: 'OUTFLOW',
};

export class CreateTransactionDto {
  @ApiProperty({ description: 'Account to post against; must belong to the caller organisation' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  accountId!: string;

  @ApiProperty({
    description:
      'Reference from the source system. Unique per organisation and account; ' +
      'the database enforces this, so re-sending the same reference cannot duplicate a transaction.',
    example: 'GTB-2026-0001',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  externalReference!: string;

  @ApiProperty({
    description: 'Positive decimal string. Stored as integer kobo; never parsed as a float.',
    example: '12999.75',
  })
  @IsPositiveMoneyString()
  amount!: string;

  @ApiPropertyOptional({ example: 'NGN', default: 'NGN' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsIn(['NGN'], { message: 'Only NGN is supported in this implementation' })
  currency?: string;

  @ApiProperty({ enum: [...TRANSACTION_DIRECTIONS, 'CREDIT', 'DEBIT'], example: 'OUTFLOW' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? (DIRECTION_ALIASES[value.toUpperCase()] ?? value.toUpperCase()) : value,
  )
  @IsIn(TRANSACTION_DIRECTIONS, { message: 'direction must be INFLOW/CREDIT or OUTFLOW/DEBIT' })
  direction!: TransactionDirection;

  @ApiProperty({ example: 'MTN VTU airtime purchase' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  description!: string;

  @ApiPropertyOptional({ example: 'MTN Nigeria' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  merchant?: string;

  @ApiProperty({ example: '2026-03-14T09:30:00.000Z' })
  @IsISO8601({ strict: false }, { message: 'transactionDate must be an ISO 8601 date' })
  transactionDate!: string;
}

export class BatchCreateTransactionsDto {
  /**
   * Deliberately typed loosely at the envelope level. If each item were
   * validated by the global pipe, one malformed row would reject the whole
   * batch with a 400 - the opposite of the partial-success behaviour a bulk
   * import needs. Items are validated individually inside the service and
   * reported per row.
   */
  @ApiProperty({
    type: [CreateTransactionDto],
    description:
      'Up to 500 transactions. Items are validated and processed independently: ' +
      'an invalid or duplicate row does not reject the rest of the batch.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  transactions!: unknown[];
}
