import type { Prisma } from "./generated/prisma/index";

/**
 * Who to tell about a new delivery job (docs/PLAN.md Phase 2.3; threat model DL-7).
 *
 * Shared by the API and the merchant portal, because a store confirms orders in
 * both, and a rider must hear about a job whichever one the store used. Takes the
 * client as a parameter and imports nothing at runtime from the database package,
 * so it can be loaded without a connection.
 */

/** How far from a store a rider is told about a job, and offered it in the app. */
export const DISPATCH_RADIUS_KM = 10;

/** At most this many riders are pushed per job: a broadcast must not grow with the roster. */
export const DISPATCH_PUSH_LIMIT = 20;

/** The job as a lock screen shows it: the store and the fee, never the customer. */
export function deliveryJobPush(job: { storeName: string; deliveryFee: Prisma.Decimal | string | number }): {
  title: string;
  body: string;
} {
  return {
    title: "New delivery near you 🛵",
    body: `${job.storeName} · R${Number(job.deliveryFee).toFixed(2)}`,
  };
}

/** Great-circle distance in km. */
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(toRad(b.lat - a.lat) / 2) ** 2 +
    Math.sin(toRad(b.lng - a.lng) / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface RiderFinder {
  rider: {
    findMany(args: {
      where: Prisma.RiderWhereInput;
      select: { currentLat: true; currentLng: true; user: { select: { pushToken: true } } };
    }): Promise<{ currentLat: number | null; currentLng: number | null; user: { pushToken: string | null } }[]>;
  };
}

/**
 * Push tokens of riders who could take a job at `store`, nearest first.
 *
 * Only riders who may work (approved, online, an approved vehicle), who have a
 * position and a push token, and who hold no active delivery, since one job at a
 * time is the rule and pushing a busy rider is noise. A bounding box narrows the
 * query in the database; the exact distance is checked here.
 */
export async function pushTokensOfRidersNear(
  db: RiderFinder,
  store: { lat: number; lng: number },
  options: { excludeUserId?: string } = {}
): Promise<string[]> {
  const dLat = DISPATCH_RADIUS_KM / 111;
  const dLng = DISPATCH_RADIUS_KM / (111 * Math.max(0.1, Math.cos((store.lat * Math.PI) / 180)));

  const riders = await db.rider.findMany({
    where: {
      isApproved: true,
      isOnline: true,
      vehicle: { isApproved: true },
      currentLat: { gte: store.lat - dLat, lte: store.lat + dLat },
      currentLng: { gte: store.lng - dLng, lte: store.lng + dLng },
      user: { pushToken: { not: null }, ...(options.excludeUserId ? { id: { not: options.excludeUserId } } : {}) },
      deliveries: { none: { status: { in: ["ASSIGNED", "PICKED_UP", "EN_ROUTE"] } } },
    },
    select: { currentLat: true, currentLng: true, user: { select: { pushToken: true } } },
  });

  return riders
    .filter((r): r is typeof r & { currentLat: number; currentLng: number } => r.currentLat !== null && r.currentLng !== null)
    .map((r) => ({ token: r.user.pushToken as string, km: haversineKm(store, { lat: r.currentLat, lng: r.currentLng }) }))
    .filter((r) => r.km <= DISPATCH_RADIUS_KM)
    .sort((a, b) => a.km - b.km)
    .slice(0, DISPATCH_PUSH_LIMIT)
    .map((r) => r.token);
}
