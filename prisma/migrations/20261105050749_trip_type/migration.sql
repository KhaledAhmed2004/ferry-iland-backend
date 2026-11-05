-- CreateEnum
CREATE TYPE "TripType" AS ENUM ('ONE_WAY', 'ROUND_TRIP', 'SAME_DAY_RETURN');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "returnScheduleId" UUID,
ADD COLUMN     "tripType" "TripType" NOT NULL DEFAULT 'ONE_WAY';

-- AlterTable
ALTER TABLE "Route" ADD COLUMN     "adultRoundTripFare" DOUBLE PRECISION,
ADD COLUMN     "adultSameDayFare" DOUBLE PRECISION,
ADD COLUMN     "childRoundTripFare" DOUBLE PRECISION,
ADD COLUMN     "childSameDayFare" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "Booking_returnScheduleId_idx" ON "Booking"("returnScheduleId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_returnScheduleId_fkey" FOREIGN KEY ("returnScheduleId") REFERENCES "Schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
