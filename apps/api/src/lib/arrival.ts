import { getETA } from "@ride/maps-service";
import { prisma } from "@/lib/prisma";
import { getMapsConfig, isMapsConfigured } from "@/lib/maps";
import { sendPushToUser } from "@/lib/notifications";
import { logger } from "@/lib/logger";

/**
 * "Your driver is arriving" — the one notification that needs a live ETA.
 *
 * Fired from the driver's location updates rather than on a timer, because the
 * driver app is already reporting position and that is the only moment the answer
 * can change.
 *
 * Two things keep this from becoming an expensive mistake:
 *
 * 1. **Cheap pre-filter before the billable call.** A straight-line distance check
 *    runs first; only a driver already physically close enough to plausibly be
 *    within the ETA threshold triggers a Route Matrix lookup. Without it, every
 *    location ping from every driver on an active ride would be a billed call —
 *    with a ping every few seconds that is thousands per ride.
 *
 * 2. **Once per ride.** `arrivalNotifiedRides` records rides already alerted, so a
 *    driver hovering around the threshold cannot notify the customer repeatedly.
 */

/** Notify when the driver is within this many minutes of pickup. */
const ARRIVAL_ETA_MINUTES = 3;

/**
 * Skip the billable ETA lookup beyond this straight-line distance.
 *
 * 3 km covers 3 minutes of driving comfortably even on a clear arterial road, so
 * the filter cannot hide a genuine arrival — it only avoids asking about drivers
 * who are obviously still far away.
 */
const PREFILTER_RADIUS_KM = 3;

/**
 * Rides already alerted.
 *
 * Process-local, like the rate limiter and the geocode cache. Across multiple
 * instances a customer could receive one duplicate per instance; that is a far
 * better failure mode than the database write this would otherwise need on every
 * location ping, and the set is bounded and swept.
 */
const arrivalNotifiedRides = new Map<string, number>();
const NOTIFIED_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_NOTIFIED = 5_000;

function sweep(now: number): void {
  for (const [rideId, at] of arrivalNotifiedRides) {
    if (now - at > NOTIFIED_TTL_MS) arrivalNotifiedRides.delete(rideId);
  }
}

/** Great-circle distance in km. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Called after a driver reports a new position.
 *
 * Never throws and never blocks the caller's response — the driver's location
 * update must succeed whether or not the customer gets a notification.
 */
export async function maybeNotifyArrival(
  driverId: string,
  position: { lat: number; lng: number }
): Promise<void> {
  try {
    if (!isMapsConfigured()) return;

    // Only a ride already accepted and not yet picked up can be "arriving".
    const ride = await prisma.ride.findFirst({
      where: { driverId, status: "ACCEPTED" },
      select: {
        id: true,
        pickupLat: true,
        pickupLng: true,
        customer: { select: { pushToken: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!ride?.customer.pushToken) return;
    if (!ride.pickupLat || !ride.pickupLng) return;
    if (arrivalNotifiedRides.has(ride.id)) return;

    const pickup = { lat: ride.pickupLat, lng: ride.pickupLng };

    // Free check first — this is what keeps the billable call rare.
    if (haversineKm(position, pickup) > PREFILTER_RADIUS_KM) return;

    const eta = await getETA(getMapsConfig(), position, pickup);
    if (eta.durationMinutes > ARRIVAL_ETA_MINUTES) return;

    // Marked before sending: a send that fails should not re-arm the alert and
    // spam the customer on the next ping.
    const now = Date.now();
    if (arrivalNotifiedRides.size >= MAX_NOTIFIED) sweep(now);
    arrivalNotifiedRides.set(ride.id, now);

    await sendPushToUser(
      ride.customer.pushToken,
      "Your driver is arriving 📍",
      `About ${eta.durationMinutes} minute${eta.durationMinutes === 1 ? "" : "s"} away. Please head to the pickup point.`,
      { rideId: ride.id, screen: "ride" }
    );
  } catch (error) {
    logger.warn("[arrival] arrival check failed", {
      driverId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Test-only hook, mirroring the other process-local stores. */
export function __resetArrivalNotifications(): void {
  arrivalNotifiedRides.clear();
}
