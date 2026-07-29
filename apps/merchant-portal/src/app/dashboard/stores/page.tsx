import { redirect } from "next/navigation";
import { MapPin, Phone, Store, Star } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata = { title: "Stores" };
export const dynamic = "force-dynamic";

export default async function StoresPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const stores = await prisma.store.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      merchant: { include: { user: { select: { name: true, phone: true } } } },
      _count: { select: { products: true, orders: true } },
    },
  });

  const columns = [
    {
      key: "store",
      header: "Store",
      cell: (store: typeof stores[number]) => (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
            <Store size={18} className="text-amber-400" />
          </div>
          <div>
            <p className="text-slate-100 font-semibold">{store.name}</p>
            <p className="text-slate-500 text-xs flex items-center gap-1 mt-0.5">
              <Phone size={11} /> {store.phone}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "merchant",
      header: "Merchant",
      cell: (store: typeof stores[number]) => (
        <div>
          <p className="text-slate-200 text-sm font-medium">{store.merchant.user.name}</p>
          <p className="text-slate-500 text-xs">{store.merchant.user.phone}</p>
        </div>
      ),
    },
    {
      key: "address",
      header: "Address",
      cell: (store: typeof stores[number]) => (
        <div className="flex items-center gap-1.5 text-slate-400 text-xs max-w-[200px]">
          <MapPin size={12} className="shrink-0" />
          <span className="truncate">{store.address}</span>
        </div>
      ),
    },
    {
      key: "products",
      header: "Products",
      align: "center" as const,
      cell: (store: typeof stores[number]) => (
        <span className="text-slate-200 font-medium text-sm">{store._count.products}</span>
      ),
    },
    {
      key: "orders",
      header: "Orders",
      align: "center" as const,
      cell: (store: typeof stores[number]) => (
        <span className="text-slate-200 font-medium text-sm">{store._count.orders}</span>
      ),
    },
    {
      key: "rating",
      header: "Rating",
      align: "center" as const,
      cell: (store: typeof stores[number]) => (
        <div className="flex items-center justify-center gap-1">
          <Star size={13} className="text-amber-400 fill-amber-400" />
          <span className="text-slate-200 font-medium">{store.rating.toFixed(1)}</span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "center" as const,
      cell: (store: typeof stores[number]) => (
        <div className="flex items-center justify-center gap-2">
          <Badge variant={store.isApproved ? "success" : "warning"} dot={!store.isApproved}>
            {store.isApproved ? "Approved" : "Pending"}
          </Badge>
          <Badge variant={store.isOpen ? "success" : "neutral"}>
            {store.isOpen ? "Open" : "Closed"}
          </Badge>
        </div>
      ),
    },
  ];

  return (
    <div className="p-8">
      <PageHeader title="All Stores" subtitle={`${stores.length} stores registered`} />

      <Card padding="none">
        <DataTable
          columns={columns}
          rows={stores}
          keyExtractor={(store) => store.id}
          empty={<EmptyState icon={<Store size={40} className="text-slate-600" />} title="No stores yet" description="Stores will appear here once merchants register." />}
        />
      </Card>
    </div>
  );
}
