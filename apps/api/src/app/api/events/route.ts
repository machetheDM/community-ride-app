import { prisma } from "@/lib/prisma";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { presentPublicEvent, publicEventSelect } from "@/lib/events";

/**
 * Upcoming published events, soonest first. Public: the customer app shows them
 * before sign-in, as the event page does.
 */
export const GET = withErrorHandler(async () => {
  const events = await prisma.event.findMany({
    where: { status: "PUBLISHED", startsAt: { gt: new Date() } },
    select: publicEventSelect,
    orderBy: { startsAt: "asc" },
    take: 50,
  });
  return ok(events.map(presentPublicEvent));
});
