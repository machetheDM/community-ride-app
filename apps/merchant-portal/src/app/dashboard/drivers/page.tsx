import { Car, Star } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { auditAdminRead } from "@/lib/audit";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata = { title: "Drivers" };
export const dynamic = "force-dynamic";

export default async function DriversPage() {
  const session = await requireAdmin();

  // An explicit select, so the encrypted ID number and its hash are never read
  // into the page. The licence number is cut to its last four before it goes
  // anywhere near the markup.
  const rows = await prisma.driver.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      licenseNumber: true,
      idNumberLast4: true,
      isOnline: true,
      isApproved: true,
      rating: true,
      user: { select: { name: true, phone: true } },
      vehicle: { select: { color: true, make: true, model: true, licensePlate: true, year: true } },
      _count: { select: { rides: true } },
    },
  });
  const drivers = rows.map(({ licenseNumber, ...driver }) => ({ ...driver, licenceLast4: licenseNumber.slice(-4) }));
  await auditAdminRead(session, "Driver", drivers.length);

  const columns = [
    {
      key: "driver",
      header: "Driver",
      cell: (driver: typeof drivers[number]) => (
        <div className="flex items-center gap-3">
          <Avatar name={driver.user.name} size="md" />
          <div>
            <p className="text-slate-100 font-semibold">{driver.user.name}</p>
            <p className="text-slate-500 text-xs">{driver.user.phone}</p>
          </div>
        </div>
      ),
    },
    {
      key: "vehicle",
      header: "Vehicle",
      cell: (driver: typeof drivers[number]) =>
        driver.vehicle ? (
          <div>
            <p className="text-slate-200 text-sm font-medium">
              {driver.vehicle.color} {driver.vehicle.make} {driver.vehicle.model}
            </p>
            <p className="text-slate-500 text-xs">{driver.vehicle.licensePlate} · {driver.vehicle.year}</p>
          </div>
        ) : (
          <span className="text-slate-500 text-sm">No vehicle</span>
        ),
    },
    {
      key: "license",
      header: "Licence",
      cell: (driver: typeof drivers[number]) => (
        <span className="text-slate-300 text-xs font-mono">••• {driver.licenceLast4}</span>
      ),
    },
    {
      key: "idNumberLast4",
      header: "ID Number",
      cell: (driver: typeof drivers[number]) => (
        <span className="text-slate-300 text-xs font-mono">{driver.idNumberLast4 ? `••• ${driver.idNumberLast4}` : "—"}</span>
      ),
    },
    {
      key: "rides",
      header: "Rides",
      align: "center" as const,
      cell: (driver: typeof drivers[number]) => (
        <span className="text-slate-200 font-medium text-sm">{driver._count.rides}</span>
      ),
    },
    {
      key: "rating",
      header: "Rating",
      align: "center" as const,
      cell: (driver: typeof drivers[number]) => (
        <div className="flex items-center justify-center gap-1">
          <Star size={13} className="text-amber-400 fill-amber-400" />
          <span className="text-slate-200 font-medium">{driver.rating.toFixed(1)}</span>
        </div>
      ),
    },
    {
      key: "online",
      header: "Online",
      align: "center" as const,
      cell: (driver: typeof drivers[number]) => (
        <Badge variant={driver.isOnline ? "success" : "neutral"} dot={driver.isOnline}>
          {driver.isOnline ? "Online" : "Offline"}
        </Badge>
      ),
    },
    {
      key: "approved",
      header: "Approved",
      align: "center" as const,
      cell: (driver: typeof drivers[number]) => (
        <Badge variant={driver.isApproved ? "success" : "warning"} dot={!driver.isApproved}>
          {driver.isApproved ? "Approved" : "Pending"}
        </Badge>
      ),
    },
  ];

  return (
    <div className="p-8">
      <PageHeader title="Drivers" subtitle={`${drivers.length} drivers registered`} />

      <Card padding="none">
        <DataTable
          columns={columns}
          rows={drivers}
          keyExtractor={(driver) => driver.id}
          empty={<EmptyState icon={<Car size={40} className="text-slate-600" />} title="No drivers yet" description="Drivers will appear here once they register." />}
        />
      </Card>
    </div>
  );
}
