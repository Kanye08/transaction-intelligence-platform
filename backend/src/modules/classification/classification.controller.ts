import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { CorrectClassificationDto } from '../review/dto/review.dto';
import { ClassificationCorrectionService } from './classification-correction.service';
import { ClassificationService } from './classification.service';

@ApiTags('classification')
@ApiBearerAuth('bearer')
@Controller('transactions/:id')
export class ClassificationController {
  constructor(
    private readonly correction: ClassificationCorrectionService,
    private readonly classification: ClassificationService,
  ) {}

  @Patch('classification')
  @ApiOperation({
    summary: 'Correct the category of a transaction',
    description:
      'Sets the category manually. The original automated decision is preserved, an audit ' +
      'event records who changed it and why, and the transaction is locked against further ' +
      'automated classification - including jobs queued before the correction.',
  })
  @ApiOkResponse({ description: 'The correction was applied' })
  @ApiConflictResponse({ description: 'The transaction changed concurrently; reload and retry' })
  @ApiNotFoundResponse({ description: 'No such transaction in this organisation' })
  correct(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CorrectClassificationDto,
  ) {
    return this.correction.correct(user, id, dto.category, dto.reason);
  }

  @Get('classification-history')
  @ApiOperation({
    summary: 'Full classification history of a transaction',
    description: 'Append-only: every automated and manual decision, oldest first.',
  })
  @ApiOkResponse({ description: 'Ordered list of classification events' })
  history(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.correction.history(user, id);
  }

  @Post('reclassify')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Queue the transaction for classification again',
    description:
      'Schedules a background job. Manually corrected transactions are left untouched by the worker.',
  })
  @ApiAcceptedResponse({ description: 'Classification job queued' })
  async reclassify(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.classification.requestReclassification(user, id);
    return { status: 'QUEUED', transactionId: id };
  }
}
