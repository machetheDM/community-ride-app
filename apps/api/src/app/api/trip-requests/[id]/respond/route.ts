import { NextRequest } from "next/server";
import { recordAuditStrict } from "@ride/db";
import { prisma } from "@/lib/prisma";
import { auditRefusals, requireViewer } from "@/lib/actor";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { ConcealedRecordError, ConflictError, NotFoundError } from "@/lib/errors";
import { counterResponseSchema, parseBody } from "@/lib/validate";
import { loadPricingPolicy } from "@/lib/fare";
import {
  lapseCounterIfExpired,
  lockPool,
  myRequestSelect,
  notifyPassengers,
  presentMyRequest,
  settleCounter,
} from "@/lib/group-trips";

/**
 * A passenger answers an operator's counter-offer (PLAN.md 3.6).
 *
 * Accepting moves their price per seat to the counter; declining takes them off
 * the trip, and they may ask again. When the last passenger answers, the trip
 * books with everyone who agreed, at the counter price. A counter past its
 * window has lapsed: the answer is refused and the trip is open again.
 */
export const POST = withErrorHandler(async (req: NextRequest, ctx) => {
  const viewer = await requireViewer(req);
  const { id } = await ctx.params;
  const { accept } = await parseBody(req, counterResponseSchema);
  const { platformFeePercent } = await loadPricingPolicy();

  const outcome = await auditRefusals(
    viewer,
    { action: "trip_request.respond", entityType: "TripRequest", entityId: id, detail: { accept } },
    async () => {
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
          select: {
            status: true,
            groupTripId: true,
            groupTrip: { select: { id: true, status: true, counterExpiresAt: true, counterPricePerSeat: true } },
          },
        });
        const trip = current.groupTrip;
        if (!trip || current.status !== "CONFIRMING" || trip.status !== "COUNTERED" || trip.counterPricePerSeat === null) {
          throw new ConflictError("There is no counter-offer waiting for your answer");
        }
        // A lapsed counter reopens the trip here, and the answer is refused once
        // that is committed (below), so the passenger sees why.
        if (await lapseCounterIfExpired(tx, trip)) return { lapsed: true as const };

        const answered = await tx.tripRequest.updateMany({
          where: { id, status: "CONFIRMING" },
          data: accept
            ? { status: "WAITING", pricePerSeat: Number(trip.counterPricePerSeat).toFixed(2) }
            : { status: "DECLINED" },
        });
        if (answered.count !== 1) throw new ConflictError("Your request changed while you were answering");

        const settled = await settleCounter(tx, trip.id, platformFeePercent);
        await recordAuditStrict(tx, {
          actorUserId: viewer.userId,
          actorRole: viewer.role,
          action: accept ? "trip_request.counter_accept" : "trip_request.counter_decline",
          entityType: "TripRequest",
          entityId: id,
          detail: { groupTripId: trip.id, counterPricePerSeat: Number(trip.counterPricePerSeat), trip: settled },
        });
        return {
          lapsed: false as const,
          tripId: trip.id,
          booked: settled === "BOOKED",
          request: await tx.tripRequest.findUniqueOrThrow({ where: { id }, select: myRequestSelect }),
        };
      });
    }
  );

  if (outcome.lapsed) throw new ConflictError("The counter-offer lapsed; your request is waiting for an operator at your own price");
  if (outcome.booked) {
    notifyPassengers(outcome.tripId).catch(() => {
      /* logged inside; a push never undoes a booking */
    });
  }
  return ok(presentMyRequest(outcome.request));
});
