-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_userId_fkey";

-- DropTable
DROP TABLE "AuditLog";

-- DropEnum
DROP TYPE "AuditAction";
