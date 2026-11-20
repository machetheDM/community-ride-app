import { NextRequest } from "next/server";
import { recordAuditStrict } from "@ride/db";
import { feeOn } from "@ride/db/trips";
import { prisma } from "@/lib/prisma";
import { auditRefusals, requireViewer } from "@/lib/actor";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { ConcealedRecordError, ConflictError, NotFoundError } from "@/lib/errors";
import { operatorOf } from "@/lib/group-trips";

/**
 * The operator finishes a group trip, after it has left.
 *
 * Boarded passengers complete; booked passengers who never boarded are no-shows.
 * Our fee is the trip's fixed rate on what the boarded passengers agreed to pay,
 * recorded as a FEE_DUE ledger row (AGENTS.md non-negotiable 3: money is events,
 * the balance is derived). The operator collected the fares in cash; we never
 * held them (non-negotiable 2). The ledger's unique key on the trip means a
 * retried completion cannot charge twice.
 */
export const POST = withErrorHandler(async (req: NextRequest, ctx) => {
  const viewer = await requireViewer(req);
  const { id } = await ctx.params;

  const result = await auditRefusals(viewer, { action: "group_trip.complete", entityType: "GroupTrip", entityId: id }, async () => {
    const driver = operatorOf(viewer);
    const trip = await prisma.groupTrip.findUnique({
      where: { id },
      select: { status: true, driverId: true, departAt: true, platformFeePercent: true },
    });
    if (!trip) throw new NotFoundError("Group trip");
    if (trip.driverId !== driver.id) throw new ConcealedRecordError("Group trip");
    if (trip.status !== "BOOKED") throw new ConflictError("Only a booked trip can be completed");
    if (trip.departAt.getTime() > Date.now()) throw new ConflictError("This trip has not left yet");

    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const done = await tx.groupTrip.updateMany({ where: { id, status: "BOOKED", driverId: driver.id }, data: { status: "COMPLETED", completedAt: now } });
      if (done.count !== 1) throw new ConflictError("This trip changed while you were completing it");

      const boarded = await tx.tripRequest.findMany({ where: { groupTripId: id, status: "BOARDED" }, select: { seats: true, pricePerSeat: true } });
      await tx.tripRequest.updateMany({ where: { groupTripId: id, status: "BOARDED" }, data: { status: "COMPLETED", checkInCodeEnc: null } });
      const noShows = await tx.tripRequest.updateMany({ where: { groupTripId: id, status: "BOOKED" }, data: { status: "NO_SHOW", checkInCodeEnc: null } });

      const fares = Math.round(boarded.reduce((sum, r) => sum + r.seats * Number(r.pricePerSeat), 0) * 100) / 100;
      const fee = feeOn(fares, trip.platformFeePercent ?? 0);
      if (fee > 0) {
        await tx.ledgerEntry.create({
          data: { operatorUserId: viewer.userId, kind: "FEE_DUE", amount: fee.toFixed(2), sourceType: "GROUP_TRIP", sourceId: id },
        });
      }

      await recordAuditStrict(tx, {
        actorUserId: viewer.userId,
        actorRole: viewer.role,
        action: "group_trip.complete",
        entityType: "GroupTrip",
        entityId: id,
        detail: { fares, fee, boarded: boarded.length, noShows: noShows.count, platformFeePercent: trip.platformFeePercent },
      });
      return { id, status: "COMPLETED", fares, fee, boarded: boarded.length, noShows: noShows.count };
    });
  });

  return ok(result);
});
