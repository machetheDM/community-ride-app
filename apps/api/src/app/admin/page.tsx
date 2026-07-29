import { prisma } from "@/lib/prisma";
import { Car, ShoppingBag, Users, Store, Bike, TrendingUp, Clock, CheckCircle } from "lucide-react";

// This page reports live platform counts, so it must be rendered per request.
// Without this it was statically prerendered: the build required a reachable
// database, and the numbers it shipped were frozen at build time. Matches the
// convention used by every DB-backed page in the merchant portal.
export const dynamic = "force-dynamic";

async function getStats() {
  const [
    totalRides,
    activeRides,
    completedRidesTotal,
    totalOrders,
    pendingOrders,
    totalUsers,
    onlineDrivers,
    totalDrivers,
    onlineRiders,
    totalStores,
    openStores,
  ] = await Promise.all([
    prisma.ride.count(),
    prisma.ride.count({ where: { status: { in: ["REQUESTED", "ACCEPTED", "DRIVER_ARRIVED", "IN_PROGRESS"] } } }),
    prisma.ride.count({ where: { status: "COMPLETED" } }),
    prisma.order.count(),
    prisma.order.count({ where: { status: { in: ["PENDING", "CONFIRMED", "PREPARING"] } } }),
    prisma.user.count({ where: { role: "CUSTOMER" } }),
    prisma.driver.count({ where: { isOnline: true, isApproved: true } }),
    prisma.driver.count({ where: { isApproved: true } }),
    prisma.rider.count({ where: { isOnline: true, isApproved: true } }),
    prisma.store.count({ where: { isApproved: true } }),
    prisma.store.count({ where: { isOpen: true, isApproved: true } }),
  ]);

  return {
    totalRides, activeRides, completedRidesTotal,
    totalOrders, pendingOrders,
    totalUsers, onlineDrivers, totalDrivers,
    onlineRiders, totalStores, openStores,
  };
}

async function getRecentRides() {
  return prisma.ride.findMany({
    take: 5,
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { name: true, phone: true } },
      driver: { include: { user: { select: { name: true } } } },
    },
  });
}

async function getRecentOrders() {
  return prisma.order.findMany({
    take: 5,
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { name: true } },
      store: { select: { name: true } },
    },
  });
}

const statusColors: Record<string, string> = {
  REQUESTED: "bg-blue-500/10 text-blue-400",
  ACCEPTED: "bg-indigo-500/10 text-indigo-400",
  IN_PROGRESS: "bg-amber-500/10 text-amber-400",
  COMPLETED: "bg-emerald-500/10 text-emerald-400",
  CANCELLED: "bg-red-500/10 text-red-400",
  PENDING: "bg-blue-500/10 text-blue-400",
  CONFIRMED: "bg-indigo-500/10 text-indigo-400",
  PREPARING: "bg-amber-500/10 text-amber-400",
  DELIVERED: "bg-emerald-500/10 text-emerald-400",
  DRIVER_ARRIVED: "bg-purple-500/10 text-purple-400",
  READY_FOR_PICKUP: "bg-cyan-500/10 text-cyan-400",
  OUT_FOR_DELIVERY: "bg-orange-500/10 text-orange-400",
};

