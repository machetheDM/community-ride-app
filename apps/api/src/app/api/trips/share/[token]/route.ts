import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { NotFoundError } from "@/lib/errors";
import { firstName } from "@/lib/policy";
import { shareTokenHash } from "@/lib/group-trips";

/** A share link works until this long after the trip finishes. */
const SHARE_LINK_HOURS_AFTER = 12;

/**
 * Share-my-trip (PLAN.md 3.9): what a passenger sends to family before getting
 * into a stranger's vehicle. Public, by an unguessable token (160 bits, looked
 * up by its keyed hash, so the database never holds a usable link).
 *
 * It shows the trip, not the people on it: the event, the pickup point, when it
 * leaves, the operator's first name and the vehicle with its plate. No passenger
 * names, no phone numbers, no live position.
 */
export const GET = withErrorHandler(async (_req: NextRequest, ctx) => {
  const { token } = await ctx.params;
  if (!/^[0-9a-f]{40}$/.test(token)) throw new NotFoundError("Trip");

  const trip = await prisma.groupTrip.findUnique({
    where: { shareTokenHash: shareTokenHash(token) },
    select: {
      status: true,
      departAt: true,
      completedAt: true,
      direction: true,
      event: { select: { title: true, venue: { select: { name: true } } } },
      pickupPoint: { select: { name: true, address: true } },
      driver: {
        select: {
          user: { select: { name: true } },
          vehicle: { select: { make: true, model: true, color: true, licensePlate: true } },
        },
      },
    },
  });
  const expired =
    trip?.completedAt && Date.now() - trip.completedAt.getTime() > SHARE_LINK_HOURS_AFTER * 3_600_000;
  if (!trip || !trip.driver || !["BOOKED", "COMPLETED"].includes(trip.status) || expired) throw new NotFoundError("Trip");

  return ok({
    status: trip.status,
    direction: trip.direction,
    departAt: trip.departAt,
    event: trip.event.title,
    venue: trip.event.venue.name,
    pickupPoint: trip.pickupPoint,
    operator: { firstName: firstName(trip.driver.user.name), vehicle: trip.driver.vehicle },
  });
});
