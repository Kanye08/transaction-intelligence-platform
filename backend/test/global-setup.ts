import { resetTestDatabase, TEST_DATABASE_URL } from './test-database';

/** Runs once before the suite: a fresh, migrated SQLite database. */
export default function globalSetup(): void {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  resetTestDatabase();
}