export default async function AdminDashboard() {
  const [stats, recentRides, recentOrders] = await Promise.all([
    getStats(),
    getRecentRides(),
    getRecentOrders(),
  ]);

  const statCards = [
    {
      label: "Total Rides",
      value: stats.totalRides,
      sub: `${stats.activeRides} active`,
      icon: Car,
      color: "text-amber-400",
      bg: "bg-amber-500/10",
    },
    {
      label: "Total Orders",
      value: stats.totalOrders,
      sub: `${stats.pendingOrders} pending`,
      icon: ShoppingBag,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
    },
    {
      label: "Customers",
      value: stats.totalUsers,
      sub: "registered",
      icon: Users,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
    },
    {
      label: "Drivers Online",
      value: stats.onlineDrivers,
      sub: `of ${stats.totalDrivers} approved`,
      icon: Car,
      color: "text-purple-400",
      bg: "bg-purple-500/10",
    },
    {
      label: "Riders Online",
      value: stats.onlineRiders,
      sub: "scooter riders",
      icon: Bike,
      color: "text-pink-400",
      bg: "bg-pink-500/10",
    },
    {
      label: "Stores Open",
      value: stats.openStores,
      sub: `of ${stats.totalStores} approved`,
      icon: Store,
      color: "text-cyan-400",
      bg: "bg-cyan-500/10",
    },
  ];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-100">Dashboard</h1>
        <p className="text-slate-400 text-sm mt-1">
          {new Date().toLocaleDateString("en-ZA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
        {statCards.map(({ label, value, sub, icon: Icon, color, bg }) => (
          <div key={label} className="bg-[#1e293b] rounded-xl p-5 border border-slate-700">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">{label}</p>
                <p className="text-3xl font-bold text-slate-100 mt-1">{value}</p>
                <p className="text-slate-500 text-xs mt-1">{sub}</p>
              </div>
              <div className={`${bg} p-2.5 rounded-lg`}>
                <Icon size={20} className={color} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Recent Rides */}
        <div className="bg-[#1e293b] rounded-xl border border-slate-700">
          <div className="flex items-center justify-between p-5 border-b border-slate-700">
            <div className="flex items-center gap-2">
              <TrendingUp size={16} className="text-amber-400" />
              <h2 className="text-sm font-semibold text-slate-100">Recent Rides</h2>
            </div>
            <span className="text-xs text-slate-400">{stats.activeRides} active</span>
          </div>
          <div className="divide-y divide-slate-700">
            {recentRides.length === 0 ? (
              <p className="p-5 text-slate-500 text-sm text-center">No rides yet</p>
            ) : (
              recentRides.map((ride) => (
                <div key={ride.id} className="p-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                      <Car size={14} className="text-amber-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-slate-200 text-sm font-medium truncate">{ride.customer.name}</p>
                      <p className="text-slate-500 text-xs truncate">{ride.dropoffAddress}</p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-md font-medium shrink-0 ${statusColors[ride.status] ?? "bg-slate-700 text-slate-300"}`}>
                    {ride.status.replace(/_/g, " ")}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Orders */}
        <div className="bg-[#1e293b] rounded-xl border border-slate-700">
          <div className="flex items-center justify-between p-5 border-b border-slate-700">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-blue-400" />
              <h2 className="text-sm font-semibold text-slate-100">Recent Orders</h2>
            </div>
            <span className="text-xs text-slate-400">{stats.pendingOrders} pending</span>
          </div>
          <div className="divide-y divide-slate-700">
            {recentOrders.length === 0 ? (
              <p className="p-5 text-slate-500 text-sm text-center">No orders yet</p>
            ) : (
              recentOrders.map((order) => (
                <div key={order.id} className="p-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                      <ShoppingBag size={14} className="text-blue-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-slate-200 text-sm font-medium truncate">{order.customer.name}</p>
                      <p className="text-slate-500 text-xs truncate">{order.store.name}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-xs px-2 py-1 rounded-md font-medium ${statusColors[order.status] ?? "bg-slate-700 text-slate-300"}`}>
                      {order.status}
                    </span>
                    <p className="text-slate-400 text-xs mt-1">R {Number(order.total).toFixed(2)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Platform Health */}
      <div className="mt-6 bg-[#1e293b] rounded-xl border border-slate-700 p-5">
        <div className="flex items-center gap-2 mb-4">
          <CheckCircle size={16} className="text-emerald-400" />
          <h2 className="text-sm font-semibold text-slate-100">Platform Health</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Completion Rate", value: stats.totalRides > 0 ? `${Math.round((stats.completedRidesTotal / stats.totalRides) * 100)}%` : "—" },
            { label: "Active Drivers", value: `${stats.onlineDrivers}/${stats.totalDrivers}` },
            { label: "Open Stores", value: `${stats.openStores}/${stats.totalStores}` },
            { label: "Pending Orders", value: stats.pendingOrders },
          ].map(({ label, value }) => (
            <div key={label} className="text-center p-3 bg-slate-800/50 rounded-lg">
              <p className="text-xl font-bold text-slate-100">{value}</p>
              <p className="text-xs text-slate-400 mt-1">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
