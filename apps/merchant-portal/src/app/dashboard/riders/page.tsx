import { redirect } from "next/navigation";
import { Bike, Star } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata = { title: "Riders" };
export const dynamic = "force-dynamic";

export default async function RidersPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const riders = await prisma.rider.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { name: true, phone: true, email: true } },
      vehicle: true,
      _count: { select: { deliveries: true } },
    },
  });

  const columns = [
    {
      key: "rider",
      header: "Rider",
      cell: (rider: typeof riders[number]) => (
        <div className="flex items-center gap-3">
          <Avatar name={rider.user.name} size="md" />
          <div>
            <p className="text-slate-100 font-semibold">{rider.user.name}</p>
            <p className="text-slate-500 text-xs">{rider.user.phone}</p>
          </div>
        </div>
      ),
    },
    {
      key: "vehicle",
      header: "Vehicle",
      cell: (rider: typeof riders[number]) =>
        rider.vehicle ? (
          <div>
            <p className="text-slate-200 text-sm font-medium">
              {rider.vehicle.color} {rider.vehicle.make} {rider.vehicle.model}
            </p>
            <p className="text-slate-500 text-xs">{rider.vehicle.licensePlate} · {rider.vehicle.year}</p>
          </div>
        ) : (
          <span className="text-slate-500 text-sm">No vehicle</span>
        ),
    },
    {
      key: "idNumber",
      header: "ID Number",
      cell: (rider: typeof riders[number]) => (
        <span className="text-slate-300 text-xs font-mono">{rider.idNumber}</span>
      ),
    },
    {
      key: "deliveries",
      header: "Deliveries",
      align: "center" as const,
      cell: (rider: typeof riders[number]) => (
        <span className="text-slate-200 font-medium text-sm">{rider._count.deliveries}</span>
      ),
    },
    {
      key: "rating",
      header: "Rating",
      align: "center" as const,
      cell: (rider: typeof riders[number]) => (
        <div className="flex items-center justify-center gap-1">
          <Star size={13} className="text-amber-400 fill-amber-400" />
          <span className="text-slate-200 font-medium">{rider.rating.toFixed(1)}</span>
        </div>
      ),
    },
    {
      key: "online",
      header: "Online",
      align: "center" as const,
      cell: (rider: typeof riders[number]) => (
        <Badge variant={rider.isOnline ? "success" : "neutral"} dot={rider.isOnline}>
          {rider.isOnline ? "Online" : "Offline"}
        </Badge>
      ),
    },
    {
      key: "approved",
      header: "Approved",
      align: "center" as const,
      cell: (rider: typeof riders[number]) => (
        <Badge variant={rider.isApproved ? "success" : "warning"} dot={!rider.isApproved}>
          {rider.isApproved ? "Approved" : "Pending"}
        </Badge>
      ),
    },
  ];

  return (
    <div className="p-8">
      <PageHeader title="Riders" subtitle={`${riders.length} riders registered`} />

      <Card padding="none">
        <DataTable
          columns={columns}
          rows={riders}
          keyExtractor={(rider) => rider.id}
          empty={<EmptyState icon={<Bike size={40} className="text-slate-600" />} title="No riders yet" description="Riders will appear here once they register." />}
        />
      </Card>
    </div>
  );
}
