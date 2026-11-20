-- Phase 3: events and negotiated group trips (docs/PLAN.md Phase 3).
--
-- Venues, events (with the poster, stripped of metadata), promotion spend and
-- page visits by channel, published pickup points, passengers' trip requests,
-- group trips, operators' documents, and the fee ledger. Also a MINIBUS vehicle
-- type and a seat count per vehicle. Additive only: nothing is dropped and no
-- existing row changes.

-- CreateEnum
CREATE TYPE "ride"."VenueKind" AS ENUM ('RESORT', 'CLUB', 'HALL', 'SPORTS', 'OTHER');

-- CreateEnum
CREATE TYPE "ride"."EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ride"."TripDirection" AS ENUM ('TO_EVENT', 'FROM_EVENT');

-- CreateEnum
CREATE TYPE "ride"."TripRequestStatus" AS ENUM ('WAITING', 'CONFIRMING', 'BOOKED', 'BOARDED', 'NO_SHOW', 'COMPLETED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ride"."GroupTripStatus" AS ENUM ('OPEN', 'COUNTERED', 'BOOKED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ride"."OperatorDocumentKind" AS ENUM ('DRIVING_PERMIT', 'OPERATING_LICENCE', 'VEHICLE_LICENCE', 'INSURANCE');

-- CreateEnum
CREATE TYPE "ride"."DocumentStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ride"."LedgerKind" AS ENUM ('FEE_DUE', 'FEE_PAID', 'ADJUSTMENT');

-- AlterEnum
ALTER TYPE "ride"."VehicleType" ADD VALUE 'MINIBUS';

-- AlterTable
ALTER TABLE "ride"."Vehicle" ADD COLUMN     "seats" INTEGER;

-- CreateTable
CREATE TABLE "ride"."Venue" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "ride"."VenueKind" NOT NULL DEFAULT 'OTHER',
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "agreementAt" TIMESTAMP(3),
    "agreementNote" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride"."Event" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "ticketInfo" TEXT,
    "status" "ride"."EventStatus" NOT NULL DEFAULT 'DRAFT',
    "posterBytes" BYTEA,
    "posterType" TEXT,
    "posterSha256" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride"."EventSpend" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "spentOn" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventSpend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride"."EventVisit" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride"."PickupPoint" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PickupPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride"."TripRequest" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "pickupPointId" TEXT NOT NULL,
    "direction" "ride"."TripDirection" NOT NULL DEFAULT 'TO_EVENT',
    "seats" INTEGER NOT NULL,
    "pricePerSeat" DECIMAL(10,2) NOT NULL,
    "status" "ride"."TripRequestStatus" NOT NULL DEFAULT 'WAITING',
    "groupTripId" TEXT,
    "channel" TEXT,
    "checkInCodeEnc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride"."GroupTrip" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "pickupPointId" TEXT NOT NULL,
    "direction" "ride"."TripDirection" NOT NULL DEFAULT 'TO_EVENT',
    "departAt" TIMESTAMP(3) NOT NULL,
    "status" "ride"."GroupTripStatus" NOT NULL DEFAULT 'OPEN',
    "driverId" TEXT,
    "counterDriverId" TEXT,
    "counterPricePerSeat" DECIMAL(10,2),
    "counteredAt" TIMESTAMP(3),
    "counterExpiresAt" TIMESTAMP(3),
    "bookedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "shareTokenHash" TEXT,
    "platformFeePercent" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride"."OperatorDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ride"."OperatorDocumentKind" NOT NULL,
    "referenceEnc" TEXT NOT NULL,
    "referenceLast4" TEXT NOT NULL,
    "expiresOn" TIMESTAMP(3),
    "status" "ride"."DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatorDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride"."LedgerEntry" (
    "id" TEXT NOT NULL,
    "operatorUserId" TEXT NOT NULL,
    "kind" "ride"."LedgerKind" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "note" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Venue_slug_key" ON "ride"."Venue"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Event_slug_key" ON "ride"."Event"("slug");

-- CreateIndex
CREATE INDEX "Event_status_startsAt_idx" ON "ride"."Event"("status", "startsAt");

-- CreateIndex
CREATE INDEX "EventSpend_eventId_idx" ON "ride"."EventSpend"("eventId");

-- CreateIndex
CREATE INDEX "EventVisit_eventId_channel_idx" ON "ride"."EventVisit"("eventId", "channel");

-- CreateIndex
CREATE INDEX "TripRequest_groupTripId_idx" ON "ride"."TripRequest"("groupTripId");

-- CreateIndex
CREATE UNIQUE INDEX "TripRequest_eventId_customerId_direction_key" ON "ride"."TripRequest"("eventId", "customerId", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "GroupTrip_shareTokenHash_key" ON "ride"."GroupTrip"("shareTokenHash");

-- CreateIndex
CREATE INDEX "GroupTrip_eventId_status_idx" ON "ride"."GroupTrip"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorDocument_userId_kind_key" ON "ride"."OperatorDocument"("userId", "kind");

-- CreateIndex
CREATE INDEX "LedgerEntry_operatorUserId_createdAt_idx" ON "ride"."LedgerEntry"("operatorUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_kind_sourceType_sourceId_key" ON "ride"."LedgerEntry"("kind", "sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "ride"."Event" ADD CONSTRAINT "Event_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "ride"."Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride"."EventSpend" ADD CONSTRAINT "EventSpend_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ride"."Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride"."EventVisit" ADD CONSTRAINT "EventVisit_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ride"."Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride"."TripRequest" ADD CONSTRAINT "TripRequest_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ride"."Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride"."TripRequest" ADD CONSTRAINT "TripRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "ride"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride"."TripRequest" ADD CONSTRAINT "TripRequest_pickupPointId_fkey" FOREIGN KEY ("pickupPointId") REFERENCES "ride"."PickupPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride"."TripRequest" ADD CONSTRAINT "TripRequest_groupTripId_fkey" FOREIGN KEY ("groupTripId") REFERENCES "ride"."GroupTrip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride"."GroupTrip" ADD CONSTRAINT "GroupTrip_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ride"."Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride"."GroupTrip" ADD CONSTRAINT "GroupTrip_pickupPointId_fkey" FOREIGN KEY ("pickupPointId") REFERENCES "ride"."PickupPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride"."GroupTrip" ADD CONSTRAINT "GroupTrip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "ride"."Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride"."GroupTrip" ADD CONSTRAINT "GroupTrip_counterDriverId_fkey" FOREIGN KEY ("counterDriverId") REFERENCES "ride"."Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride"."OperatorDocument" ADD CONSTRAINT "OperatorDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ride"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride"."LedgerEntry" ADD CONSTRAINT "LedgerEntry_operatorUserId_fkey" FOREIGN KEY ("operatorUserId") REFERENCES "ride"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
