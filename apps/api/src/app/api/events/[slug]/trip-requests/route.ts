import { NextRequest } from "next/server";
import { recordAuditStrict } from "@ride/db";
import { departureFor, priceRefusal, seatPrice, visitChannel } from "@ride/db/trips";
import { prisma } from "@/lib/prisma";
import { assertRole, auditRefusals, requireViewer } from "@/lib/actor";
import { created } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseBody, tripRequestCreateSchema } from "@/lib/validate";
import { haversineKm } from "@/lib/geo";
import { PICKUP_RADIUS_KM } from "@/lib/events";
import {
  REOPENABLE_REQUEST_STATUSES,
  lockPool,
  myRequestSelect,
  presentMyRequest,
  tripForRequest,
} from "@/lib/group-trips";

/** Requests close this long before the trip leaves, so an operator has time to take it. */
const REQUESTS_CLOSE_MINUTES = 30;

/**
 * A passenger asks for seats on a group trip to (or from) an event (PLAN.md 3.4,
 * 3.5).
 *
 * - The price per seat is the passenger's offer; the server prices the floor
 *   from the pickup point and the venue and refuses anything under it (PL-1).
 *   No total, fee or trip id is accepted from the client.
 * - One request per passenger per event and direction: more seats means a new
 *   request after cancelling, not stacking requests to crowd a trip.
 * - The request joins the oldest open trip from the same pickup point with room,
 *   or starts one, under the pool's lock (`lib/group-trips.ts`).
 */
export const POST = withErrorHandler(async (req: NextRequest, ctx) => {
  const viewer = await requireViewer(req);
  const { slug } = await ctx.params;
  const body = await parseBody(req, tripRequestCreateSchema);

  const request = await auditRefusals(
    viewer,
    { action: "trip_request.create", entityType: "Event", entityId: slug },
    async () => {
      assertRole(viewer, "CUSTOMER");

      const event = await prisma.event.findUnique({
        where: { slug },
        select: { id: true, status: true, startsAt: true, endsAt: true, venue: { select: { lat: true, lng: true } } },
      });
      if (!event || event.status !== "PUBLISHED") throw new NotFoundError("Event");

      const departAt = departureFor(event, body.direction);
      if (departAt.getTime() <= Date.now() + REQUESTS_CLOSE_MINUTES * 60_000) {
        throw new ConflictError("Requests for this trip have closed");
      }

      const point = await prisma.pickupPoint.findUnique({
        where: { id: body.pickupPointId },
        select: { id: true, isActive: true, lat: true, lng: true },
      });
      const km = point ? haversineKm(point, event.venue) : Infinity;
      if (!point || !point.isActive || km > PICKUP_RADIUS_KM) {
        throw new ValidationError("Choose one of this event's pickup points", {
          pickupPointId: ["Not a pickup point for this event"],
        });
      }

      const refusal = priceRefusal(body.pricePerSeat, seatPrice(km));
      if (refusal) throw new ValidationError(refusal, { pricePerSeat: [refusal] });

      return prisma.$transaction(async (tx) => {
        const pool = { eventId: event.id, direction: body.direction, pickupPointId: point.id };
        await lockPool(tx, pool);

        const existing = await tx.tripRequest.findUnique({
          where: { eventId_customerId_direction: { eventId: event.id, customerId: viewer.userId, direction: body.direction } },
          select: { id: true, status: true },
        });
        if (existing && !(REOPENABLE_REQUEST_STATUSES as readonly string[]).includes(existing.status)) {
          throw new ConflictError("You already have a request for this trip. Cancel it to change it.");
        }

        const groupTripId = await tripForRequest(tx, { ...pool, departAt }, body.seats);
        const fields = {
          pickupPointId: point.id,
          seats: body.seats,
          pricePerSeat: body.pricePerSeat.toFixed(2),
          status: "WAITING" as const,
          groupTripId,
          channel: visitChannel(body.channel),
          checkInCodeEnc: null,
        };

        let id: string;
        if (existing) {
          const reopened = await tx.tripRequest.updateMany({ where: { id: existing.id, status: existing.status }, data: fields });
          if (reopened.count !== 1) throw new ConflictError("Your request changed while this was sent; try again");
          id = existing.id;
        } else {
          const made = await tx.tripRequest.create({
            data: { ...fields, eventId: event.id, customerId: viewer.userId, direction: body.direction },
            select: { id: true },
          });
          id = made.id;
        }

        await recordAuditStrict(tx, {
          actorUserId: viewer.userId,
          actorRole: viewer.role,
          action: "trip_request.create",
          entityType: "TripRequest",
          entityId: id,
          detail: { eventId: event.id, groupTripId, seats: body.seats, pricePerSeat: body.pricePerSeat, reopened: Boolean(existing) },
        });

        return tx.tripRequest.findUniqueOrThrow({ where: { id }, select: myRequestSelect });
      });
    }
  );

  return created(presentMyRequest(request));
});
