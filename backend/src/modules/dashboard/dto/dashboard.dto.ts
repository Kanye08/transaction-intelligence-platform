import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class DashboardQueryDto {
  @ApiPropertyOptional({ description: 'Start of the reporting period, ISO 8601' })
  @IsOptional()
  @IsISO8601({ strict: false })
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'End of the reporting period, ISO 8601' })
  @IsOptional()
  @IsISO8601({ strict: false })
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Restrict every figure to one account' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  accountId?: string;
}
