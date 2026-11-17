import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { PrismaModule } from './common/prisma/prisma.module';
import { TenancyModule } from './common/tenancy/tenancy.module';
import { AppConfigModule } from './config/config.module';
import { loadConfig } from './config/configuration';
import { AccountsModule } from './modules/accounts/accounts.module';
import { AuthModule } from './modules/auth/auth.module';
import { ClassificationModule } from './modules/classification/classification.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { HealthModule } from './modules/health/health.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { ReviewModule } from './modules/review/review.module';
import { TransactionsModule } from './modules/transactions/transactions.module';

const config = loadConfig();

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: config.logLevel,
        // Correlate every log line with the request id set by the middleware.
        genReqId: (req) => (req as { id?: string }).id ?? '-',
        autoLogging: config.nodeEnv !== 'test',
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password'],
          remove: true,
        },
        transport:
          config.nodeEnv === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } }
            : undefined,
      },
    }),
    // Named limiter used only by the login route; see AuthController.
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'login',
          limit: config.auth.loginRateLimit,
          ttl: config.auth.loginRateTtlMs,
        },
      ],
    }),
    PrismaModule,
    TenancyModule,
    AuthModule,
    AccountsModule,
    ClassificationModule,
    DashboardModule,
    ReviewModule,
    JobsModule,
    TransactionsModule,
    HealthModule,
  ],
})
export class AppModule {}
