import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Spec 0001 AC-8: the payment lifecycle migration backfills legacy payments without losing a row.
 *
 * Runs the real migration files against a throwaway Postgres schema inside the *_test database:
 * every migration before `20261031010000_payment_lifecycle` builds the old shape, a fixture of
 * legacy Float payments is inserted, then the payment lifecycle migration runs on top of it.
 * Run with `npm run test:int`.
 */
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const TARGET = '20261031010000_payment_lifecycle';
const SCHEMA = `mig_fixture_${Date.now().toString(36)}`;

/** Splits a Prisma migration file into single statements (these files have no dollar-quoted blocks). */
function statements(file: string): string[] {
  const sql = fs
    .readFileSync(path.join(MIGRATIONS_DIR, file, 'migration.sql'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function runMigration(db: PrismaClient, name: string) {
  for (const stmt of statements(name)) await db.$executeRawUnsafe(stmt);
}

// Legacy rows as the old fake flow wrote them: Float money, a TXN- id, values that do not land on
// exact binary fractions, a zero amount, and a large amount.
const LEGACY = [
  { amount: 30, platformCommission: 3, operatorPayout: 27 },
  { amount: 19.99, platformCommission: 1.999, operatorPayout: 17.991 },
  { amount: 0.1 + 0.2, platformCommission: 0.03, operatorPayout: 0.27 },
  { amount: 33.335, platformCommission: 3.3335, operatorPayout: 30.0015 },
  { amount: 1.005, platformCommission: 0.1005, operatorPayout: 0.9045 },
  { amount: 0, platformCommission: 0, operatorPayout: 0 },
  { amount: 98765.43, platformCommission: 9876.543, operatorPayout: 88888.887 },
].map((row, i) => ({ id: randomUUID(), bookingId: randomUUID(), transactionId: `TXN-LEGACY-${i}`, ...row }));

const SETTING_RATE = 12.5;

let db: PrismaClient;

type MigratedPayment = {
  id: string;
  transactionId: string | null;
  amount: number | null;
  platformCommission: number | null;
  operatorPayout: number | null;
  amountCents: number;
  platformCommissionCents: number;
  operatorPayoutCents: number;
  commissionRate: number;
  provider: string;
  currency: string;
};

beforeAll(async () => {
  // vitest.integration.config.ts already points DATABASE_URL at the *_test database.
  const url = new URL(process.env.DATABASE_URL!);
  if (!url.pathname.endsWith('_test')) throw new Error(`Refusing to run against "${url.pathname}" (not *_test)`);
  url.searchParams.set('schema', SCHEMA);
  url.searchParams.set('connection_limit', '1');
  db = new PrismaClient({ datasourceUrl: url.toString() });

  await db.$executeRawUnsafe(`CREATE SCHEMA "${SCHEMA}"`);

  const before = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name < TARGET)
    .map((d) => d.name)
    .sort();
  for (const name of before) await runMigration(db, name);

  // The fixture tests money columns only; bookings are not part of what this migration changes.
  await db.$executeRawUnsafe(`ALTER TABLE "Payment" DROP CONSTRAINT "Payment_bookingId_fkey"`);
  await db.$executeRawUnsafe(
    `INSERT INTO "PlatformSetting" ("id", "commissionRate", "updatedAt") VALUES ($1::uuid, $2, NOW())`,
    randomUUID(),
    SETTING_RATE,
  );
  for (const p of LEGACY) {
    await db.$executeRawUnsafe(
      `INSERT INTO "Payment" ("id", "bookingId", "transactionId", "amount", "platformCommission", "operatorPayout", "status", "updatedAt")
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, 'COMPLETED', NOW())`,
      p.id,
      p.bookingId,
      p.transactionId,
      p.amount,
      p.platformCommission,
      p.operatorPayout,
    );
  }

  await runMigration(db, TARGET);
}, 120_000);

afterAll(async () => {
  if (!db) return;
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await db.$disconnect();
});

async function migrated(): Promise<MigratedPayment[]> {
  return db.$queryRawUnsafe<MigratedPayment[]>(`SELECT * FROM "Payment"`);
}

describe('payment lifecycle migration backfill (spec 0001 AC-8)', () => {
  it('keeps every legacy row', async () => {
    const rows = await migrated();
    expect(rows).toHaveLength(LEGACY.length);
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set(LEGACY.map((p) => p.id)));
  });

  it('marks every existing row LEGACY_SEED in usd', async () => {
    for (const r of await migrated()) {
      expect(r.provider).toBe('LEGACY_SEED');
      expect(r.currency).toBe('usd');
    }
  });

  it('fills cents within 1 cent of the old Float amount, and the split sums exactly', async () => {
    const byId = new Map(LEGACY.map((p) => [p.id, p]));
    for (const r of await migrated()) {
      const old = byId.get(r.id)!;
      expect(Number.isInteger(r.amountCents)).toBe(true);
      expect(Math.abs(r.amountCents - old.amount * 100)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.platformCommissionCents - old.platformCommission * 100)).toBeLessThanOrEqual(1);
      expect(r.platformCommissionCents + r.operatorPayoutCents).toBe(r.amountCents);
    }
  });

  it('keeps the old Float columns and transactionId unchanged', async () => {
    const byId = new Map(LEGACY.map((p) => [p.id, p]));
    for (const r of await migrated()) {
      const old = byId.get(r.id)!;
      expect(r.transactionId).toBe(old.transactionId);
      expect(r.amount).toBeCloseTo(old.amount, 9);
      expect(r.platformCommission).toBeCloseTo(old.platformCommission, 9);
      expect(r.operatorPayout).toBeCloseTo(old.operatorPayout, 9);
    }
  });

  it('derives the commission rate from the row, or from PlatformSetting when the amount is zero', async () => {
    const byId = new Map(LEGACY.map((p) => [p.id, p]));
    for (const r of await migrated()) {
      const old = byId.get(r.id)!;
      if (old.amount > 0) expect(r.commissionRate).toBeCloseTo((old.platformCommission / old.amount) * 100, 3);
      else expect(r.commissionRate).toBe(SETTING_RATE);
    }
  });

  it('enforces the new money CHECK constraints on the migrated table', async () => {
    const id = LEGACY[0].id;
    await expect(
      db.$executeRawUnsafe(`UPDATE "Payment" SET "amountCents" = -1 WHERE "id" = $1::uuid`, id),
    ).rejects.toThrow(/Payment_amountCents_nonnegative|Payment_split_sums_to_amount/);
    await expect(
      db.$executeRawUnsafe(`UPDATE "Payment" SET "operatorPayoutCents" = "operatorPayoutCents" + 1 WHERE "id" = $1::uuid`, id),
    ).rejects.toThrow(/Payment_split_sums_to_amount/);
  });
});
