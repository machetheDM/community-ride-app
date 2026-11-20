import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertRole, auditRefusals, requireViewer } from "@/lib/actor";
import { parseBody, riderUpdateSchema } from "@/lib/validate";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { AuthorizationError, NotFoundError } from "@/lib/errors";
import { goOnlineRefusal } from "@/lib/policy";
import { riderSelfSelect } from "@/lib/views";

/**
 * A scooter rider's own profile and status (PLAN.md Phase 2.3). The rider
 * counterpart of `drivers/me`, with the same rules for the same reasons
 * (threat model RD-8): nothing existed for riders before, so a rider could not go
 * online at all.
 */

/** The signed-in rider's own profile. Never the ID number beyond its last four, never coordinates. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const viewer = await requireViewer(req, "RIDER");

  const rider = await prisma.rider.findUnique({ where: { userId: viewer.userId }, select: riderSelfSelect });
  if (!rider) throw new NotFoundError("Rider profile");

  return ok(rider);
});

/**
 * The rider goes online or offline, or reports where they are.
 *
 * - Going online needs an approved operator and an approved vehicle (403).
 * - A position is stored only while the rider is approved and online, and going
 *   offline clears it, so the table never holds where an off-duty rider lives.
 * - The stored position is what the dispatch list measures from and, between
 *   pickup and handover, what the customer's tracking screen shows.
 */
export const PATCH = withErrorHandler(async (req: NextRequest) => {
  const viewer = await requireViewer(req);
  const body = await parseBody(req, riderUpdateSchema);

  return auditRefusals(viewer, { action: "rider.update", entityType: "Rider", entityId: viewer.riderId ?? null }, async () => {
    assertRole(viewer, "RIDER");

    const current = await prisma.rider.findUnique({
      where: { userId: viewer.userId },
      select: { id: true, isApproved: true, isOnline: true, vehicle: { select: { isApproved: true } } },
    });
    if (!current) throw new NotFoundError("Rider profile");

    if (body.isOnline === true) {
      const refusal = goOnlineRefusal(current);
      if (refusal) throw new AuthorizationError(refusal);
    }

    const online = body.isOnline ?? current.isOnline;
    const mayReportPosition = online && goOnlineRefusal(current) === null;
    const position =
      body.currentLat !== undefined && body.currentLng !== undefined
        ? { lat: body.currentLat, lng: body.currentLng }
        : null;
    const stored = mayReportPosition ? position : null;

    const rider = await prisma.rider.update({
      where: { id: current.id },
      data: {
        ...(body.isOnline !== undefined ? { isOnline: body.isOnline } : {}),
        ...(!online
          ? { currentLat: null, currentLng: null }
          : stored
            ? { currentLat: stored.lat, currentLng: stored.lng }
            : {}),
      },
      select: riderSelfSelect,
    });

    return ok(rider);
  });
});
