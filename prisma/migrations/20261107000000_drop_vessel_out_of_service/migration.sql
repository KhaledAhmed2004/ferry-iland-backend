-- Out of Service is no longer a ferry status. Existing ferries move to MAINTENANCE.
UPDATE "Ferry" SET "status" = 'MAINTENANCE' WHERE "status" = 'OUT_OF_SERVICE';

-- AlterEnum: Postgres cannot drop an enum value, so swap in a new type.
ALTER TYPE "VesselStatus" RENAME TO "VesselStatus_old";
CREATE TYPE "VesselStatus" AS ENUM ('IN_SERVICE', 'MAINTENANCE');
ALTER TABLE "Ferry" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Ferry" ALTER COLUMN "status" TYPE "VesselStatus" USING ("status"::text::"VesselStatus");
ALTER TABLE "Ferry" ALTER COLUMN "status" SET DEFAULT 'IN_SERVICE';
DROP TYPE "VesselStatus_old";
