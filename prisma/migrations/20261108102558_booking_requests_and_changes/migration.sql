-- CreateEnum
CREATE TYPE "BookingRequestType" AS ENUM ('CANCEL', 'RESCHEDULE');

-- CreateEnum
CREATE TYPE "BookingRequestStatus" AS ENUM ('PENDING', 'CANCELLED', 'RESCHEDULED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "BookingLeg" AS ENUM ('OUTBOUND', 'RETURN');

-- CreateTable
CREATE TABLE "BookingRequest" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "type" "BookingRequestType" NOT NULL,
    "status" "BookingRequestStatus" NOT NULL DEFAULT 'PENDING',
    "leg" "BookingLeg",
    "reason" TEXT,
    "preferredScheduleId" UUID,
    "preferredReturnScheduleId" UUID,
    "requestedByUserId" UUID,
    "resolvedByUserId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "staffNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingChange" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "leg" "BookingLeg" NOT NULL,
    "fromScheduleId" UUID NOT NULL,
    "toScheduleId" UUID NOT NULL,
    "requestId" UUID,
    "changedByUserId" UUID,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingRequest_bookingId_status_idx" ON "BookingRequest"("bookingId", "status");

-- CreateIndex
CREATE INDEX "BookingRequest_status_createdAt_idx" ON "BookingRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BookingChange_bookingId_createdAt_idx" ON "BookingChange"("bookingId", "createdAt");

-- AddForeignKey
ALTER TABLE "BookingRequest" ADD CONSTRAINT "BookingRequest_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingRequest" ADD CONSTRAINT "BookingRequest_preferredScheduleId_fkey" FOREIGN KEY ("preferredScheduleId") REFERENCES "Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingRequest" ADD CONSTRAINT "BookingRequest_preferredReturnScheduleId_fkey" FOREIGN KEY ("preferredReturnScheduleId") REFERENCES "Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingRequest" ADD CONSTRAINT "BookingRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingRequest" ADD CONSTRAINT "BookingRequest_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingChange" ADD CONSTRAINT "BookingChange_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingChange" ADD CONSTRAINT "BookingChange_fromScheduleId_fkey" FOREIGN KEY ("fromScheduleId") REFERENCES "Schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingChange" ADD CONSTRAINT "BookingChange_toScheduleId_fkey" FOREIGN KEY ("toScheduleId") REFERENCES "Schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingChange" ADD CONSTRAINT "BookingChange_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "BookingRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingChange" ADD CONSTRAINT "BookingChange_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Spec 0004: at most one PENDING request per booking.
CREATE UNIQUE INDEX "booking_request_one_pending" ON "BookingRequest"("bookingId") WHERE "status" = 'PENDING';

-- Spec 0004: at most one live (not FAILED) cancel refund per payment.
CREATE UNIQUE INDEX "refund_one_live_cancel" ON "Refund"("paymentId") WHERE "reason" IN ('CUSTOMER_CANCEL', 'ADMIN') AND "status" <> 'FAILED';
