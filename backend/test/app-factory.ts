import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { AppConfig, CONFIG_TOKEN } from '../src/config/configuration';

/**
 * Builds the real application for integration tests: same modules, same
 * pipes, same exception filter, same guards. Only the database and the logger
 * differ from production, so the tests exercise genuine behaviour rather than
 * a mocked stand-in.
 */
export async function createTestApp(
  overrides: (builder: ReturnType<typeof Test.createTestingModule>) => void = () => {},
): Promise<INestApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  overrides(builder);

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, app.get<AppConfig>(CONFIG_TOKEN));
  await app.init();
  return app;
}
