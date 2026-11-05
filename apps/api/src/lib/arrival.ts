import { getETA } from "@ride/maps-service";
import { prisma } from "@/lib/prisma";
import { getMapsConfig, isMapsConfigured } from "@/lib/maps";
import { sendPushToUser } from "@/lib/notifications";
import { logger } from "@/lib/logger";
import { haversineKm } from "@/lib/geo";

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

// Moved to `geo.ts` so code without a database client can use it; re-exported
// here because callers and tests already import it from this module.
export { haversineKm };

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

    // Only a ride already accepted and not yet picked up can be "arriving", and
    // only for an approved driver who is online. The route already ignores an
    // unapproved driver's position; this repeats the rule here because this is the
    // function that spends money (the Routes call below) and sends a push, so it
    // must not depend on every caller remembering (threat model RD-8).
    const ride = await prisma.ride.findFirst({
      where: { driverId, status: "ACCEPTED", driver: { isApproved: true, isOnline: true } },
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
