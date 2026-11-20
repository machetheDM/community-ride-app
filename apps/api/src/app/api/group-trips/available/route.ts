import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireViewer } from "@/lib/actor";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { lapseExpiredCounters, membersOf, operatorOf, operatorStanding, presentOffer, tripOfferSelect } from "@/lib/group-trips";

/**
 * Open group trips an operator could take now, soonest first (PLAN.md 3.6, 3.7).
 *
 * An operator who may not take trips (not approved, documents unverified, fees
 * over the limit) sees no trips and the reason, never someone else's passengers.
 * Trips bigger than the operator's vehicle are left out. Expired counters lapse
 * first, so a trip held by a counter nobody answered is offered again.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const viewer = await requireViewer(req, "DRIVER");
  const driver = operatorOf(viewer);

  const standing = await operatorStanding(prisma, driver);
  const summary = { refusal: standing.refusal, seats: standing.seats, owed: standing.owed, missingDocuments: standing.missing };
  if (standing.refusal) return ok({ standing: summary, trips: [] });

  await lapseExpiredCounters();
  const trips = await prisma.groupTrip.findMany({
    where: { status: "OPEN", departAt: { gt: new Date() } },
    select: tripOfferSelect,
    orderBy: { departAt: "asc" },
    take: 100,
  });

  const offers = [];
  for (const trip of trips) {
    const members = await membersOf(prisma, trip.id);
    const seats = members.reduce((sum, m) => sum + m.seats, 0);
    if (seats > 0 && seats <= standing.seats) offers.push(presentOffer(trip, members));
  }
  return ok({ standing: summary, trips: offers });
});
