import { Landmark, MapPin, Store } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { ComplexForm } from "./ComplexForm";
import { StoreComplexSelect } from "./StoreComplexSelect";

export const metadata = { title: "Complexes" };
export const dynamic = "force-dynamic";

/**
 * Shopping complexes (docs/PLAN.md Phase 2.2): the unit the platform is sold to.
 * Each sets one delivery fee and one delivery radius for its stores. ADMIN only,
 * because both change what customers pay and where riders go.
 */
export default async function ComplexesPage() {
  await requireAdmin();

  const [complexes, stores] = await Promise.all([
    prisma.complex.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        address: true,
        deliveryRadiusKm: true,
        deliveryFee: true,
        isActive: true,
        _count: { select: { stores: true } },
      },
    }),
    prisma.store.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, address: true, isApproved: true, complexId: true },
    }),
  ]);

  const complexOptions = complexes.map((c) => ({ id: c.id, name: c.name }));

  const complexColumns = [
    {
      key: "complex",
      header: "Complex",
      cell: (c: (typeof complexes)[number]) => (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
            <Landmark size={18} className="text-amber-400" />
          </div>
          <div>
            <p className="text-slate-100 font-semibold">{c.name}</p>
            <p className="text-slate-500 text-xs flex items-center gap-1 mt-0.5">
              <MapPin size={11} /> {c.address}
            </p>
          </div>
        </div>
      ),
    },
    { key: "stores", header: "Stores", align: "center" as const, cell: (c: (typeof complexes)[number]) => c._count.stores },
    {
      key: "fee",
      header: "Delivery fee",
      align: "right" as const,
      cell: (c: (typeof complexes)[number]) => `R ${Number(c.deliveryFee).toFixed(2)}`,
    },
    {
      key: "radius",
      header: "Radius",
      align: "right" as const,
      cell: (c: (typeof complexes)[number]) => `${c.deliveryRadiusKm} km`,
    },
    {
      key: "status",
      header: "Status",
      cell: (c: (typeof complexes)[number]) =>
        c.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="neutral">Inactive</Badge>,
    },
  ];

  const storeColumns = [
    {
      key: "store",
      header: "Store",
      cell: (s: (typeof stores)[number]) => (
        <div className="flex items-center gap-3">
          <Store size={16} className="text-slate-500 shrink-0" />
          <div>
            <p className="text-slate-100 font-medium">{s.name}</p>
            <p className="text-slate-500 text-xs">{s.address}</p>
          </div>
        </div>
      ),
    },
    {
      key: "approved",
      header: "Approved",
      cell: (s: (typeof stores)[number]) =>
        s.isApproved ? <Badge variant="success">Yes</Badge> : <Badge variant="warning">Pending</Badge>,
    },
    {
      key: "complex",
      header: "Complex",
      cell: (s: (typeof stores)[number]) => (
        <StoreComplexSelect storeId={s.id} current={s.complexId} complexes={complexOptions} />
      ),
    },
  ];

  return (
    <div className="p-8 space-y-8">
      <PageHeader
        title="Shopping complexes"
        subtitle="Each complex sets one delivery fee and one delivery radius for the stores in it."
      />

      <Card>
        <h2 className="text-sm font-semibold text-slate-100 mb-4">Add a complex</h2>
        <ComplexForm />
      </Card>

      <DataTable
        columns={complexColumns}
        rows={complexes}
        keyExtractor={(c) => c.id}
        empty={<EmptyState title="No complexes yet" description="Add the first one above." />}
      />

      <div>
        <h2 className="text-sm font-semibold text-slate-100 mb-3">Which complex each store is in</h2>
        <DataTable
          columns={storeColumns}
          rows={stores}
          keyExtractor={(s) => s.id}
          empty={<EmptyState title="No stores yet" />}
        />
      </div>
    </div>
  );
}
