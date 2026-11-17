import { Global, Module } from '@nestjs/common';

import { ClassificationModule } from '../classification/classification.module';
import { ReviewModule } from '../review/review.module';
import { JobsService } from './jobs.service';
import { JobsWorker } from './jobs.worker';

@Global()
@Module({
  imports: [ClassificationModule, ReviewModule],
  providers: [JobsService, JobsWorker],
  exports: [JobsService, JobsWorker],
})
export class JobsModule {}
