import { NextRequest } from "next/server";
import { getETA } from "@ride/maps-service";
import { prisma } from "@/lib/prisma";
import { requireAuth, optionalAuth } from "@/lib/auth";
import { parseBody, rideCreateSchema } from "@/lib/validate";
import { ok, created } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { getPagination, paginatedResponse } from "@/lib/pagination";
import { geocodeCached, getMapsConfig, withMaps } from "@/lib/maps";
import { calculateFare, loadPricingPolicy } from "@/lib/fare";

export const GET = withErrorHandler(async (req: NextRequest) => {
  const authUser = optionalAuth(req);
  const { page, pageSize, skip } = getPagination(req);
  const { searchParams } = new URL(req.url);
  const active = searchParams.get("active") === "true";

  const where = {
    ...(authUser ? { customerId: authUser.userId } : {}),
    ...(active
      ? { status: { in: ["REQUESTED", "ACCEPTED", "DRIVER_ARRIVED", "IN_PROGRESS"] as never[] } }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.ride.findMany({
      where,
      include: {
        driver: {
          include: { user: { select: { name: true, phone: true, avatar: true } }, vehicle: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.ride.count({ where }),
  ]);

  return ok(paginatedResponse({ items, total, page, pageSize }));
});

/**
 * Resolves one endpoint of a trip to coordinates.
 *
 * Prefers what the app supplied — those came from an autocomplete selection and are
 * exact — and geocodes the typed address only when they are missing. That keeps a
 * ride bookable from an older app build while avoiding a billable geocode on the
 * common path.
 */
async function resolveEndpoint(
  address: string,
  lat: number | undefined,
  lng: number | undefined
): Promise<{ lat: number; lng: number; address: string }> {
  if (typeof lat === "number" && typeof lng === "number") {
    return { lat, lng, address };
  }
  const geocoded = await withMaps(() => geocodeCached(address));
  return { lat: geocoded.lat, lng: geocoded.lng, address: geocoded.formatted || address };
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  const authUser = requireAuth(req);
  const body = await parseBody(req, rideCreateSchema);

  // Both endpoints resolved before pricing — every ride now carries real
  // coordinates instead of the 0,0 default that used to land every trip in the
  // Gulf of Guinea.
  const [pickup, dropoff] = await Promise.all([
    resolveEndpoint(body.pickupAddress, body.pickupLat, body.pickupLng),
    resolveEndpoint(body.dropoffAddress, body.dropoffLat, body.dropoffLng),
  ]);

  const [eta, policy] = await Promise.all([
    withMaps(() =>
      getETA(
        getMapsConfig(),
        { lat: pickup.lat, lng: pickup.lng },
        { lat: dropoff.lat, lng: dropoff.lng }
      )
    ),
    loadPricingPolicy(),
  ]);

  // Priced here, not by the caller. The client no longer has a say.
  const fare = calculateFare(body.vehicleType, eta.distanceKm, eta.durationMinutes, policy);

  const ride = await prisma.ride.create({
    data: {
      customerId: authUser.userId,
      pickupLat: pickup.lat,
      pickupLng: pickup.lng,
      pickupAddress: pickup.address,
      dropoffLat: dropoff.lat,
      dropoffLng: dropoff.lng,
      dropoffAddress: dropoff.address,
      fareEstimate: fare.total,
      distanceKm: eta.distanceKm,
      durationMinutes: eta.durationMinutes,
      vehicleType: fare.vehicleType,
      paymentMethod: body.paymentMethod,
      ...(body.scheduledAt ? { scheduledAt: new Date(body.scheduledAt) } : {}),
    },
  });

  return created({ ...ride, fareBreakdown: fare });
});
