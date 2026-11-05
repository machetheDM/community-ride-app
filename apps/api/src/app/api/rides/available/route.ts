import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertRole, auditRefusals, requireViewer } from "@/lib/actor";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { AuthorizationError } from "@/lib/errors";
import { workRefusal } from "@/lib/policy";
import { availableRideSelect, presentAvailableRide } from "@/lib/views";

/**
 * Rides waiting for a driver, for a driver who may take one.
 *
 * Used to answer any signed-in user, customers included, with every waiting
 * customer's name, phone number and both addresses (threat model RD-7). Now only
 * an approved, online driver with an approved vehicle sees the list, and what
 * they see is the area, the distances, the fare and the vehicle type. The
 * customer's name, phone and exact pickup arrive in the ride once they accept.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const viewer = await requireViewer(req);

  return auditRefusals(
    viewer,
    { action: "ride.available.list", entityType: "Driver", entityId: viewer.driverId ?? null },
    async () => {
      assertRole(viewer, "DRIVER");
      const driver = viewer.driverId
        ? await prisma.driver.findUnique({
            where: { id: viewer.driverId },
            select: {
              isApproved: true,
              isOnline: true,
              currentLat: true,
              currentLng: true,
              vehicle: { select: { isApproved: true } },
            },
          })
        : null;
      if (!driver) throw new AuthorizationError("Not a registered driver");
      const refusal = workRefusal(driver);
      if (refusal) throw new AuthorizationError(refusal);

      const rides = await prisma.ride.findMany({
        where: { status: "REQUESTED", driverId: null, customerId: { not: viewer.userId } },
        select: availableRideSelect,
        orderBy: { createdAt: "asc" },
        take: 30,
      });

      const position = { lat: driver.currentLat, lng: driver.currentLng };
      return ok(rides.map((ride) => presentAvailableRide(ride, position)));
    }
  );
});
