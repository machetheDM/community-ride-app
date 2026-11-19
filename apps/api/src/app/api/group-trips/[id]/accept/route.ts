import { NextRequest } from "next/server";
import { recordAuditStrict } from "@ride/db";
import { prisma } from "@/lib/prisma";
import { auditRefusals, requireViewer } from "@/lib/actor";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { AuthorizationError, ConflictError, NotFoundError } from "@/lib/errors";
import { loadPricingPolicy } from "@/lib/fare";
import {
  bookTrip,
  lapseCounterIfExpired,
  lockOperator,
  lockPool,
  membersOf,
  notifyPassengers,
  operatorOf,
  operatorStanding,
  presentOperatorTrip,
  tripOfferSelect,
} from "@/lib/group-trips";

/** An operator may not hold two booked trips that leave within this many hours of each other. */
const OVERLAP_HOURS = 3;

/**
 * An operator takes a group trip at the passengers' prices (PLAN.md 3.6).
 *
 * The first valid acceptance wins: the trip is booked by a write conditional on
 * it still being OPEN, under the pool's lock, so two operators accepting at once
 * get one 200 and one 409. Before that, the operator's standing is read from the
 * database: approved, verified documents, an approved vehicle with enough seats,
 * fees owed under the limit, and no other booked trip leaving near the same time.
 * The fee rate is fixed on the trip now, so a later change does not reprice it.
 */
export const POST = withErrorHandler(async (req: NextRequest, ctx) => {
  const viewer = await requireViewer(req);
  const { id } = await ctx.params;
  const { platformFeePercent } = await loadPricingPolicy();

  const trip = await auditRefusals(viewer, { action: "group_trip.accept", entityType: "GroupTrip", entityId: id }, async () => {
    const driver = operatorOf(viewer);
    const found = await prisma.groupTrip.findUnique({
      where: { id },
      select: { eventId: true, direction: true, pickupPointId: true },
    });
    if (!found) throw new NotFoundError("Group trip");

    return prisma.$transaction(async (tx) => {
      await lockPool(tx, found);
      await lockOperator(tx, driver.id);

      const standing = await operatorStanding(tx, driver);
      if (standing.refusal) throw new AuthorizationError(standing.refusal);

      const current = await tx.groupTrip.findUniqueOrThrow({
        where: { id },
        select: { id: true, status: true, departAt: true, counterExpiresAt: true },
      });
      const status = (await lapseCounterIfExpired(tx, current)) ? "OPEN" : current.status;
      if (status !== "OPEN") throw new ConflictError("Another operator has this trip");
      if (current.departAt.getTime() <= Date.now()) throw new ConflictError("This trip has already left");

      const members = await membersOf(tx, id);
      const seats = members.reduce((sum, m) => sum + m.seats, 0);
      if (seats === 0) throw new ConflictError("Nobody is on this trip any more");
      if (seats > standing.seats) {
        throw new AuthorizationError(`Your vehicle takes ${standing.seats} passengers; this trip has ${seats}`);
      }

      const window = OVERLAP_HOURS * 3_600_000;
      const clash = await tx.groupTrip.count({
        where: {
          driverId: driver.id,
          status: "BOOKED",
          departAt: { gte: new Date(current.departAt.getTime() - window), lte: new Date(current.departAt.getTime() + window) },
        },
      });
      if (clash > 0) throw new ConflictError(`You already have a trip leaving within ${OVERLAP_HOURS} hours of this one`);

      if (!(await bookTrip(tx, { id, status: "OPEN" }, driver.id, platformFeePercent, null))) {
        throw new ConflictError("Another operator has this trip");
      }

      await recordAuditStrict(tx, {
        actorUserId: viewer.userId,
        actorRole: viewer.role,
        action: "group_trip.accept",
        entityType: "GroupTrip",
        entityId: id,
        detail: { from: "OPEN", to: "BOOKED", seats, passengers: members.length, platformFeePercent },
      });

      const booked = await tx.groupTrip.findUniqueOrThrow({ where: { id }, select: tripOfferSelect });
      const riders = await tx.tripRequest.findMany({
        where: { groupTripId: id, status: "BOOKED" },
        select: { id: true, seats: true, pricePerSeat: true, status: true, customer: { select: { name: true } } },
      });
      return presentOperatorTrip(
        booked,
        riders.map((r) => ({ ...r, pricePerSeat: Number(r.pricePerSeat) }))
      );
    });
  });

  notifyPassengers(id).catch(() => {
    /* logged inside; a push never undoes a booking */
  });
  return ok(trip);
});
