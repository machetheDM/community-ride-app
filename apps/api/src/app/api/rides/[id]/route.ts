import { NextRequest } from "next/server";
import { recordAuditStrict } from "@ride/db";
import { ACTIVE_TRIP_STATUSES, checkRideTransition, type RideStatus } from "@ride/db/lifecycle";
import { prisma } from "@/lib/prisma";
import { auditRefusals, requireViewer } from "@/lib/actor";
import { parseBody, rideTransitionSchema } from "@/lib/validate";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import {
  AuthorizationError,
  ConcealedRecordError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { acceptRefusal, rideRelation, type RideRelation, type Viewer } from "@/lib/policy";
import { presentRide, rideSelect, type RideRecord } from "@/lib/views";
import { sendPushToUser } from "@/lib/notifications";
import { emitTripEvent } from "@/lib/analytics";
import { logger } from "@/lib/logger";

const RIDE_STATUS_MESSAGES: Record<string, { title: string; body: string }> = {
  ACCEPTED:       { title: "Driver found! 🚗", body: "A driver accepted your ride and is on the way." },
  DRIVER_ARRIVED: { title: "Your driver has arrived 📍", body: "Your driver is waiting at the pickup point." },
  IN_PROGRESS:    { title: "Trip started 🛣️", body: "Enjoy your ride!" },
  COMPLETED:      { title: "Trip completed ✅", body: "Thanks for riding with Community Ride!" },
  CANCELLED:      { title: "Ride cancelled", body: "Your ride has been cancelled." },
};

/** Audit verb for each target status, used before the move is known to be valid. */
const VERB: Record<RideStatus, string> = {
  REQUESTED: "ride.status",
  ACCEPTED: "ride.accept",
  DRIVER_ARRIVED: "ride.arrive",
  IN_PROGRESS: "ride.start",
  COMPLETED: "ride.complete",
  CANCELLED: "ride.cancel",
};

/**
 * One ride, for its customer, its assigned driver or an admin.
 *
 * Used to answer anyone, with no token at all: the customer's phone, the
 * driver's full record and the last location (PLAN.md section 2, hole 2). Anyone
 * else now gets the same 404 as for an id that does not exist.
 */
export const GET = withErrorHandler(async (req: NextRequest, ctx) => {
  const viewer = await requireViewer(req);
  const { id } = await ctx.params;

  return auditRefusals(viewer, { action: "ride.read", entityType: "Ride", entityId: id }, async () => {
    const ride = await prisma.ride.findUnique({ where: { id }, select: rideSelect });
    if (!ride) throw new NotFoundError("Ride");
    const relation = rideRelation(viewer, ride);
    if (!relation) throw new ConcealedRecordError("Ride");
    return ok(presentRide(ride, relation));
  });
});

/**
 * Moves a ride one step through its lifecycle (`@ride/db/lifecycle`).
 *
 * This used to write whatever the body said: any signed-in user could set any
 * ride to any status and choose the final fare, and two drivers accepting the
 * same ride both "won", the second silently overwriting the first (PLAN.md hole
 * 4; threat model RD-3, RD-4, RD-5). Now:
 *
 * - the caller must be the ride's customer, its assigned driver, or an admin
 *   (or, to accept, an approved and online driver with an approved vehicle and
 *   no other active ride); anyone else gets 404;
 * - the move must be in the lifecycle table for that caller, or 409 / 403;
 * - the change is one conditional write on the status that was read (and, to
 *   accept, on there being no driver yet). If anything changed in between, the
 *   write matches no row and the answer is 409. That single statement is what
 *   makes two accepts of one ride produce one winner;
 * - the audit row commits in the same transaction as the change.
 */
export const PATCH = withErrorHandler(async (req: NextRequest, ctx) => {
  const viewer = await requireViewer(req);
  const { id } = await ctx.params;
  const body = await parseBody(req, rideTransitionSchema);

  const { ride, relation, previous } = await auditRefusals(
    viewer,
    { action: VERB[body.status], entityType: "Ride", entityId: id, detail: { to: body.status } },
    () => transition(viewer, id, body.status, body.cancelReason)
  );

  await afterTransition(ride, relation, previous);
  return ok(presentRide(ride, relation));
});

async function transition(
  viewer: Viewer,
  id: string,
  to: RideStatus,
  cancelReason: string | undefined
): Promise<{ ride: RideRecord; relation: RideRelation; previous: { status: RideStatus; driverId: string | null } }> {
  const current = await prisma.ride.findUnique({
    where: { id },
    select: { id: true, status: true, customerId: true, driverId: true, fareEstimate: true },
  });
  if (!current) throw new NotFoundError("Ride");

  const accepting = to === "ACCEPTED";
  let relation = rideRelation(viewer, current);

  // A driver accepting a waiting ride is not yet its driver. They are treated as
  // the prospective driver whether or not someone beat them to it, so that the
  // loser of a race hears 409 "taken" rather than a 404 that would make the app
  // think the ride vanished. This tells an eligible, approved driver that a ride
  // id exists, which the available list told them already.
  if (!relation && accepting && viewer.driverId) relation = "DRIVER";
  if (!relation) throw new ConcealedRecordError("Ride");

  const actor = relation;
  // Every DRIVER path above went through `viewer.driverId`; named here so the
  // conditional write below can never be built with an undefined filter, which
  // Prisma would silently drop.
  const driverId = viewer.driverId ?? null;
  if (actor === "DRIVER" && !driverId) throw new ConcealedRecordError("Ride");
  const now = new Date();

  const ride = await prisma.$transaction(async (tx) => {
    if (accepting && actor === "DRIVER" && driverId) {
      // Lock this driver's row so the same driver accepting two rides at once
      // is serialised: the second transaction waits here, then counts the first
      // one's ride as active and is refused. Without the lock both counts read
      // zero and the driver ends up holding two customers.
      await tx.$queryRaw`SELECT id FROM "ride"."Driver" WHERE id = ${driverId} FOR UPDATE`;
      const driver = await tx.driver.findUnique({
        where: { id: driverId },
        select: { isApproved: true, isOnline: true, vehicle: { select: { isApproved: true } } },
      });
      const otherActiveRides = await tx.ride.count({
        where: { driverId, status: { in: [...ACTIVE_TRIP_STATUSES] }, id: { not: id } },
      });
      const refusal = driver
        ? acceptRefusal(driver, otherActiveRides, viewer, current)
        : "Not a registered driver";
      if (refusal) throw new AuthorizationError(refusal);
    }

    const check = checkRideTransition(current.status, to, actor, { hasReason: Boolean(cancelReason) });
    if (!check.allowed) {
      if (check.refusal === "NO_SUCH_MOVE") {
        throw new ConflictError(
          accepting ? "This ride is no longer available" : `A ${current.status} ride cannot be moved to ${to}`
        );
      }
      if (check.refusal === "REASON_REQUIRED") {
        throw new ValidationError("A reason is required", { cancelReason: ["Say why you are cancelling"] });
      }
      throw new AuthorizationError("You cannot make this change to this ride");
    }

    const data = {
      status: to,
      ...(to === "ACCEPTED" ? { driverId, acceptedAt: now } : {}),
      ...(to === "DRIVER_ARRIVED" ? { arrivedAt: now } : {}),
      ...(to === "IN_PROGRESS" ? { startedAt: now } : {}),
      // The fare is the server's. A server recomputation from the driven route
      // is a later change; until then the booked estimate is what is charged.
      ...(to === "COMPLETED" ? { completedAt: now, fareActual: current.fareEstimate } : {}),
      ...(to === "CANCELLED" ? { cancelledAt: now, cancelledBy: actor, cancelReason: cancelReason ?? null } : {}),
    };

    const written = await tx.ride.updateMany({
      where: {
        id,
        status: current.status,
        ...(accepting
          ? { driverId: null }
          : actor === "DRIVER"
            ? { driverId }
            : actor === "CUSTOMER"
              ? { customerId: viewer.userId }
              : {}),
      },
      data,
    });
    if (written.count !== 1) {
      throw new ConflictError(
        accepting ? "This ride is no longer available" : "This ride changed while you were updating it; reload it"
      );
    }

    if (to === "COMPLETED" && driverId) {
      await tx.driver.update({ where: { id: driverId }, data: { totalRides: { increment: 1 } } });
    }

    await recordAuditStrict(tx, {
      actorUserId: viewer.userId,
      actorRole: viewer.role,
      action: check.action,
      entityType: "Ride",
      entityId: id,
      detail: {
        from: current.status,
        to,
        as: actor,
        ...(cancelReason ? { reason: cancelReason } : {}),
      },
    });

    return tx.ride.findUniqueOrThrow({ where: { id }, select: rideSelect });
  });

  return { ride, relation: actor, previous: { status: current.status, driverId: current.driverId } };
}

/**
 * Notifications and analytics, after the change has committed.
 *
 * Neither may fail the request: the ride has already moved, and a 500 now would
 * tell the driver their tap did nothing when it did.
 */
async function afterTransition(
  ride: RideRecord,
  actor: RideRelation,
  previous: { status: RideStatus; driverId: string | null }
): Promise<void> {
  try {
    if (ride.status === "COMPLETED" || ride.status === "CANCELLED") emitTripEvent(ride);

    const msg = RIDE_STATUS_MESSAGES[ride.status];
    if (msg && actor !== "CUSTOMER") {
      const customer = await prisma.user.findUnique({ where: { id: ride.customerId }, select: { pushToken: true } });
      await sendPushToUser(customer?.pushToken, msg.title, msg.body, { rideId: ride.id, screen: "ride" });
    }

    // A driver on the way to a pickup the customer has just cancelled needs to
    // know; before this they found out at the kerb.
    const driverId = previous.driverId;
    if (ride.status === "CANCELLED" && actor !== "DRIVER" && driverId && previous.status !== "REQUESTED") {
      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
        select: { user: { select: { pushToken: true } } },
      });
      await sendPushToUser(driver?.user.pushToken, "Ride cancelled", "The trip you accepted has been cancelled.", {
        rideId: ride.id,
        screen: "ride",
      });
    }
  } catch (error) {
    logger.warn("[rides] post-transition notification failed", {
      rideId: ride.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
