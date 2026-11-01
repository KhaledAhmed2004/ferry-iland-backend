-- Spec 0001: payment data model and booking lifecycle (expand phase).
-- Hand edited from the Prisma diff: new Payment columns are added nullable, backfilled, then set NOT NULL.
-- The old Float columns and transactionId stay (nullable, unused) until the contract migration (scope feature 9).

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'MANUAL', 'LEGACY_SEED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundReason" AS ENUM ('CUSTOMER_CANCEL', 'ADMIN', 'TRIP_CANCELLED', 'LATE_PAYMENT');

-- AlterEnum (new values are not used anywhere else in this migration)
ALTER TYPE "BookingStatus" ADD VALUE 'EXPIRED';
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';
ALTER TYPE "PaymentStatus" ADD VALUE 'CANCELED';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "expiredAt" TIMESTAMP(3),
ADD COLUMN     "holdExpiresAt" TIMESTAMP(3);

-- AlterTable: expand Payment
ALTER TABLE "Payment" ADD COLUMN     "amountCents" INTEGER,
ADD COLUMN     "commissionRate" DOUBLE PRECISION,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'usd',
ADD COLUMN     "lastFailureCode" TEXT,
ADD COLUMN     "lastFailureMessage" TEXT,
ADD COLUMN     "operatorPayoutCents" INTEGER,
ADD COLUMN     "platformCommissionCents" INTEGER,
ADD COLUMN     "provider" "PaymentProvider",
ADD COLUMN     "stripePaymentIntentId" TEXT,
ALTER COLUMN "amount" DROP NOT NULL,
ALTER COLUMN "platformCommission" DROP NOT NULL,
ALTER COLUMN "operatorPayout" DROP NOT NULL;

-- Backfill: every existing payment came from the old fake flow, so it becomes LEGACY_SEED.
-- Cents use ROUND(x * 100)::int. Payout is the remainder, so the split always sums exactly.
UPDATE "Payment" SET
  "amountCents" = ROUND(COALESCE("amount", 0)::numeric * 100)::int,
  "platformCommissionCents" = ROUND(COALESCE("platformCommission", 0)::numeric * 100)::int,
  "provider" = 'LEGACY_SEED',
  "commissionRate" = CASE
    WHEN COALESCE("amount", 0) > 0
      THEN ROUND((COALESCE("platformCommission", 0) / "amount" * 100)::numeric, 4)::double precision
    ELSE COALESCE((SELECT "commissionRate" FROM "PlatformSetting" ORDER BY "createdAt" ASC LIMIT 1), 10.0)
  END;
UPDATE "Payment" SET "operatorPayoutCents" = "amountCents" - "platformCommissionCents";

ALTER TABLE "Payment" ALTER COLUMN "amountCents" SET NOT NULL,
ALTER COLUMN "commissionRate" SET NOT NULL,
ALTER COLUMN "operatorPayoutCents" SET NOT NULL,
ALTER COLUMN "platformCommissionCents" SET NOT NULL,
ALTER COLUMN "provider" SET NOT NULL;

-- Money invariants enforced by the database. Prisma does not manage CHECK constraints, so they are kept by hand.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amountCents_nonnegative" CHECK ("amountCents" >= 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_split_sums_to_amount"
  CHECK ("platformCommissionCents" + "operatorPayoutCents" = "amountCents");

-- Seats can never go negative. Repair any bad row first so the constraint can apply.
UPDATE "Schedule" SET "availableSeats" = 0 WHERE "availableSeats" < 0;
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_availableSeats_nonnegative" CHECK ("availableSeats" >= 0);

-- AlterTable
ALTER TABLE "PlatformSetting" ADD COLUMN     "seatHoldMinutes" INTEGER NOT NULL DEFAULT 15;

-- CreateTable
CREATE TABLE "Refund" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" "RefundReason" NOT NULL,
    "stripeRefundId" TEXT,
    "requestedByUserId" UUID,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Refund_amountCents_positive" CHECK ("amountCents" > 0)
);

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "paymentId" UUID,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Refund_stripeRefundId_key" ON "Refund"("stripeRefundId");

-- CreateIndex
CREATE INDEX "Refund_paymentId_idx" ON "Refund"("paymentId");

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_paymentId_idx" ON "StripeWebhookEvent"("paymentId");

-- CreateIndex
CREATE INDEX "Booking_status_holdExpiresAt_idx" ON "Booking"("status", "holdExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripePaymentIntentId_key" ON "Payment"("stripePaymentIntentId");

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripeWebhookEvent" ADD CONSTRAINT "StripeWebhookEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
