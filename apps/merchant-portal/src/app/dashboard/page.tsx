import Link from "next/link";
import { redirect } from "next/navigation";
import { ShoppingBag, Package, DollarSign, Store as StoreIcon, ArrowRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { AutoRefresh } from "@/components/AutoRefresh";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

const statusVariant: Record<string, "default" | "success" | "warning" | "danger" | "info" | "neutral"> = {
  PENDING: "info",
  CONFIRMED: "info",
  PREPARING: "warning",
  READY_FOR_PICKUP: "warning",
  OUT_FOR_DELIVERY: "default",
  DELIVERED: "success",
  CANCELLED: "danger",
};

export default async function MerchantDashboard() {
  const session = await getSession();
  if (!session) redirect("/login");

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const storeWhere = { store: { merchantId: session.merchantId } };

  const [todayOrders, pendingOrders, activeProducts, deliveredToday, stores, recentOrders] = await Promise.all([
    prisma.order.count({ where: { ...storeWhere, createdAt: { gte: startOfDay } } }),
    prisma.order.count({ where: { ...storeWhere, status: { in: ["PENDING", "CONFIRMED", "PREPARING"] } } }),
    prisma.product.count({ where: { store: { merchantId: session.merchantId }, isAvailable: true } }),
    prisma.order.findMany({
      where: { ...storeWhere, status: "DELIVERED", deliveredAt: { gte: startOfDay } },
      select: { total: true },
    }),
    prisma.store.findMany({
      where: { merchantId: session.merchantId },
      select: { id: true, name: true, isOpen: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.order.findMany({
      where: storeWhere,
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { customer: { select: { name: true } }, store: { select: { name: true } } },
    }),
  ]);

  const revenueToday = deliveredToday.reduce((sum, o) => sum + Number(o.total), 0);

  return (
    <div className="p-8">
      <AutoRefresh intervalMs={15000} />

      <PageHeader
        title={`Welcome back, ${session.name}`}
        subtitle={new Date().toLocaleDateString("en-ZA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
      />

      {pendingOrders > 0 && (
        <Link
          href="/dashboard/orders"
          className="mb-8 flex items-center justify-between gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl hover:bg-amber-500/15 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10">
              <ShoppingBag size={18} className="text-amber-400 shrink-0" />
            </div>
            <div>
              <p className="text-amber-300 text-sm font-semibold">
                {pendingOrders} {pendingOrders === 1 ? "order needs" : "orders need"} your attention
              </p>
              <p className="text-amber-400/70 text-xs mt-0.5">Tap to review and confirm incoming orders.</p>
            </div>
          </div>
          <ArrowRight size={18} className="text-amber-400 shrink-0" />
        </Link>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <StatCard label="Today's Orders" value={String(todayOrders)} sub={`${pendingOrders} need action`} icon={ShoppingBag} color="amber" />
        <StatCard label="Active Products" value={String(activeProducts)} sub="available" icon={Package} color="blue" />
        <StatCard label="Today's Revenue" value={`R ${revenueToday.toFixed(0)}`} sub={`${deliveredToday.length} delivered`} icon={DollarSign} color="emerald" />
        <StatCard label="Stores Open" value={`${stores.filter((s) => s.isOpen).length}/${stores.length}`} sub="accepting orders" icon={StoreIcon} color="purple" />
      </div>

      <Card padding="none">
        <div className="flex items-center justify-between p-5 border-b border-slate-700/50">
          <h2 className="text-sm font-semibold text-slate-100">Recent Orders</h2>
          <Link href="/dashboard/orders" className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1">
            View all <ArrowRight size={12} />
          </Link>
        </div>
        <div className="divide-y divide-slate-700/40">
          {recentOrders.length === 0 ? (
            <EmptyState title="No orders yet" description="Orders will appear here once customers start ordering." />
          ) : (
            recentOrders.map((order) => (
              <div key={order.id} className="flex items-center justify-between p-4 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar name={order.customer.name} size="sm" />
                  <div className="min-w-0">
                    <p className="text-slate-200 text-sm font-semibold truncate">{order.customer.name}</p>
                    <p className="text-slate-500 text-xs truncate">{order.store.name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Badge variant={statusVariant[order.status] ?? "neutral"}>{order.status.replace(/_/g, " ")}</Badge>
                  <span className="text-slate-400 text-sm w-20 text-right">R {Number(order.total).toFixed(2)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
