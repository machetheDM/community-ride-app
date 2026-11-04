import { BarChart3, TrendingUp, MapPin, XCircle, Clock, Database } from "lucide-react";
import {
  summary,
  demandByArea,
  peakHours,
  tripsPerDay,
  etaAccuracy,
  isQueryable,
} from "@ride/analytics";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

/**
 * Trip analytics, read from BigQuery.
 *
 * Three states, kept distinct on purpose:
 *   - **not configured** — no GCP project wired up
 *   - **configured but empty** — connected, genuinely no trips in the window
 *   - **has data** — render it
 *
 * Collapsing the first two into "0 trips" would present an unconfigured system as
 * a quiet one, which is the kind of dashboard that gets believed and then acted on.
 * There is no sample or placeholder data anywhere on this page: with one seeded
 * trip in the database it will look near-empty, and that is the correct output.
 */

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;

/** Minimum completed trips before the ETA model is worth training. */
const ETA_TRAINING_THRESHOLD = 200;

const currency = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 0,
});

export default async function AnalyticsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!isQueryable()) {
    return (
      <div className="space-y-6">
        <PageHeader title="Analytics" subtitle="Trip and delivery trends" />
        <Card>
          <EmptyState
            icon={<Database size={40} className="text-slate-600" />}
            title="Analytics is not configured"
            description="Set GOOGLE_CLOUD_PROJECT and BIGQUERY_DATASET to enable trip analytics. Nothing is being recorded until then."
          />
        </Card>
      </div>
    );
  }

  // A BigQuery outage must not take the whole portal down with an unhandled
  // rejection — the page degrades to the error state instead.
  let data;
  try {
    const [stats, areas, hours, daily, eta] = await Promise.all([
      summary({ sinceDays: WINDOW_DAYS }),
      demandByArea({ sinceDays: WINDOW_DAYS }),
      peakHours({ sinceDays: WINDOW_DAYS }),
      tripsPerDay({ sinceDays: WINDOW_DAYS }),
      etaAccuracy({ sinceDays: WINDOW_DAYS }),
    ]);
    data = { stats, areas, hours, daily, eta };
  } catch (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Analytics" subtitle="Trip and delivery trends" />
        <Card>
          <EmptyState
            icon={<XCircle size={40} className="text-red-500/70" />}
            title="Could not reach BigQuery"
            description={
              error instanceof Error ? error.message : "The analytics query failed."
            }
          />
        </Card>
      </div>
    );
  }

  const stats = data.stats;
  const totalTrips = stats?.total_trips ?? 0;

  if (totalTrips === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Analytics" subtitle={`Last ${WINDOW_DAYS} days`} />
        <Card>
          <EmptyState
            icon={<BarChart3 size={40} className="text-slate-600" />}
            title="No trips in this window"
            description={`Analytics is connected, but no trips have completed in the last ${WINDOW_DAYS} days. Figures will appear here as rides are taken.`}
          />
        </Card>
      </div>
    );
  }

  const cancellationRate =
    totalTrips > 0 ? ((stats?.cancelled_trips ?? 0) / totalTrips) * 100 : 0;

  const busiest = [...(data.hours ?? [])].sort((a, b) => b.trips - a.trips)[0];
  const completed = stats?.completed_trips ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" subtitle={`Last ${WINDOW_DAYS} days · BigQuery`} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Completed trips"
          value={String(completed)}
          sub={`${totalTrips} requested`}
          icon={TrendingUp}
          color="emerald"
        />
        <StatCard
          label="Revenue"
          value={currency.format(stats?.total_revenue ?? 0)}
          sub={`Avg ${currency.format(stats?.avg_fare ?? 0)} per trip`}
          icon={BarChart3}
          color="amber"
        />
        <StatCard
          label="Driver earnings"
          value={currency.format(stats?.driver_earnings ?? 0)}
          sub="After platform fee"
          icon={TrendingUp}
          color="blue"
        />
        <StatCard
          label="Cancellation rate"
          value={`${cancellationRate.toFixed(1)}%`}
          sub={`${stats?.cancelled_trips ?? 0} cancelled`}
          icon={XCircle}
          color={cancellationRate > 20 ? "red" : "purple"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Demand by area */}
        <Card>
          <h3 className="text-slate-200 font-semibold mb-4 flex items-center gap-2">
            <MapPin size={16} className="text-amber-400" />
            Demand by area
          </h3>
          {data.areas?.length ? (
            <div className="space-y-3">
              {data.areas.slice(0, 8).map((row) => {
                const share = completed > 0 ? (row.trips / completed) * 100 : 0;
                return (
                  <div key={row.area ?? "unknown"}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-300">{row.area ?? "Unknown"}</span>
                      <span className="text-slate-400">
                        {row.trips} · {currency.format(row.avg_fare)} avg
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-700/50 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-amber-500"
                        style={{ width: `${Math.max(2, share)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-slate-500 text-sm">No area data yet.</p>
          )}
        </Card>

        {/* Peak hours */}
        <Card>
          <h3 className="text-slate-200 font-semibold mb-4 flex items-center gap-2">
            <Clock size={16} className="text-cyan-400" />
            Peak demand by hour
          </h3>
          {data.hours?.length ? (
            <>
              <div className="flex items-end gap-1 h-40">
                {Array.from({ length: 24 }, (_, hour) => {
                  const row = data.hours?.find((h) => Number(h.hour_of_day) === hour);
                  const trips = row?.trips ?? 0;
                  const max = Math.max(...(data.hours ?? []).map((h) => h.trips), 1);
                  return (
                    <div
                      key={hour}
                      className="flex-1 bg-cyan-500/70 rounded-t hover:bg-cyan-400 transition-colors"
                      style={{ height: `${(trips / max) * 100}%`, minHeight: trips > 0 ? 4 : 1 }}
                      title={`${String(hour).padStart(2, "0")}:00 — ${trips} trips`}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between text-xs text-slate-500 mt-2">
                <span>00:00</span>
                <span>12:00</span>
                <span>23:00</span>
              </div>
              {busiest ? (
                <p className="text-slate-400 text-sm mt-3">
                  Busiest hour:{" "}
                  <span className="text-slate-200 font-medium">
                    {String(busiest.hour_of_day).padStart(2, "0")}:00
                  </span>{" "}
                  ({busiest.trips} trips)
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-slate-500 text-sm">No hourly data yet.</p>
          )}
        </Card>
      </div>

      {/* Growth */}
      <Card>
        <h3 className="text-slate-200 font-semibold mb-4">Trips per day</h3>
        {data.daily?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-left border-b border-slate-700">
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">Area</th>
                  <th className="pb-2 font-medium text-right">Trips</th>
                  <th className="pb-2 font-medium text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.daily.slice(0, 20).map((row, i) => (
                  <tr key={`${row.day}-${row.area}-${i}`} className="border-b border-slate-800">
                    <td className="py-2 text-slate-300">{row.day}</td>
                    <td className="py-2 text-slate-400">{row.area ?? "Unknown"}</td>
                    <td className="py-2 text-right text-slate-300">{row.trips}</td>
                    <td className="py-2 text-right text-slate-300">
                      {currency.format(row.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-slate-500 text-sm">No daily data yet.</p>
        )}
      </Card>

      {/* ETA baseline — the readiness gate for the Vertex AI model */}
      <Card>
        <h3 className="text-slate-200 font-semibold mb-2">ETA accuracy (Maps baseline)</h3>
        <p className="text-slate-500 text-sm mb-4">
          How far the Google Maps ETA sits from the observed trip duration. This is the
          baseline any predictive model has to beat.
        </p>
        {data.eta && data.eta.sample_size > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wider">Sample size</p>
              <p className="text-2xl font-bold text-slate-100 mt-1">{data.eta.sample_size}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wider">Mean abs. error</p>
              <p className="text-2xl font-bold text-slate-100 mt-1">
                {data.eta.mean_absolute_error_minutes.toFixed(1)} min
              </p>
            </div>
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wider">Bias</p>
              <p className="text-2xl font-bold text-slate-100 mt-1">
                {data.eta.mean_error_minutes > 0 ? "+" : ""}
                {data.eta.mean_error_minutes.toFixed(1)} min
              </p>
            </div>
          </div>
        ) : (
          <p className="text-slate-500 text-sm">
            No trips yet with both a prediction and an outcome.
          </p>
        )}
        <p className="text-slate-500 text-xs mt-4">
          {(data.eta?.sample_size ?? 0) >= ETA_TRAINING_THRESHOLD
            ? `${data.eta?.sample_size} trips available — above the ${ETA_TRAINING_THRESHOLD}-trip threshold for training the Vertex AI ETA model.`
            : `${data.eta?.sample_size ?? 0} of ${ETA_TRAINING_THRESHOLD} trips needed before the Vertex AI ETA model is trained. Below this the model would be fitting noise.`}
        </p>
      </Card>
    </div>
  );
}
