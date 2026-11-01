import { execSync } from 'child_process';
import path from 'path';
import { testDatabaseUrl } from './test-db-url';

/** Runs once per `npm run test:int`: creates the test DB if missing and syncs it to schema.prisma. */
export default function setup() {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'inherit',
  });
}
