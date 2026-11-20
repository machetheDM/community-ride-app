import { MapPin, MapPinned, Handshake } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { auditAdminRead } from "@/lib/audit";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { ActionForm } from "@/components/ActionForm";
import { createPickupPoint, createVenue, recordVenueAgreement } from "@/lib/event-actions";
import { VENUE_KINDS } from "@/lib/event-forms";

export const metadata = { title: "Venues" };
export const dynamic = "force-dynamic";

const coordinateFields = [
  { name: "lat", label: "Latitude", type: "number" as const, placeholder: "-24.65", required: true, hint: "Negative in South Africa." },
  { name: "lng", label: "Longitude", type: "number" as const, placeholder: "29.93", required: true },
];

/**
 * Partner venues and the public pickup points group trips leave from (docs/PLAN.md
 * Phase 3.1). ADMIN only. A venue's contact details are a person's, so viewing
 * this page is audited like the other pages with personal data.
 */
export default async function VenuesPage() {
  const session = await requireAdmin();

  const [venues, points] = await Promise.all([
    prisma.venue.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        kind: true,
        address: true,
        contactName: true,
        contactPhone: true,
        agreementAt: true,
        agreementNote: true,
        isActive: true,
        _count: { select: { events: true } },
      },
    }),
    prisma.pickupPoint.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, address: true, isActive: true } }),
  ]);
  await auditAdminRead(session, "Venue", venues.length);

  const venueColumns = [
    {
      key: "venue",
      header: "Venue",
      cell: (v: (typeof venues)[number]) => (
        <div className="flex items-center gap-3">
          <MapPinned size={18} className="text-amber-400 shrink-0" />
          <div>
            <p className="text-slate-100 font-semibold">{v.name}</p>
            <p className="text-slate-500 text-xs">{v.kind.toLowerCase()} · {v.address}</p>
          </div>
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      cell: (v: (typeof venues)[number]) => (
        <span className="text-slate-300 text-sm">{[v.contactName, v.contactPhone].filter(Boolean).join(" · ") || "—"}</span>
      ),
    },
    { key: "events", header: "Events", align: "center" as const, cell: (v: (typeof venues)[number]) => v._count.events },
    {
      key: "agreement",
      header: "Partner",
      cell: (v: (typeof venues)[number]) =>
        v.agreementAt ? (
          <div>
            <Badge variant="success">Agreed {v.agreementAt.toISOString().slice(0, 10)}</Badge>
            <p className="text-slate-500 text-xs mt-1 max-w-xs">{v.agreementNote}</p>
          </div>
        ) : (
          <ActionForm
            action={recordVenueAgreement}
            hidden={{ venueId: v.id }}
            submitLabel="Record agreement"
            successMessage="Recorded."
            fields={[{ name: "agreementNote", label: "What was agreed, with whom", placeholder: "Owner agreed to send every event poster" }]}
          />
        ),
    },
  ];

  const pointColumns = [
    {
      key: "point",
      header: "Pickup point",
      cell: (p: (typeof points)[number]) => (
        <div className="flex items-center gap-3">
          <MapPin size={16} className="text-slate-500 shrink-0" />
          <div>
            <p className="text-slate-100 font-medium">{p.name}</p>
            <p className="text-slate-500 text-xs">{p.address}</p>
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (p: (typeof points)[number]) =>
        p.isActive ? <Badge variant="success">In use</Badge> : <Badge variant="neutral">Retired</Badge>,
    },
  ];

  return (
    <div className="p-8 space-y-8">
      <PageHeader
        title="Venues and pickup points"
        subtitle="Partner venues send us their events' posters. Group trips leave only from public pickup points."
      />

      <Card>
        <h2 className="text-sm font-semibold text-slate-100 mb-4 flex items-center gap-2">
          <Handshake size={16} className="text-amber-400" /> Add a venue
        </h2>
        <ActionForm
          action={createVenue}
          submitLabel="Add venue"
          successMessage="Venue added."
          fields={[
            { name: "name", label: "Name", placeholder: "e.g. Riverside Resort", required: true },
            {
              name: "kind",
              label: "Kind",
              type: "select",
              required: true,
              options: VENUE_KINDS.map((k) => ({ value: k, label: k.charAt(0) + k.slice(1).toLowerCase() })),
            },
            { name: "address", label: "Address", placeholder: "Road, town", required: true, wide: true },
            ...coordinateFields,
            { name: "contactName", label: "Contact person", placeholder: "Owner or manager" },
            { name: "contactPhone", label: "Contact phone", type: "tel", placeholder: "+27..." },
            { name: "agreed", label: "Partnership", type: "checkbox", placeholder: "They have agreed to send us their events" },
            { name: "agreementNote", label: "What was agreed", placeholder: "Who agreed, and to what", hint: "Required when they have agreed." },
          ]}
        />
      </Card>

      <DataTable
        columns={venueColumns}
        rows={venues}
        keyExtractor={(v) => v.id}
        empty={<EmptyState title="No venues yet" description="Add the first partner above." />}
      />

      <Card>
        <h2 className="text-sm font-semibold text-slate-100 mb-4 flex items-center gap-2">
          <MapPin size={16} className="text-amber-400" /> Add a pickup point
        </h2>
        <ActionForm
          action={createPickupPoint}
          submitLabel="Add pickup point"
          successMessage="Pickup point added."
          fields={[
            { name: "name", label: "Name", placeholder: "e.g. Plaza taxi rank", required: true, hint: "A public place, never a home." },
            { name: "address", label: "Address", placeholder: "Road, town", required: true },
            ...coordinateFields,
          ]}
        />
      </Card>

      <DataTable
        columns={pointColumns}
        rows={points}
        keyExtractor={(p) => p.id}
        empty={<EmptyState title="No pickup points yet" description="Group trips need at least one." />}
      />
    </div>
  );
}
