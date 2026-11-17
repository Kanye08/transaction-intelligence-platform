import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import {
  CATEGORIES,
  Category,
  REVIEW_RULES,
  REVIEW_SEVERITIES,
  REVIEW_STATUSES,
  ReviewRule,
  ReviewSeverity,
  ReviewStatus,
} from '../../../common/domain/constants';

export class QueryReviewFlagsDto {
  @ApiPropertyOptional({ enum: REVIEW_STATUSES, default: 'OPEN' })
  @IsOptional()
  @IsIn(REVIEW_STATUSES)
  status?: ReviewStatus;

  @ApiPropertyOptional({ enum: REVIEW_RULES })
  @IsOptional()
  @IsIn(REVIEW_RULES)
  rule?: ReviewRule;

  @ApiPropertyOptional({ enum: REVIEW_SEVERITIES })
  @IsOptional()
  @IsIn(REVIEW_SEVERITIES)
  severity?: ReviewSeverity;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class ResolveReviewFlagDto {
  @ApiProperty({ enum: ['RESOLVE', 'DISMISS'] })
  @IsIn(['RESOLVE', 'DISMISS'])
  action!: 'RESOLVE' | 'DISMISS';

  @ApiPropertyOptional({ description: 'Why the flag was closed', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CorrectClassificationDto {
  @ApiProperty({ enum: CATEGORIES, description: 'The category a person has decided on' })
  @IsIn(CATEGORIES, { message: `category must be one of: ${CATEGORIES.join(', ')}` })
  category!: Category;

  @ApiPropertyOptional({ description: 'Why the automated category was wrong', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
