import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { countVisit, pickupOptions, presentPublicEvent, publicEventSelect } from "@/lib/events";

export const dynamic = "force-dynamic";

/** Where this page is served, for the absolute URLs a link preview needs. */
const SITE = process.env.PUBLIC_EVENTS_URL ?? "http://localhost:3000";

/** The scheme the customer app registers (apps/customer-app/app.json). */
const APP_LINK = "community-ride://events/";

async function loadEvent(slug: string) {
  const event = await prisma.event.findUnique({ where: { slug }, select: publicEventSelect });
  return event && event.status === "PUBLISHED" ? event : null;
}

function sast(date: Date): string {
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * The Open Graph tags Facebook and WhatsApp read for the preview: the poster as
 * the image, so a shared link looks like the event (PLAN.md 3.2's check).
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const event = await loadEvent(slug);
  if (!event) return { title: "Event not found", robots: { index: false } };

  const description = `${sast(event.startsAt)} at ${event.venue.name}. Need a ride? Book a seat on a group trip.`;
  const image = event.posterSha256 ? `${SITE}/api/events/${event.slug}/poster` : undefined;
  return {
    title: event.title,
    description,
    openGraph: {
      title: event.title,
      description,
      url: `${SITE}/e/${event.slug}`,
      type: "website",
      ...(image ? { images: [{ url: image, alt: `Poster for ${event.title}` }] } : {}),
    },
    twitter: { card: image ? "summary_large_image" : "summary", title: event.title, description },
  };
}

/**
 * A published event's public page (docs/PLAN.md Phase 3.2, 3.3): the page a
 * Facebook post links to. It counts one view for the channel in `?src=` (fb, wa,
 * sms, poster, direct), leaving out link-preview crawlers. A view is a count and
 * nothing else: no IP, no cookie, no identifier.
 */
export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const event = await loadEvent(slug);
  if (!event) notFound();

  await countVisit(event.id, (await headers()).get("user-agent"), Array.isArray(query.src) ? query.src[0] : query.src);

  const shown = presentPublicEvent(event);
  const points = pickupOptions(
    event.venue,
    await prisma.pickupPoint.findMany({
      where: { isActive: true },
      select: { id: true, name: true, address: true, lat: true, lng: true },
    })
  );

  return (
    <main className="min-h-screen max-w-xl mx-auto p-5 pb-16">
      {shown.hasPoster && (
        // eslint-disable-next-line @next/next/no-img-element -- the poster route sets its own caching; next/image would re-encode it
        <img
          src={`/api/events/${event.slug}/poster`}
          alt={`Poster for ${event.title}`}
          className="w-full rounded-2xl border border-slate-700 mb-6"
        />
      )}

      <h1 className="text-3xl font-bold tracking-tight">{shown.title}</h1>
      <p className="text-amber-400 font-semibold mt-2">{sast(event.startsAt)}</p>
      <p className="text-slate-300 mt-1">
        {shown.venue.name}
        {shown.venue.area ? `, ${shown.venue.area}` : ""}
      </p>
      {shown.ticketInfo && <p className="text-slate-400 text-sm mt-2">Tickets: {shown.ticketInfo}</p>}
      {shown.description && <p className="text-slate-300 mt-4 whitespace-pre-line leading-relaxed">{shown.description}</p>}

      <section className="mt-8 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5">
        <h2 className="text-xl font-bold">Need a ride there?</h2>
        <p className="text-slate-300 mt-2 text-sm leading-relaxed">
          Say how many seats you need, from where, and what you can pay per seat. We put people leaving from the same
          place on one trip and offer it to local operators. When one accepts, you get their name, vehicle and number
          plate, and a code to show at pickup.
        </p>

        {points.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {points.slice(0, 5).map((p) => (
              <li key={p.id} className="flex justify-between gap-3 text-sm bg-slate-800/60 rounded-lg px-3 py-2">
                <span className="text-slate-200">
                  {p.name} <span className="text-slate-500">· {p.distanceKm} km</span>
                </span>
                <span className="text-slate-300 whitespace-nowrap">from R{p.price.floor} a seat</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-400 text-sm mt-4">Pickup points for this event are being arranged.</p>
        )}

        <a
          href={`${APP_LINK}${event.slug}`}
          className="mt-5 block text-center bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-xl py-3"
        >
          Book a seat in the Community Ride app
        </a>
        <p className="text-slate-500 text-xs mt-3 text-center">
          Seats are booked in the app, signed in with your phone number. Pay the operator on the day.
        </p>
      </section>

      <p className="text-slate-600 text-xs mt-8">
        This page counts how many times it is opened from each link, and nothing about who opened it.
      </p>
    </main>
  );
}
