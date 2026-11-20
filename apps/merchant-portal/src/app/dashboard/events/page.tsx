import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { ActionForm } from "@/components/ActionForm";
import { createEvent } from "@/lib/event-actions";

export const metadata = { title: "Events" };
export const dynamic = "force-dynamic";

const STATUS_BADGE = {
  DRAFT: { variant: "neutral", label: "Draft" },
  PUBLISHED: { variant: "success", label: "Published" },
  CANCELLED: { variant: "danger", label: "Cancelled" },
} as const;

/** Formats a time in South Africa (UTC+2, no daylight saving). */
export function sast(date: Date): string {
  return new Date(date.getTime() + 2 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
}

/** Events at partner venues (docs/PLAN.md Phase 3.2). ADMIN only. */
export default async function EventsPage() {
  await requireAdmin();

  const [events, venues] = await Promise.all([
    prisma.event.findMany({
      orderBy: { startsAt: "desc" },
      take: 100,
      select: {
        id: true,
        title: true,
        status: true,
        startsAt: true,
        posterSha256: true,
        venue: { select: { name: true } },
        _count: { select: { tripRequests: true, visits: true } },
      },
    }),
    prisma.venue.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, agreementAt: true } }),
  ]);

  const columns = [
    {
      key: "event",
      header: "Event",
      cell: (e: (typeof events)[number]) => (
        <Link href={`/dashboard/events/${e.id}`} className="flex items-center gap-3 group">
          <CalendarDays size={18} className="text-amber-400 shrink-0" />
          <div>
            <p className="text-slate-100 font-semibold group-hover:text-amber-400">{e.title}</p>
            <p className="text-slate-500 text-xs">
              {e.venue.name} · {sast(e.startsAt)}
            </p>
          </div>
        </Link>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (e: (typeof events)[number]) => {
        const s = STATUS_BADGE[e.status];
        return <Badge variant={s.variant}>{s.label}</Badge>;
      },
    },
    { key: "poster", header: "Poster", cell: (e: (typeof events)[number]) => (e.posterSha256 ? "Yes" : "—") },
    { key: "visits", header: "Page views", align: "right" as const, cell: (e: (typeof events)[number]) => e._count.visits },
    { key: "requests", header: "Trip requests", align: "right" as const, cell: (e: (typeof events)[number]) => e._count.tripRequests },
  ];

  return (
    <div className="p-8 space-y-8">
      <PageHeader
        title="Events"
        subtitle="Draft an event from a venue's poster, publish it, then share its link and record what promoting it cost."
      />

      <Card>
        <h2 className="text-sm font-semibold text-slate-100 mb-4">New event</h2>
        {venues.length === 0 ? (
          <p className="text-sm text-slate-400">Add a venue first, on the Venues page.</p>
        ) : (
          <ActionForm
            action={createEvent}
            submitLabel="Create draft"
            successMessage="Draft created. Open it below to add the poster."
            fields={[
              {
                name: "venueId",
                label: "Venue",
                type: "select",
                required: true,
                options: venues.map((v) => ({ value: v.id, label: v.agreementAt ? v.name : `${v.name} (no agreement yet)` })),
              },
              { name: "title", label: "Title", placeholder: "As on the poster", required: true },
              { name: "startsAt", label: "Starts (SA time)", type: "datetime-local", required: true },
              { name: "endsAt", label: "Ends (SA time)", type: "datetime-local", hint: "Optional. Return trips leave at the end." },
              { name: "ticketInfo", label: "Tickets", placeholder: "e.g. R150 at the gate", wide: true },
              { name: "description", label: "Description", type: "textarea", wide: true },
            ]}
          />
        )}
      </Card>

      <DataTable
        columns={columns}
        rows={events}
        keyExtractor={(e) => e.id}
        empty={<EmptyState title="No events yet" description="Create the first draft above." />}
      />
    </div>
  );
}
