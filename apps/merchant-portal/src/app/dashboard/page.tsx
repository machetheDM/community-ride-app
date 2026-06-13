import Link from "next/link";
import { redirect } from "next/navigation";
import { ShoppingBag, Package, DollarSign, Store as StoreIcon, ArrowRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { AutoRefresh } from "@/components/AutoRefresh";

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

const statusBadge: Record<string, string> = {
  PENDING: "bg-blue-500/10 text-blue-400",
  CONFIRMED: "bg-indigo-500/10 text-indigo-400",
  PREPARING: "bg-amber-500/10 text-amber-400",
  READY_FOR_PICKUP: "bg-cyan-500/10 text-cyan-400",
  OUT_FOR_DELIVERY: "bg-orange-500/10 text-orange-400",
  DELIVERED: "bg-emerald-500/10 text-emerald-400",
  CANCELLED: "bg-red-500/10 text-red-400",
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

  const stats = [
    { label: "Today's Orders", value: String(todayOrders), sub: `${pendingOrders} need action`, icon: ShoppingBag, color: "text-amber-400", bg: "bg-amber-500/10" },
    { label: "Active Products", value: String(activeProducts), sub: "available", icon: Package, color: "text-blue-400", bg: "bg-blue-500/10" },
    { label: "Today's Revenue", value: `R ${revenueToday.toFixed(0)}`, sub: `${deliveredToday.length} delivered`, icon: DollarSign, color: "text-emerald-400", bg: "bg-emerald-500/10" },
    { label: "Stores Open", value: `${stores.filter((s) => s.isOpen).length}/${stores.length}`, sub: "accepting orders", icon: StoreIcon, color: "text-purple-400", bg: "bg-purple-500/10" },
  ];

  return (
    <div className="p-8">
      <AutoRefresh intervalMs={15000} />

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-100">Welcome back, {session.name}</h1>
        <p className="text-slate-400 text-sm mt-1">
          {new Date().toLocaleDateString("en-ZA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>

      {pendingOrders > 0 && (
        <Link
          href="/dashboard/orders"
          className="mb-6 flex items-center justify-between gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl hover:bg-amber-500/15 transition-colors"
        >
          <div className="flex items-center gap-3">
            <ShoppingBag size={18} className="text-amber-400 shrink-0" />
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
        {stats.map(({ label, value, sub, icon: Icon, color, bg }) => (
          <div key={label} className="bg-[#1e293b] rounded-xl p-5 border border-slate-700">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">{label}</p>
                <p className="text-2xl font-bold text-slate-100 mt-1">{value}</p>
                <p className="text-slate-500 text-xs mt-1">{sub}</p>
              </div>
              <div className={`${bg} p-2.5 rounded-lg`}>
                <Icon size={18} className={color} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-[#1e293b] rounded-xl border border-slate-700">
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <h2 className="text-sm font-semibold text-slate-100">Recent Orders</h2>
          <Link href="/dashboard/orders" className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1">
            View all <ArrowRight size={12} />
          </Link>
        </div>
        <div className="divide-y divide-slate-700">
          {recentOrders.length === 0 ? (
            <p className="p-8 text-center text-slate-500 text-sm">No orders yet</p>
          ) : (
            recentOrders.map((order) => (
              <div key={order.id} className="flex items-center justify-between p-4 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-slate-200 text-xs font-bold shrink-0">
                    {order.customer.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-slate-200 text-sm font-medium truncate">{order.customer.name}</p>
                    <p className="text-slate-500 text-xs truncate">{order.store.name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-[11px] px-2 py-1 rounded-md font-medium ${statusBadge[order.status] ?? "bg-slate-700 text-slate-300"}`}>
                    {order.status.replace(/_/g, " ")}
                  </span>
                  <span className="text-slate-400 text-sm w-20 text-right">R {Number(order.total).toFixed(2)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
