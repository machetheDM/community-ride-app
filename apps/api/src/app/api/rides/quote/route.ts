import { NextRequest } from "next/server";
import { getETA } from "@ride/maps-service";
import { requireAuth } from "@/lib/auth";
import { parseBody, fareQuoteSchema } from "@/lib/validate";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { getMapsConfig, withMaps } from "@/lib/maps";
import { mapsLimiter } from "@/lib/rate-limit";
import { calculateFare, loadPricingPolicy, VEHICLE_RATES } from "@/lib/fare";

/**
 * Fare and ETA preview for the booking screen.
 *
 * The customer app used to compute this itself from a hardcoded 5 km, so the
 * quoted price bore no relation to the trip. Now one routed distance is priced
 * across every vehicle type in a single upstream call, so switching between Sedan
 * and Minivan on the booking screen costs nothing extra — the ETA is the same road,
 * only the rate card differs.
 *
 * This is a preview, not a commitment: `POST /api/rides` re-derives the fare
 * server-side when the ride is actually created.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  requireAuth(req);
  mapsLimiter(req);

  const { origin, destination } = await parseBody(req, fareQuoteSchema);

  const [eta, policy] = await Promise.all([
    withMaps(() => getETA(getMapsConfig(), origin, destination)),
    loadPricingPolicy(),
  ]);

  const quotes = Object.keys(VEHICLE_RATES).map((vehicleType) =>
    calculateFare(vehicleType, eta.distanceKm, eta.durationMinutes, policy)
  );

  return ok({
    distanceKm: eta.distanceKm,
    durationMinutes: eta.durationMinutes,
    quotes,
  });
});
