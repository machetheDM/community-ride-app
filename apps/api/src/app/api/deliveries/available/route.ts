import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertRole, auditRefusals, requireViewer } from "@/lib/actor";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { AuthorizationError, ConflictError, NotFoundError } from "@/lib/errors";
import { riderWorkRefusal } from "@/lib/policy";
import { availableDeliverySelect, presentAvailableDelivery } from "@/lib/views";
import { DISPATCHABLE_ORDER_STATUSES, DISPATCH_RADIUS_KM } from "@/lib/delivery";
import { haversineKm } from "@/lib/geo";

/** How many waiting deliveries are read before the distance filter, and how many are shown. */
const CANDIDATES = 100;
const SHOWN = 20;

/**
 * Deliveries waiting for a rider, nearest store first (PLAN.md Phase 2.3).
 *
 * Only for a rider who may work: an approved operator with an approved vehicle,
 * online, with a position to measure from. Each entry says where to collect and,
 * roughly, where to drop off; nothing about who ordered. The customer's name,
 * phone and address come with the job, after `POST /api/deliveries/{id}/accept`.
 *
 * Polled by the operator app. A push to nearby riders when an order is placed is
 * a later step; until then a job waits here, not on a lock screen.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const viewer = await requireViewer(req);

  return auditRefusals(viewer, { action: "delivery.list_available", entityType: "Delivery", entityId: null }, async () => {
    assertRole(viewer, "RIDER");

    const rider = await prisma.rider.findUnique({
      where: { userId: viewer.userId },
      select: {
        isApproved: true,
        isOnline: true,
        currentLat: true,
        currentLng: true,
        vehicle: { select: { isApproved: true } },
      },
    });
    if (!rider) throw new NotFoundError("Rider profile");

    const refusal = riderWorkRefusal(rider);
    if (refusal) throw new AuthorizationError(refusal);
    if (rider.currentLat === null || rider.currentLng === null) {
      throw new ConflictError("Share your location to see deliveries near you");
    }
    const here = { lat: rider.currentLat, lng: rider.currentLng };

    const waiting = await prisma.delivery.findMany({
      where: {
        status: "PENDING",
        riderId: null,
        order: { status: { in: [...DISPATCHABLE_ORDER_STATUSES] } },
      },
      select: availableDeliverySelect,
      orderBy: { createdAt: "asc" },
      take: CANDIDATES,
    });

    const nearby = waiting
      .filter((d) => d.order.customerId !== viewer.userId)
      .map((d) => ({ d, km: haversineKm(here, { lat: d.order.store.lat, lng: d.order.store.lng }) }))
      .filter(({ km }) => km <= DISPATCH_RADIUS_KM)
      .sort((a, b) => a.km - b.km)
      .slice(0, SHOWN);

    return ok(nearby.map(({ d, km }) => presentAvailableDelivery(d, km)));
  });
});
