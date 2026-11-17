import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { IdempotencyService } from '../idempotency/idempotency.service';
import {
  BatchCreateTransactionsDto,
  CreateTransactionDto,
} from './dto/create-transaction.dto';
import { QueryTransactionsDto } from './dto/query-transactions.dto';
import { TransactionDto } from './dto/transaction.dto';
import { TransactionsQueryService, TransactionPage } from './transactions-query.service';
import { BatchResult, TransactionsService } from './transactions.service';

const IDEMPOTENCY_HEADER = 'Idempotency-Key';

@ApiTags('transactions')
@ApiBearerAuth('bearer')
@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly transactions: TransactionsService,
    private readonly query: TransactionsQueryService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Import a single transaction',
    description:
      'Persists the transaction and schedules classification asynchronously. ' +
      'The response is returned without waiting for any AI provider. ' +
      'Re-sending the same externalReference for the same account returns the ' +
      'existing transaction with status DUPLICATE and HTTP 200.',
  })
  @ApiHeader({
    name: IDEMPOTENCY_HEADER,
    required: false,
    description:
      'Optional. The same key replays the original response; the same key with a ' +
      'different payload is rejected with 409.',
  })
  @ApiCreatedResponse({ description: 'Transaction created', type: TransactionDto })
  @ApiOkResponse({ description: 'Transaction already existed (duplicate or replay)' })
  @ApiConflictResponse({ description: 'Idempotency key reused with a different payload' })
  @ApiNotFoundResponse({ description: 'Account not found in this organisation' })
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTransactionDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<unknown> {
    return this.withIdempotency(user, idempotencyKey, 'POST /transactions', dto, res, async () => {
      const outcome = await this.transactions.ingestOne(user, dto);
      return {
        statusCode: outcome.status === 'CREATED' ? HttpStatus.CREATED : HttpStatus.OK,
        body: outcome,
      };
    });
  }

  @Post('batch')
  @HttpCode(HttpStatus.MULTI_STATUS)
  @ApiOperation({
    summary: 'Import transactions in bulk, with partial success',
    description:
      'Always returns 207 Multi-Status: each row reports CREATED, DUPLICATE or ' +
      'FAILED with its own error detail. Invalid or duplicate rows never reject ' +
      'the valid ones.',
  })
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: false })
  @ApiBody({ type: BatchCreateTransactionsDto })
  async createBatch(
    @CurrentUser() user: AuthUser,
    @Body() dto: BatchCreateTransactionsDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<unknown> {
    return this.withIdempotency(
      user,
      idempotencyKey,
      'POST /transactions/batch',
      dto,
      res,
      async () => {
        const result: BatchResult = await this.transactions.ingestBatch(user, dto.transactions);
        return { statusCode: HttpStatus.MULTI_STATUS, body: result };
      },
    );
  }

  @Get()
  @ApiOperation({
    summary: 'List transactions with filtering, search and cursor pagination',
  })
  @ApiOkResponse({ description: 'A page of transactions plus pagination metadata' })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryTransactionsDto,
  ): Promise<TransactionPage> {
    return this.query.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retrieve one transaction with its classification and review flags' })
  @ApiOkResponse({ type: TransactionDto })
  @ApiNotFoundResponse({ description: 'No such transaction in this organisation' })
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<TransactionDto> {
    return this.query.findOne(user, id);
  }

  /**
   * Wraps a write in Idempotency-Key handling: replay a completed key, reject
   * a reused key with a different payload, and release the key if the work
   * itself failed so the caller can retry.
   */
  private async withIdempotency(
    user: AuthUser,
    key: string | undefined,
    endpoint: string,
    payload: unknown,
    res: Response,
    work: () => Promise<{ statusCode: number; body: unknown }>,
  ): Promise<unknown> {
    if (!key) {
      const { statusCode, body } = await work();
      res.status(statusCode);
      return body;
    }

    const outcome = await this.idempotency.begin(user.organisationId, key, endpoint, payload);
    if (outcome.replayed) {
      res.status(outcome.statusCode);
      res.setHeader('Idempotency-Replayed', 'true');
      return outcome.body;
    }

    try {
      const { statusCode, body } = await work();
      await this.idempotency.complete(user.organisationId, key, statusCode, body);
      res.status(statusCode);
      return body;
    } catch (error) {
      await this.idempotency.abandon(user.organisationId, key);
      throw error;
    }
  }
}
