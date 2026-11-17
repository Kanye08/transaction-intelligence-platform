import { Global, Module } from '@nestjs/common';
import { config as loadDotEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { AppConfig, CONFIG_TOKEN, loadConfig } from './configuration';

/**
 * The repository keeps a single .env at its root so backend, Prisma CLI and
 * scripts all read the same values. __dirname is backend/dist or backend/src
 * depending on how the process was started; both are one level below backend/.
 */
function loadEnvFile(): void {
  const candidates = [
    resolve(__dirname, '../../../.env'),
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../.env'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      loadDotEnv({ path: candidate, override: false });
      return;
    }
  }
}

loadEnvFile();

@Global()
@Module({
  providers: [
    {
      provide: CONFIG_TOKEN,
      useFactory: (): AppConfig => loadConfig(),
    },
  ],
  exports: [CONFIG_TOKEN],
})
export class AppConfigModule {}
