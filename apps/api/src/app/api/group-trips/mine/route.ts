import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireViewer } from "@/lib/actor";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { MEMBER_STATUSES, operatorOf, presentOperatorTrip, tripOfferSelect } from "@/lib/group-trips";

/**
 * The operator's own group trips: the counter they are holding, trips booked to
 * them, and the last month's finished ones. Passengers appear by first name and
 * seats; their phone numbers and boarding codes do not (the code is checked on
 * the server at check-in).
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const viewer = await requireViewer(req, "DRIVER");
  const driver = operatorOf(viewer);
  const since = new Date(Date.now() - 30 * 86_400_000);

  const trips = await prisma.groupTrip.findMany({
    where: {
      OR: [
        { driverId: driver.id, status: "BOOKED" },
        { driverId: driver.id, status: "COMPLETED", completedAt: { gte: since } },
        { counterDriverId: driver.id, status: "COUNTERED" },
      ],
    },
    select: tripOfferSelect,
    orderBy: { departAt: "asc" },
    take: 50,
  });

  const shown = [];
  for (const trip of trips) {
    const members = await prisma.tripRequest.findMany({
      where: {
        groupTripId: trip.id,
        status: { in: trip.status === "COMPLETED" ? ["COMPLETED", "NO_SHOW"] : [...MEMBER_STATUSES] },
      },
      select: { id: true, seats: true, pricePerSeat: true, status: true, customer: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    });
    shown.push(presentOperatorTrip(trip, members.map((m) => ({ ...m, pricePerSeat: Number(m.pricePerSeat) }))));
  }
  return ok(shown);
});
