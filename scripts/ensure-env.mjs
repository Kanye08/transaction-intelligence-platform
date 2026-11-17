/**
 * Creates a local .env from .env.example when one does not exist yet, and
 * replaces the placeholder JWT secret with a freshly generated one so no
 * installation ever runs on a shared, published secret.
 *
 * Keeps `npm install` / `npm run setup` deterministic on every platform.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const examplePath = join(root, '.env.example');

if (existsSync(envPath)) {
  console.log('[setup] .env already present - leaving it untouched.');
} else {
  const secret = randomBytes(48).toString('hex');
  const contents = readFileSync(examplePath, 'utf8').replace(
    /^JWT_SECRET=.*$/m,
    `JWT_SECRET="${secret}"`,
  );
  writeFileSync(envPath, contents);
  console.log('[setup] created .env from .env.example with a generated JWT_SECRET.');
}
