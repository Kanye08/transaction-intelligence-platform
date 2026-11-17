import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { PrismaModule } from './common/prisma/prisma.module';
import { AppConfigModule } from './config/config.module';
import { loadConfig } from './config/configuration';
import { HealthModule } from './modules/health/health.module';

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
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}
