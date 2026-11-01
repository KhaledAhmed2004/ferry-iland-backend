import dotenv from 'dotenv';
import path from 'path';

/**
 * Integration tests run against a separate database, never the dev one.
 * TEST_DATABASE_URL wins; otherwise DATABASE_URL from .env with `_test` appended to the DB name
 * (nest_auth_db → nest_auth_db_test). Refuses any URL whose DB name doesn't end in `_test`,
 * because the tests truncate every table.
 */
export const testDatabaseUrl = (): string => {
  dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

  const explicit = process.env.TEST_DATABASE_URL;
  const base = explicit ?? process.env.DATABASE_URL;
  if (!base) throw new Error('Set TEST_DATABASE_URL or DATABASE_URL (backend/.env) for integration tests.');

  const url = new URL(base);
  const dbName = url.pathname.replace(/^\//, '');
  if (!explicit) url.pathname = `/${dbName}_test`;

  const finalName = url.pathname.replace(/^\//, '');
  if (!finalName.endsWith('_test')) {
    throw new Error(`Refusing to run integration tests against "${finalName}" — DB name must end with _test.`);
  }
  return url.toString();
};
