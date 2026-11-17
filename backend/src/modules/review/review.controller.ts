import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { QueryReviewFlagsDto, ResolveReviewFlagDto } from './dto/review.dto';
import { ReviewService } from './review.service';

@ApiTags('review')
@ApiBearerAuth('bearer')
@Controller('review')
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get('flags')
  @ApiOperation({
    summary: 'List transactions flagged for human review',
    description: 'Ordered by severity, then most recent. Every flag carries its explanation.',
  })
  @ApiOkResponse({ description: 'Flags with their transaction and the reason for the flag' })
  listFlags(@CurrentUser() user: AuthUser, @Query() query: QueryReviewFlagsDto) {
    return this.review.listFlags(user, query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Counts of open, resolved and dismissed flags by rule and severity' })
  summary(@CurrentUser() user: AuthUser) {
    return this.review.summary(user);
  }

  @Patch('flags/:id')
  @ApiOperation({
    summary: 'Resolve or dismiss a review flag',
    description:
      'RESOLVE records that the flag was acted on; DISMISS records that it was a false positive. ' +
      'Both store who closed it, when, and the note they left.',
  })
  @ApiOkResponse({ description: 'The updated flag' })
  @ApiBadRequestResponse({ description: 'The flag is already closed' })
  @ApiNotFoundResponse({ description: 'No such flag in this organisation' })
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ResolveReviewFlagDto,
  ) {
    return this.review.resolve(user, id, dto.action, dto.note);
  }
}
