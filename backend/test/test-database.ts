import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Tests run against their own SQLite file, never the development database.
 * The path is relative to backend/prisma/schema.prisma, which is how both the
 * Prisma CLI and the generated client resolve SQLite URLs.
 */
export const TEST_DATABASE_URL = 'file:./test.db';

const SCHEMA_PATH = resolve(__dirname, '../prisma/schema.prisma');
const TEST_DB_FILE = resolve(__dirname, '../prisma/test.db');

/** Deletes and re-migrates the test database. Runs once per `npm test`. */
export function resetTestDatabase(): void {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const file = `${TEST_DB_FILE}${suffix}`;
    if (existsSync(file)) rmSync(file, { force: true });
  }

  // Invoke the Prisma CLI through node directly: spawning npx.cmd is rejected
  // by Node on Windows, and this keeps the command identical on every OS.
  const prismaCli = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', SCHEMA_PATH], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'ignore',
  });
}
