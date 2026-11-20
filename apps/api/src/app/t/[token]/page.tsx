import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSharedTrip } from "@/lib/group-trips";

export const dynamic = "force-dynamic";

/** Never indexed, never previewed with details: the link is for the people it is sent to. */
export const metadata: Metadata = {
  title: "A shared trip",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

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
 * Share-my-trip (docs/PLAN.md 3.9): what a passenger sends to family before
 * getting into a stranger's vehicle. The vehicle, its plate and the operator's
 * first name, where and when it leaves. Nobody on board is named, and no
 * position is shown. The link stops working 12 hours after the trip.
 */
export default async function SharedTripPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const trip = await loadSharedTrip(token);
  if (!trip) notFound();
  const v = trip.operator.vehicle;

  return (
    <main className="min-h-screen max-w-xl mx-auto p-5">
      <p className="text-amber-400 text-sm font-semibold uppercase tracking-wide">Shared trip</p>
      <h1 className="text-2xl font-bold mt-1">
        {trip.direction === "TO_EVENT" ? "To" : "Back from"} {trip.event}
      </h1>
      <p className="text-slate-300 mt-1">{trip.venue}</p>

      <dl className="mt-6 space-y-4">
        <div>
          <dt className="text-slate-500 text-xs uppercase">Leaves</dt>
          <dd className="text-lg">{sast(trip.departAt)}</dd>
        </div>
        <div>
          <dt className="text-slate-500 text-xs uppercase">From</dt>
          <dd className="text-lg">{trip.pickupPoint.name}</dd>
          <dd className="text-slate-400 text-sm">{trip.pickupPoint.address}</dd>
        </div>
        <div>
          <dt className="text-slate-500 text-xs uppercase">Vehicle</dt>
          <dd className="text-lg">
            {v ? `${v.color} ${v.make} ${v.model}` : "Not given"}
          </dd>
          {v && <dd className="text-2xl font-mono font-bold tracking-widest text-amber-400 mt-1">{v.licensePlate}</dd>}
        </div>
        <div>
          <dt className="text-slate-500 text-xs uppercase">Driver</dt>
          <dd className="text-lg">{trip.operator.firstName}</dd>
        </div>
        <div>
          <dt className="text-slate-500 text-xs uppercase">Trip</dt>
          <dd className="text-lg">{trip.status === "COMPLETED" ? "Finished" : "Booked"}</dd>
        </div>
      </dl>

      <p className="text-slate-500 text-xs mt-10 leading-relaxed">
        If the vehicle that arrives does not match this plate, do not get in. This page shows no one&apos;s phone
        number or location, and it stops working after the trip.
      </p>
    </main>
  );
}
