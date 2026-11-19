import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { eventFunnel } from "@ride/db/trips";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ActionForm } from "@/components/ActionForm";
import { recordSpend, uploadPoster } from "@/lib/event-actions";
import { SPEND_CHANNELS } from "@/lib/event-forms";
import { EventStatusButtons } from "./EventStatusButtons";
import { sast } from "../page";

export const dynamic = "force-dynamic";

/** Where the public event pages are served (the API app). */
const PUBLIC_BASE = process.env.PUBLIC_EVENTS_URL ?? "http://localhost:3000";

const rand = (n: number) => `R ${n.toFixed(2)}`;

/**
 * One event: poster, publishing, the links to share, what promotion cost, and
 * the funnel that says whether it paid (docs/PLAN.md Phase 3.2 and 3.3).
 */
export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const event = await prisma.event.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      startsAt: true,
      endsAt: true,
      ticketInfo: true,
      description: true,
      posterSha256: true,
      publishedAt: true,
      venue: { select: { name: true, agreementAt: true } },
      spends: { orderBy: { spentOn: "desc" }, select: { id: true, channel: true, amount: true, spentOn: true, note: true } },
    },
  });
  if (!event) notFound();

  const [visits, requests, trips] = await Promise.all([
    prisma.eventVisit.groupBy({ by: ["channel"], where: { eventId: id }, _count: { _all: true } }),
    prisma.tripRequest.findMany({ where: { eventId: id }, select: { status: true, seats: true } }),
    prisma.groupTrip.findMany({ where: { eventId: id }, select: { id: true, status: true } }),
  ]);
  const fees = await prisma.ledgerEntry.aggregate({
    where: { kind: "FEE_DUE", sourceType: "GROUP_TRIP", sourceId: { in: trips.map((t) => t.id) } },
    _sum: { amount: true },
  });
  const funnel = eventFunnel({
    visits: visits.map((v) => ({ channel: v.channel, count: v._count._all })),
    requests,
    fees: Number(fees._sum.amount ?? 0),
    spend: event.spends.reduce((sum, s) => sum + Number(s.amount), 0),
  });

  const pageUrl = `${PUBLIC_BASE}/e/${event.slug}`;
  const shareLinks = [
    { label: "Facebook post", url: `${pageUrl}?src=fb` },
    { label: "WhatsApp", url: `${pageUrl}?src=wa` },
    { label: "SMS", url: `${pageUrl}?src=sms` },
    { label: "QR on a printed poster", url: `${pageUrl}?src=poster` },
  ];

  return (
    <div className="p-8 space-y-6">
      <Link href="/dashboard/events" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-amber-400">
        <ArrowLeft size={14} /> Events
      </Link>
      <PageHeader
        title={event.title}
        subtitle={`${event.venue.name} · ${sast(event.startsAt)}${event.endsAt ? ` to ${sast(event.endsAt)}` : ""}`}
        action={<EventStatusButtons eventId={event.id} status={event.status} />}
      />

      <div className="flex gap-2 flex-wrap">
        <Badge variant={event.status === "PUBLISHED" ? "success" : event.status === "CANCELLED" ? "danger" : "neutral"}>
          {event.status.toLowerCase()}
        </Badge>
        {!event.venue.agreementAt && <Badge variant="warning">Venue has no agreement on record: cannot publish</Badge>}
        {!event.posterSha256 && <Badge variant="warning">No poster yet: cannot publish</Badge>}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <h2 className="text-sm font-semibold text-slate-100 mb-4">Poster</h2>
          {event.posterSha256 ? (
            // eslint-disable-next-line @next/next/no-img-element -- an admin-only, same-origin preview; next/image adds nothing here
            <img src={`/dashboard/events/${event.id}/poster`} alt={`Poster for ${event.title}`} className="max-h-96 rounded-lg mb-4" />
          ) : (
            <p className="text-sm text-slate-400 mb-4">No poster yet.</p>
          )}
          {event.status === "DRAFT" ? (
            <ActionForm
              action={uploadPoster}
              hidden={{ eventId: event.id }}
              submitLabel={event.posterSha256 ? "Replace poster" : "Upload poster"}
              successMessage="Poster saved, without its metadata."
              fields={[
                {
                  name: "poster",
                  label: "JPEG or PNG, up to 2 MB",
                  type: "file",
                  accept: "image/jpeg,image/png",
                  required: true,
                  hint: "Location, camera and author details are removed before it is stored.",
                },
              ]}
            />
          ) : (
            <p className="text-xs text-slate-500">A published event&apos;s poster is fixed: it is already in the shared previews.</p>
          )}
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-slate-100 mb-4">Links to share</h2>
          {event.status === "PUBLISHED" ? (
            <ul className="space-y-3">
              {shareLinks.map((l) => (
                <li key={l.label}>
                  <p className="text-xs text-slate-400">{l.label}</p>
                  <code className="text-xs text-amber-300 break-all">{l.url}</code>
                </li>
              ))}
              <li className="text-xs text-slate-500">
                Each link counts its visits separately, so the funnel shows which channel brought people.
              </li>
            </ul>
          ) : (
            <p className="text-sm text-slate-400">The links work once the event is published.</p>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="text-sm font-semibold text-slate-100 mb-4">Did promoting it pay?</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          {[
            ["Page views", String(funnel.views)],
            ["Trip requests", String(funnel.requests)],
            ["Seats booked", `${funnel.seatsBooked} of ${funnel.seatsRequested}`],
            ["Fees earned", rand(funnel.fees)],
            ["Spent promoting", rand(funnel.spend)],
            ["Net", rand(funnel.net)],
            ["Requests per view", funnel.requestsPerView === null ? "—" : `${Math.round(funnel.requestsPerView * 100)}%`],
            ["Spend per booked seat", funnel.spendPerBookedSeat === null ? "—" : rand(funnel.spendPerBookedSeat)],
          ].map(([label, value]) => (
            <div key={label} className="bg-slate-800/50 rounded-lg p-3">
              <p className="text-xs text-slate-400">{label}</p>
              <p className="text-lg font-bold text-slate-100">{value}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400">
          Views by channel:{" "}
          {funnel.viewsByChannel.length ? funnel.viewsByChannel.map((v) => `${v.channel} ${v.count}`).join(" · ") : "none yet"}
        </p>
        <p className="text-xs text-slate-500 mt-2">
          Fees are those owed from this event&apos;s completed group trips. Small numbers: one event is an anecdote, not a
          trend.
        </p>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-slate-100 mb-4">Promotion spend</h2>
        <ActionForm
          action={recordSpend}
          hidden={{ eventId: event.id }}
          submitLabel="Record spend"
          successMessage="Recorded."
          fields={[
            {
              name: "channel",
              label: "Where",
              type: "select",
              required: true,
              defaultValue: "META",
              options: SPEND_CHANNELS.map((c) => ({ value: c, label: c === "META" ? "Facebook / Meta boost" : "Other" })),
            },
            { name: "amount", label: "Amount (R)", type: "number", required: true, placeholder: "150.00" },
            { name: "spentOn", label: "Date", type: "date", required: true },
            { name: "note", label: "Note", placeholder: "e.g. 3-day boost, Sekhukhune" },
          ]}
        />
        {event.spends.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-700">
            {event.spends.map((s) => (
              <li key={s.id} className="py-2 flex justify-between text-sm">
                <span className="text-slate-300">
                  {s.spentOn.toISOString().slice(0, 10)} · {s.channel}
                  {s.note ? ` · ${s.note}` : ""}
                </span>
                <span className="text-slate-100">{rand(Number(s.amount))}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
