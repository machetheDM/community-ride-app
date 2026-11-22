import { prisma } from "./prisma";

/** How many times an event's poster was read in the last 24 hours (the per-event cap in poster-reading.ts). */
export function countReadsToday(eventId: string): Promise<number> {
  return prisma.modelCall.count({
    where: { eventId, feature: "poster.read", createdAt: { gte: new Date(Date.now() - 86_400_000) } },
  });
}
