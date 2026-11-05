-- Phase 2: local delivery (docs/PLAN.md Phase 2).
--
-- Shopping complexes, which a store may belong to (one fee and one delivery
-- radius per complex); the delivery's handover code (encrypted) and its attempt
-- count; and the assigned and en-route times. Additive only: nothing is dropped
-- and no existing row changes, so it is safe on a database holding data.

-- AlterTable
ALTER TABLE "ride"."Delivery" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "enRouteAt" TIMESTAMP(3),
ADD COLUMN     "handoverAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "handoverCodeEnc" TEXT;

-- AlterTable
ALTER TABLE "ride"."Store" ADD COLUMN     "complexId" TEXT;

-- CreateTable
CREATE TABLE "ride"."Complex" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "deliveryRadiusKm" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 20,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Complex_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Complex_slug_key" ON "ride"."Complex"("slug");

-- CreateIndex
CREATE INDEX "Delivery_status_riderId_idx" ON "ride"."Delivery"("status", "riderId");

-- CreateIndex
CREATE INDEX "Store_complexId_idx" ON "ride"."Store"("complexId");

-- AddForeignKey
ALTER TABLE "ride"."Store" ADD CONSTRAINT "Store_complexId_fkey" FOREIGN KEY ("complexId") REFERENCES "ride"."Complex"("id") ON DELETE SET NULL ON UPDATE CASCADE;
