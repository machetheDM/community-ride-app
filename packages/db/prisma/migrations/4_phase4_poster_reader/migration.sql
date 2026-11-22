-- Phase 4: language-model calls (docs/PLAN.md 4.3 to 4.5, ADR 0008).
-- One row per call: latency, tokens, cost, prompt version and outcome (PRACTICES ML-7),
-- and for a poster read the checked proposal an admin may apply to a draft event.

-- CreateEnum
CREATE TYPE "ride"."ModelCallOutcome" AS ENUM ('OK', 'INVALID', 'ERROR');

-- CreateTable
CREATE TABLE "ride"."ModelCall" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costUsd" DECIMAL(12,6),
    "outcome" "ride"."ModelCallOutcome" NOT NULL,
    "errorKind" TEXT,
    "eventId" TEXT,
    "posterSha256" TEXT,
    "proposal" JSONB,
    "setAside" JSONB,
    "problem" TEXT,
    "requestedById" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "appliedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModelCall_createdAt_idx" ON "ride"."ModelCall"("createdAt");

-- CreateIndex
CREATE INDEX "ModelCall_eventId_createdAt_idx" ON "ride"."ModelCall"("eventId", "createdAt");

-- AddForeignKey
ALTER TABLE "ride"."ModelCall" ADD CONSTRAINT "ModelCall_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ride"."Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

