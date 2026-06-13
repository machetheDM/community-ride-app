import { redirect } from "next/navigation";
import { Clock, MapPin, Package } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { AutoRefresh } from "@/components/AutoRefresh";
import { OrderActions } from "@/components/OrderActions";

export const metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = ["PENDING", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY"] as const;

const statusBadge: Record<string, string> = {
  PENDING: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  CONFIRMED: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  PREPARING: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  READY_FOR_PICKUP: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  OUT_FOR_DELIVERY: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  DELIVERED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  CANCELLED: "bg-red-500/10 text-red-400 border-red-500/20",
};

function timeAgo(date: Date) {
  const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

async function getOrders(merchantId: string) {
  return prisma.order.findMany({
    where: { store: { merchantId } },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      customer: { select: { name: true, phone: true } },
      store: { select: { name: true } },
      items: { include: { product: { select: { name: true } } } },
    },
  });
}

export default async function OrdersPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const orders = await getOrders(session.merchantId);
  const active = orders.filter((o) => ACTIVE_STATUSES.includes(o.status as never));
  const past = orders.filter((o) => !ACTIVE_STATUSES.includes(o.status as never));

  return (
    <div className="p-8">
      <AutoRefresh />

      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Orders</h1>
          <p className="text-slate-400 text-sm mt-1">
            {active.length} active {active.length === 1 ? "order" : "orders"} · live updating
          </p>
        </div>
        <span className="flex items-center gap-2 text-xs text-slate-400">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Auto-refresh on
        </span>
      </div>

      {/* Active orders */}
      {active.length === 0 ? (
        <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-12 flex flex-col items-center gap-3">
          <Package size={40} className="text-slate-600" />
          <p className="text-slate-400 text-sm">No active orders right now</p>
          <p className="text-slate-600 text-xs">New orders will appear here automatically</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {active.map((order) => (
            <div key={order.id} className="bg-[#1e293b] border border-slate-700 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-slate-700">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-slate-200 font-bold text-sm shrink-0">
                    {order.customer.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-slate-100 text-sm font-semibold truncate">{order.customer.name}</p>
                    <p className="text-slate-500 text-xs flex items-center gap-1">
                      <Clock size={11} /> {timeAgo(order.createdAt)} · {order.store.name}
                    </p>
                  </div>
                </div>
                <span className={`text-[11px] px-2 py-1 rounded-md font-semibold border shrink-0 ${statusBadge[order.status] ?? "bg-slate-700 text-slate-300"}`}>
                  {order.status.replace(/_/g, " ")}
                </span>
              </div>

              <div className="p-4 space-y-2">
                {order.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-300">
                      <span className="text-amber-400 font-semibold">{item.quantity}×</span> {item.product.name}
                    </span>
                    <span className="text-slate-400">R {Number(item.totalPrice).toFixed(2)}</span>
                  </div>
                ))}
                {order.notes && (
                  <p className="text-xs text-slate-500 italic border-l-2 border-slate-600 pl-2 mt-2">
                    “{order.notes}”
                  </p>
                )}
                <div className="flex items-start gap-1.5 text-xs text-slate-500 pt-2 border-t border-slate-700/60 mt-2">
                  <MapPin size={12} className="mt-0.5 shrink-0" />
                  <span>{order.deliveryAddress}</span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 p-4 bg-slate-800/40 border-t border-slate-700">
                <div>
                  <p className="text-slate-500 text-[11px] uppercase tracking-wide">Total</p>
                  <p className="text-slate-100 font-bold">R {Number(order.total).toFixed(2)}</p>
                </div>
                <OrderActions orderId={order.id} status={order.status} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Past orders */}
      {past.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Recent History</h2>
          <div className="bg-[#1e293b] border border-slate-700 rounded-xl divide-y divide-slate-700">
            {past.slice(0, 15).map((order) => (
              <div key={order.id} className="flex items-center justify-between p-4 gap-3">
                <div className="min-w-0">
                  <p className="text-slate-300 text-sm truncate">{order.customer.name}</p>
                  <p className="text-slate-500 text-xs">{timeAgo(order.createdAt)} · {order.items.length} items</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-[11px] px-2 py-1 rounded-md font-semibold border ${statusBadge[order.status] ?? "bg-slate-700 text-slate-300"}`}>
                    {order.status.replace(/_/g, " ")}
                  </span>
                  <span className="text-slate-400 text-sm w-20 text-right">R {Number(order.total).toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
