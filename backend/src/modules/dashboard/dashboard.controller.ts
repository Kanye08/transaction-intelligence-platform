import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { DashboardService, DashboardSummary } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard.dto';

@ApiTags('dashboard')
@ApiBearerAuth('bearer')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Financial summary for the caller organisation',
    description:
      'Inflows, outflows, net cash flow, spending by category, classification status ' +
      'and open review flags. All figures are aggregated in the database and returned ' +
      'as exact kobo strings.',
  })
  @ApiOkResponse({ description: 'Dashboard figures for the requested period' })
  summary(
    @CurrentUser() user: AuthUser,
    @Query() query: DashboardQueryDto,
  ): Promise<DashboardSummary> {
    return this.dashboard.summary(user, query);
  }
}
