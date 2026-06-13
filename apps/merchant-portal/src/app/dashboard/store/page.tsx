import { redirect } from "next/navigation";
import { MapPin, Phone, Package, Star, CheckCircle, Clock } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { StoreToggle } from "@/components/StoreToggle";

export const metadata = { title: "My Store" };
export const dynamic = "force-dynamic";

export default async function StorePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const stores = await prisma.store.findMany({
    where: { merchantId: session.merchantId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { products: true, orders: true } } },
  });

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-100">My Stores</h1>
        <p className="text-slate-400 text-sm mt-1">
          Toggle a store open or closed to control whether customers can order.
        </p>
      </div>

      {stores.length === 0 ? (
        <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-12 text-center text-slate-400 text-sm">
          No stores registered yet.
        </div>
      ) : (
        <div className="space-y-4">
          {stores.map((store) => (
            <div key={store.id} className="bg-[#1e293b] border border-slate-700 rounded-xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-bold text-slate-100">{store.name}</h2>
                    {store.isApproved ? (
                      <span className="flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                        <CheckCircle size={11} /> Approved
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md">
                        <Clock size={11} /> Pending
                      </span>
                    )}
                  </div>
                  {store.description && (
                    <p className="text-slate-400 text-sm mt-1">{store.description}</p>
                  )}
                </div>

                <div className="flex flex-col items-end gap-1 shrink-0">
                  <StoreToggle storeId={store.id} initialOpen={store.isOpen} />
                  <span className={`text-xs font-medium ${store.isOpen ? "text-emerald-400" : "text-slate-500"}`}>
                    {store.isOpen ? "Open" : "Closed"}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
                {[
                  { icon: MapPin, label: store.address },
                  { icon: Phone, label: store.phone },
                  { icon: Package, label: `${store._count.products} products` },
                  { icon: Star, label: store.rating ? store.rating.toFixed(1) : "No rating" },
                ].map(({ icon: Icon, label }, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-slate-400 bg-slate-800/50 rounded-lg px-3 py-2">
                    <Icon size={13} className="text-slate-500 shrink-0" />
                    <span className="truncate">{label}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
                <span>Delivery fee: <span className="text-slate-300">R {Number(store.deliveryFee).toFixed(2)}</span></span>
                <span>Min order: <span className="text-slate-300">R {Number(store.minimumOrder).toFixed(2)}</span></span>
                {store.openTime && <span>Hours: <span className="text-slate-300">{store.openTime}–{store.closeTime}</span></span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
