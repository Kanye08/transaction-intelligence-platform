import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express from 'express';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import { AppConfig, CONFIG_TOKEN } from './config/configuration';

/**
 * Defensive fallback only. The API contract is that money is serialised by the
 * response DTOs (amount / amountMinor / formattedAmount strings); this merely
 * guarantees that an accidental BigInt can never crash JSON.stringify.
 */
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON(this: bigint) {
  return this.toString();
};

export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.use(requestIdMiddleware);

  // Strict security headers everywhere, with one carve-out: the Swagger UI
  // page bootstraps itself with an inline script, which a strict script-src
  // would block. Only the docs route gets the relaxed policy.
  const strictHeaders = helmet({ crossOriginEmbedderPolicy: false });
  const docsHeaders = helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false });
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) =>
    req.path.startsWith('/api/docs') ? docsHeaders(req, res, next) : strictHeaders(req, res, next),
  );
  app.set('trust proxy', 1);
  app.enableCors({ origin: true, credentials: true });

  // A 500-row batch import is a few hundred kilobytes; the Express default of
  // 100kb would reject it. The limit is still bounded, so an oversized body is
  // refused with 413 rather than being streamed into memory.
  app.useBodyParser('json', { limit: '5mb' });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validateCustomDecorators: true,
    }),
  );
  app.useGlobalFilters(new ProblemDetailsFilter());
}

export function configureSwagger(app: NestExpressApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Sycamore Transaction Intelligence API')
      .setDescription(
        'Multi-tenant transaction ingestion, classification, anomaly detection and review. ' +
          'All endpoints except /api/auth/login require a Bearer token; the tenant is derived ' +
          'from the token, never from the request payload.',
      )
      .setVersion('1.0.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
      .build(),
  );

  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'openapi.json',
    swaggerOptions: { persistAuthorization: true },
  });
}

/** In production the compiled React bundle is served from the same origin. */
export function serveFrontend(app: NestExpressApplication): void {
  const clientDir = resolve(__dirname, '../../frontend/dist');
  if (!existsSync(clientDir)) return;

  const server = app.getHttpAdapter().getInstance() as express.Express;
  server.use(express.static(clientDir, { index: false }));
  // SPA fallback: anything that is not an API route renders the React app.
  server.get(/^(?!\/api\/|\/openapi\.json).*/, (_req, res) => {
    res.sendFile(join(clientDir, 'index.html'));
  });
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));

  const config = app.get<AppConfig>(CONFIG_TOKEN);
  configureApp(app, config);
  configureSwagger(app);
  serveFrontend(app);
  app.enableShutdownHooks();

  await app.listen(config.port, '0.0.0.0');
  const logger = app.get(PinoLogger);
  logger.log(`API listening on http://localhost:${config.port}/api`);
  logger.log(`API docs on http://localhost:${config.port}/api/docs`);
}

if (require.main === module) {
  void bootstrap();
}
