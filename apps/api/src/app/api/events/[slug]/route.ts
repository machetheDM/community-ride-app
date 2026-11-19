import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { NotFoundError } from "@/lib/errors";
import { pickupOptions, presentPublicEvent, publicEventSelect } from "@/lib/events";

/**
 * One published event and the pickup points a group trip to it can leave from,
 * each with the floor and suggested price per seat. Public. A draft or a
 * cancelled event is a 404, so a draft's existence is not confirmed.
 */
export const GET = withErrorHandler(async (_req: NextRequest, ctx) => {
  const { slug } = await ctx.params;
  const event = await prisma.event.findUnique({ where: { slug }, select: publicEventSelect });
  if (!event || event.status !== "PUBLISHED") throw new NotFoundError("Event");

  const points = await prisma.pickupPoint.findMany({
    where: { isActive: true },
    select: { id: true, name: true, address: true, lat: true, lng: true },
  });

  return ok({ ...presentPublicEvent(event), pickupPoints: pickupOptions(event.venue, points) });
});
