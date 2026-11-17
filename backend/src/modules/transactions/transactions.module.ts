import { Module } from '@nestjs/common';

import { IdempotencyModule } from '../idempotency/idempotency.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsQueryService } from './transactions-query.service';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [IdempotencyModule],
  controllers: [TransactionsController],
  providers: [TransactionsService, TransactionsQueryService],
  exports: [TransactionsService, TransactionsQueryService],
})
export class TransactionsModule {}
