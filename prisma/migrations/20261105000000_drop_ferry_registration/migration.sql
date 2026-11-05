-- DropIndex
DROP INDEX IF EXISTS "Ferry_registration_key";

-- AlterTable
ALTER TABLE "Ferry" DROP COLUMN IF EXISTS "registration";
