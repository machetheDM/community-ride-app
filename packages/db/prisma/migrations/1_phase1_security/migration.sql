-- Phase 1 security: hashed one-time passwords, encrypted ID numbers, token
-- revocation, ride and order lifecycle timestamps, and the audit log.
--
-- Two deliberate data losses, both safe because no real data exists yet:
--   * Outstanding one-time passwords are deleted. They live ten minutes, and the
--     new codeHash column is required, so old rows could not be kept anyway.
--   * Driver and Rider "idNumber" are dropped, not migrated. The only rows are
--     demo seed data, which the seed re-creates encrypted. A database holding real
--     ID numbers would need an encrypt-in-place backfill before this ran.

-- Clear short-lived codes before the required column is added.
DELETE FROM "ride"."OtpCode";

-- DropIndex
DROP INDEX "ride"."Driver_idNumber_key";

-- DropIndex
DROP INDEX "ride"."OtpCode_phone_idx";

-- DropIndex
DROP INDEX "ride"."Rider_idNumber_key";

-- AlterTable
ALTER TABLE "ride"."Driver" DROP COLUMN "idNumber",
ADD COLUMN     "idNumberEnc" TEXT,
ADD COLUMN     "idNumberHash" TEXT,
ADD COLUMN     "idNumberLast4" TEXT;

-- AlterTable
ALTER TABLE "ride"."Order" ADD COLUMN     "cancelledBy" TEXT,
ADD COLUMN     "readyAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ride"."OtpCode" DROP COLUMN "code",
ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "codeHash" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ride"."Ride" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" TEXT;

-- AlterTable
ALTER TABLE "ride"."Rider" DROP COLUMN "idNumber",
ADD COLUMN     "idNumberEnc" TEXT,
ADD COLUMN     "idNumberHash" TEXT,
ADD COLUMN     "idNumberLast4" TEXT;

-- AlterTable
ALTER TABLE "ride"."User" ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ride"."AuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "ip" TEXT,
    "detail" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "ride"."AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "ride"."AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "ride"."AuditLog"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_idNumberHash_key" ON "ride"."Driver"("idNumberHash");

-- CreateIndex
CREATE INDEX "OtpCode_phone_createdAt_idx" ON "ride"."OtpCode"("phone", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Rider_idNumberHash_key" ON "ride"."Rider"("idNumberHash");
