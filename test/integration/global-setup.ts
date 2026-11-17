import { execSync } from 'child_process';
import path from 'path';
import { testDatabaseUrl } from './test-db-url';

/** Runs once per `npm run test:int`: creates the test DB if missing and syncs it to schema.prisma. */
export default function setup() {
  const cwd = path.join(__dirname, '..', '..');
  const env = { ...process.env, DATABASE_URL: testDatabaseUrl() };
  execSync('npx prisma db push --skip-generate --accept-data-loss', { cwd, env, stdio: 'inherit' });

  // `db push` cannot express partial unique indexes; add the ones migrations create by hand
  // (spec 0004), so tests run against the same invariants as a migrated database.
  execSync(`npx prisma db execute --stdin --url "${testDatabaseUrl()}"`, {
    cwd,
    env,
    stdio: ['pipe', 'inherit', 'inherit'],
    input: [
      `CREATE UNIQUE INDEX IF NOT EXISTS "booking_request_one_pending" ON "BookingRequest"("bookingId") WHERE "status" = 'PENDING';`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "refund_one_live_cancel" ON "Refund"("paymentId") WHERE "reason" IN ('CUSTOMER_CANCEL', 'ADMIN') AND "status" <> 'FAILED';`,
    ].join('\n'),
  });
}
