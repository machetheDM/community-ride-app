import type { Prisma } from "@ride/db";
import { seatPrice, visitChannel } from "@ride/db/trips";
import { coarseArea, haversineKm } from "@/lib/geo";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

/**
 * Public event pages and their data (docs/PLAN.md Phase 3.2 and 3.4).
 *
 * Only published events are public. Nothing about a venue's contact, the poster's
 * bytes beyond the poster route, or who has asked for seats leaves here.
 */

/** Pickup points further than this from the venue are not offered for its events. */
export const PICKUP_RADIUS_KM = 60;

export const publicEventSelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  startsAt: true,
  endsAt: true,
  ticketInfo: true,
  status: true,
  posterSha256: true,
  venue: { select: { name: true, kind: true, address: true, lat: true, lng: true } },
} satisfies Prisma.EventSelect;

export type PublicEventRecord = Prisma.EventGetPayload<{ select: typeof publicEventSelect }>;

/** The event as anyone may see it. The venue's town, not its contact. */
export function presentPublicEvent(event: PublicEventRecord) {
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    ticketInfo: event.ticketInfo,
    hasPoster: Boolean(event.posterSha256),
    venue: {
      name: event.venue.name,
      kind: event.venue.kind,
      address: event.venue.address,
      area: coarseArea(event.venue.address),
    },
  };
}

/**
 * The pickup points offered for an event, nearest first, each with the floor and
 * suggested range for a seat from there (the distance is pickup to venue).
 */
export function pickupOptions(
  venue: { lat: number; lng: number },
  points: { id: string; name: string; address: string; lat: number; lng: number }[]
) {
  return points
    .map((p) => ({ point: p, km: haversineKm({ lat: p.lat, lng: p.lng }, venue) }))
    .filter(({ km }) => km <= PICKUP_RADIUS_KM)
    .sort((a, b) => a.km - b.km)
    .map(({ point, km }) => ({
      id: point.id,
      name: point.name,
      address: point.address,
      distanceKm: Math.round(km * 10) / 10,
      price: seatPrice(km),
    }));
}

/**
 * Link-preview crawlers. Facebook and WhatsApp fetch a shared page to build its
 * preview, and counting that as a visit would credit every share with a view
 * nobody made. Matched on the user agent, so a crawler that lies is counted;
 * the funnel says views, not people.
 */
const CRAWLERS = /facebookexternalhit|facebot|whatsapp|twitterbot|slackbot|telegrambot|linkedinbot|discordbot|googlebot|bingbot|bot\b|crawler|spider|preview/i;

export function isCrawler(userAgent: string | null): boolean {
  return !userAgent || CRAWLERS.test(userAgent);
}

/**
 * Counts one view of an event page for the channel in its `?src=` (PLAN.md 3.3),
 * unless a link-preview crawler asked. A view is a count and nothing else: no
 * address, no cookie, no identifier. Counting never stops the page: a failed
 * insert is logged and the visitor still sees the event.
 */
export async function countVisit(eventId: string, userAgent: string | null, src: unknown): Promise<boolean> {
  if (isCrawler(userAgent)) return false;
  try {
    await prisma.eventVisit.create({ data: { eventId, channel: visitChannel(src) } });
    return true;
  } catch (error) {
    logger.warn("[events] visit not counted", { eventId, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}
