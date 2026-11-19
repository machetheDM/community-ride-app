import { NextRequest } from "next/server";
import { recordAuditStrict } from "@ride/db";
import { prisma } from "@/lib/prisma";
import { auditRefusals, requireViewer } from "@/lib/actor";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { ConcealedRecordError, ConflictError, NotFoundError } from "@/lib/errors";
import { loadPricingPolicy } from "@/lib/fare";
import {
  CANCELLABLE_REQUEST_STATUSES,
  closeIfEmpty,
  lockPool,
  myRequestSelect,
  presentMyRequest,
  settleCounter,
} from "@/lib/group-trips";

/**
 * A passenger cancels their own request, until the trip leaves.
 *
 * Their seats leave the trip. A trip nobody is left on closes; a counter that
 * was waiting only on this passenger settles (books with those who agreed).
 * Someone else's request answers 404, and the attempt is audited.
 */
export const POST = withErrorHandler(async (req: NextRequest, ctx) => {
  const viewer = await requireViewer(req);
  const { id } = await ctx.params;
  const { platformFeePercent } = await loadPricingPolicy();

  const result = await auditRefusals(viewer, { action: "trip_request.cancel", entityType: "TripRequest", entityId: id }, async () => {
    const found = await prisma.tripRequest.findUnique({
      where: { id },
      select: { customerId: true, eventId: true, direction: true, pickupPointId: true },
    });
    if (!found) throw new NotFoundError("Trip request");
    if (found.customerId !== viewer.userId) throw new ConcealedRecordError("Trip request");

    return prisma.$transaction(async (tx) => {
      await lockPool(tx, found);
      const current = await tx.tripRequest.findUniqueOrThrow({
        where: { id },
        select: { status: true, groupTripId: true, groupTrip: { select: { status: true, departAt: true } } },
      });
      if (!(CANCELLABLE_REQUEST_STATUSES as readonly string[]).includes(current.status)) {
        throw new ConflictError("This request can no longer be cancelled");
      }
      if (current.groupTrip && current.groupTrip.departAt.getTime() <= Date.now()) {
        throw new ConflictError("This trip has already left");
      }

      const cancelled = await tx.tripRequest.updateMany({
        where: { id, status: current.status },
        data: { status: "CANCELLED", checkInCodeEnc: null },
      });
      if (cancelled.count !== 1) throw new ConflictError("This request changed while you were cancelling it");

      let trip: string | null = null;
      if (current.groupTripId) {
        if (current.groupTrip?.status === "COUNTERED") trip = await settleCounter(tx, current.groupTripId, platformFeePercent);
        if (current.groupTrip?.status === "OPEN" && (await closeIfEmpty(tx, current.groupTripId))) trip = "CLOSED";
      }

      await recordAuditStrict(tx, {
        actorUserId: viewer.userId,
        actorRole: viewer.role,
        action: "trip_request.cancel",
        entityType: "TripRequest",
        entityId: id,
        detail: { from: current.status, groupTripId: current.groupTripId, trip },
      });
      return tx.tripRequest.findUniqueOrThrow({ where: { id }, select: myRequestSelect });
    });
  });

  return ok(presentMyRequest(result));
});
