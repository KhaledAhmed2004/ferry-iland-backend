-- Round trip / same day return fares move from Route to Schedule (set per trip by the operator).

-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN     "adultRoundTripFare" DOUBLE PRECISION,
ADD COLUMN     "adultSameDayFare" DOUBLE PRECISION,
ADD COLUMN     "childRoundTripFare" DOUBLE PRECISION,
ADD COLUMN     "childSameDayFare" DOUBLE PRECISION;

-- Keep today's prices: every trip takes its route's current bundle fares.
UPDATE "Schedule" s
SET "adultRoundTripFare" = r."adultRoundTripFare",
    "childRoundTripFare" = r."childRoundTripFare",
    "adultSameDayFare"   = r."adultSameDayFare",
    "childSameDayFare"   = r."childSameDayFare"
FROM "Route" r
WHERE s."routeId" = r."id";

-- AlterTable
ALTER TABLE "Route" DROP COLUMN "adultRoundTripFare",
DROP COLUMN "adultSameDayFare",
DROP COLUMN "childRoundTripFare",
DROP COLUMN "childSameDayFare";
