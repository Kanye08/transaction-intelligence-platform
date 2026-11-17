import { Module } from '@nestjs/common';

import { ReviewController } from './review.controller';
import { ReviewDetectionService } from './review-detection.service';
import { ReviewService } from './review.service';

@Module({
  controllers: [ReviewController],
  providers: [ReviewService, ReviewDetectionService],
  exports: [ReviewService, ReviewDetectionService],
})
export class ReviewModule {}
