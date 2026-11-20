import { NextRequest } from "next/server";
import { recordAuditStrict } from "@ride/db";
import { counterRefusal, seatPrice } from "@ride/db/trips";
import { prisma } from "@/lib/prisma";
import { auditRefusals, requireViewer } from "@/lib/actor";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { counterSchema, parseBody } from "@/lib/validate";
import { haversineKm } from "@/lib/geo";
import { logger } from "@/lib/logger";
import { sendPushToUser } from "@/lib/notifications";
import {
  counterExpiry,
  lapseCounterIfExpired,
  lockOperator,
  lockPool,
  membersOf,
  operatorOf,
  operatorStanding,
  presentOperatorTrip,
  tripOfferSelect,
} from "@/lib/group-trips";

/**
 * An operator counters a group trip once, with one price per seat for everyone
 * (PLAN.md 3.6).
 *
 * The trip is held for the operator while passengers answer, for 30 minutes.
 * Passengers who already offered at least the counter are counted as agreeing;
 * the rest are asked. An operator may hold one counter at a time: without that
 * limit, one operator could counter every trip and freeze the board.
 */
export const POST = withErrorHandler(async (req: NextRequest, ctx) => {
  const viewer = await requireViewer(req);
  const { id } = await ctx.params;
  const { pricePerSeat } = await parseBody(req, counterSchema);

  const result = await auditRefusals(
    viewer,
    { action: "group_trip.counter", entityType: "GroupTrip", entityId: id, detail: { pricePerSeat } },
    async () => {
      const driver = operatorOf(viewer);
      const found = await prisma.groupTrip.findUnique({
        where: { id },
        select: {
          eventId: true,
          direction: true,
          pickupPointId: true,
          pickupPoint: { select: { lat: true, lng: true } },
          event: { select: { venue: { select: { lat: true, lng: true } } } },
        },
      });
      if (!found) throw new NotFoundError("Group trip");

      return prisma.$transaction(async (tx) => {
        await lockPool(tx, found);
        await lockOperator(tx, driver.id);

        const standing = await operatorStanding(tx, driver);
        if (standing.refusal) throw new AuthorizationError(standing.refusal);

        const now = new Date();
        const holding = await tx.groupTrip.count({
          where: { counterDriverId: driver.id, status: "COUNTERED", counterExpiresAt: { gt: now } },
        });
        if (holding > 0) throw new ConflictError("You already have a counter-offer waiting for passengers");

        const current = await tx.groupTrip.findUniqueOrThrow({
          where: { id },
          select: { id: true, status: true, departAt: true, counterExpiresAt: true },
        });
        const status = (await lapseCounterIfExpired(tx, current, now)) ? "OPEN" : current.status;
        if (status !== "OPEN") throw new ConflictError("This trip is no longer open");
        if (current.departAt.getTime() <= now.getTime()) throw new ConflictError("This trip has already left");

        const members = await membersOf(tx, id);
        const seats = members.reduce((sum, m) => sum + m.seats, 0);
        if (seats === 0) throw new ConflictError("Nobody is on this trip any more");
        if (seats > standing.seats) {
          throw new AuthorizationError(`Your vehicle takes ${standing.seats} passengers; this trip has ${seats}`);
        }

        const refusal = counterRefusal(pricePerSeat, members, seatPrice(haversineKm(found.pickupPoint, found.event.venue)));
        if (refusal) throw new ValidationError(refusal, { pricePerSeat: [refusal] });

        const held = await tx.groupTrip.updateMany({
          where: { id, status: "OPEN" },
          data: {
            status: "COUNTERED",
            counterDriverId: driver.id,
            counterPricePerSeat: pricePerSeat.toFixed(2),
            counteredAt: now,
            counterExpiresAt: counterExpiry(now),
          },
        });
        if (held.count !== 1) throw new ConflictError("This trip is no longer open");

        const asked = members.filter((m) => m.pricePerSeat < pricePerSeat).map((m) => m.id);
        await tx.tripRequest.updateMany({ where: { id: { in: asked }, status: "WAITING" }, data: { status: "CONFIRMING" } });

        await recordAuditStrict(tx, {
          actorUserId: viewer.userId,
          actorRole: viewer.role,
          action: "group_trip.counter",
          entityType: "GroupTrip",
          entityId: id,
          detail: { pricePerSeat, seats, asked: asked.length, agreedAlready: members.length - asked.length },
        });

        const trip = await tx.groupTrip.findUniqueOrThrow({ where: { id }, select: tripOfferSelect });
        const list = await tx.tripRequest.findMany({
          where: { groupTripId: id, status: { in: ["WAITING", "CONFIRMING"] } },
          select: { id: true, seats: true, pricePerSeat: true, status: true, customer: { select: { name: true } } },
        });
        return { trip: presentOperatorTrip(trip, list.map((r) => ({ ...r, pricePerSeat: Number(r.pricePerSeat) }))), asked };
      });
    }
  );

  askPassengers(result.asked, pricePerSeat).catch(() => {
    /* logged inside */
  });
  return ok(result.trip);
});

async function askPassengers(requestIds: string[], pricePerSeat: number): Promise<void> {
  try {
    const asked = await prisma.tripRequest.findMany({
      where: { id: { in: requestIds } },
      select: { customer: { select: { pushToken: true } }, event: { select: { title: true } } },
    });
    for (const r of asked) {
      await sendPushToUser(
        r.customer.pushToken,
        "An operator made a counter-offer",
        `R${pricePerSeat} a seat to ${r.event.title}. Answer within 30 minutes in My trips.`,
        { screen: "my-trips" }
      );
    }
  } catch (error) {
    logger.warn("[group-trips] counter notification failed", { error: error instanceof Error ? error.message : String(error) });
  }
}
