import { redirect } from "next/navigation";
import { DollarSign, MapPin } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [pricingConfigs, deliveryZones] = await Promise.all([
    prisma.pricingConfig.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.deliveryZone.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="p-8">
      <PageHeader
        title="Settings"
        subtitle="Platform pricing and delivery zone configuration"
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <div className="flex items-center gap-2 mb-6">
            <div className="p-2 rounded-lg bg-amber-500/10">
              <DollarSign size={18} className="text-amber-400" />
            </div>
            <h2 className="text-sm font-semibold text-slate-100">Pricing Configurations</h2>
          </div>

          {pricingConfigs.length === 0 ? (
            <EmptyState title="No pricing configs" description="Add pricing configs to start calculating fares." />
          ) : (
            <div className="divide-y divide-slate-700/50">
              {pricingConfigs.map((config) => (
                <div key={config.id} className="py-5 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-slate-100 font-semibold">{config.name}</h3>
                    <Badge variant={config.isActive ? "success" : "neutral"}>{config.isActive ? "Active" : "Inactive"}</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-slate-500 text-xs mb-1">Base Fare</p>
                      <p className="text-slate-200 font-medium">R {Number(config.baseFare).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs mb-1">Per Km</p>
                      <p className="text-slate-200 font-medium">R {Number(config.perKmRate).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs mb-1">Per Min</p>
                      <p className="text-slate-200 font-medium">R {Number(config.perMinuteRate).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs mb-1">Minimum</p>
                      <p className="text-slate-200 font-medium">R {Number(config.minimumFare).toFixed(2)}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-slate-500 text-xs mb-1">Platform Fee</p>
                      <p className="text-slate-200 font-medium">{config.platformFeePercent}%</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-center gap-2 mb-6">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <MapPin size={18} className="text-blue-400" />
            </div>
            <h2 className="text-sm font-semibold text-slate-100">Delivery Zones</h2>
          </div>

          {deliveryZones.length === 0 ? (
            <EmptyState title="No delivery zones" description="Add delivery zones to start serving addresses." />
          ) : (
            <div className="divide-y divide-slate-700/50">
              {deliveryZones.map((zone) => (
                <div key={zone.id} className="py-5 first:pt-0 last:pb-0 flex items-center justify-between">
                  <div>
                    <h3 className="text-slate-100 font-semibold">{zone.name}</h3>
                    {zone.description && <p className="text-slate-500 text-xs mt-0.5">{zone.description}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-200 font-medium text-sm">R {Number(zone.feeAmount).toFixed(2)}</span>
                    <Badge variant={zone.isActive ? "success" : "neutral"}>{zone.isActive ? "Active" : "Inactive"}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
