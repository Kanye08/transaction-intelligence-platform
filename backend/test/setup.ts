import { TEST_DATABASE_URL } from './test-database';

// Runs before any module is imported: keeps tests off the development
// database and off the real logger, and makes hashing cheap.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-value-that-is-long-enough-32';
process.env.LOG_LEVEL = 'silent';
process.env.WORKER_ENABLED = 'false';
process.env.BCRYPT_ROUNDS = '4';
