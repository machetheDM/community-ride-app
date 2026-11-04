/**
 * Read side — analytical queries for the admin dashboard.
 *
 * Kept apart from the write path because the failure modes differ. A dropped event
 * is invisible and must never break a ride; a failed query is user-facing and the
 * page needs to say "analytics unavailable" rather than render zeros, which would
 * be indistinguishable from a genuinely quiet week.
 *
 * BigQuery's free tier is 1 TiB of query processing per month. Every query here is
 * date-bounded and selects named columns so it scans a partition rather than the
 * table — `SELECT *` on a growing events table is how that tier gets consumed.
 */

export interface QueryOptions {
  /** Bounds the scan. Required — an unbounded query is a cost incident. */
  sinceDays: number;
  maxRows?: number;
}

type BigQueryJobClient = {
  query: (opts: {
    query: string;
    params?: Record<string, unknown>;
    maximumBytesBilled?: string;
    location?: string;
  }) => Promise<[Record<string, unknown>[]]>;
};

let queryClientPromise: Promise<BigQueryJobClient | null> | null = null;

export function isQueryable(): boolean {
  return Boolean(process.env.BIGQUERY_DATASET && process.env.GOOGLE_CLOUD_PROJECT);
}

async function getQueryClient(): Promise<BigQueryJobClient | null> {
  if (queryClientPromise) return queryClientPromise;

  queryClientPromise = (async () => {
    if (!isQueryable()) return null;
    try {
      const { BigQuery } = await import("@google-cloud/bigquery");
      return new BigQuery({
        projectId: process.env.GOOGLE_CLOUD_PROJECT,
      }) as unknown as BigQueryJobClient;
    } catch {
      return null;
    }
  })();

  return queryClientPromise;
}

/**
 * Hard ceiling on a single query's billed bytes.
 *
 * BigQuery rejects the job outright rather than running it, so a malformed or
 * accidentally unbounded query fails loudly and cheaply instead of quietly
 * consuming the monthly free tier. 1 GiB is far above anything this dataset needs
 * and far below anything that would cost money.
 */
const MAX_BYTES_BILLED = String(1024 * 1024 * 1024);

/**
 * Runs a parameterised query.
 *
 * Returns `null` when analytics is not configured, so callers can distinguish
 * "unavailable" from "no rows" — a distinction the dashboard depends on to avoid
 * presenting an unconfigured system as an empty one.
 */
export async function runQuery<T = Record<string, unknown>>(
  sql: string,
  params: Record<string, unknown> = {}
): Promise<T[] | null> {
  const client = await getQueryClient();
  if (!client) return null;

  const [rows] = await client.query({
    query: sql,
    params,
    maximumBytesBilled: MAX_BYTES_BILLED,
    location: process.env.BIGQUERY_LOCATION ?? "africa-south1",
  });

  return rows as T[];
}

/** Fully-qualified table reference for use in SQL. */
export function tableRef(table: "trips" | "orders"): string {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const dataset = process.env.BIGQUERY_DATASET;
  return `\`${project}.${dataset}.${table}\``;
}

// ─── Dashboard queries ────────────────────────────────────────

export interface TripsPerDayRow {
  day: string;
  area: string | null;
  trips: number;
  revenue: number;
}

export async function tripsPerDay(opts: QueryOptions): Promise<TripsPerDayRow[] | null> {
  if (!isQueryable()) return null;
  return runQuery<TripsPerDayRow>(
    `SELECT
       FORMAT_DATE('%Y-%m-%d', DATE(occurred_at)) AS day,
       pickup_area AS area,
       COUNT(*) AS trips,
       IFNULL(SUM(fare_actual), 0) AS revenue
     FROM ${tableRef("trips")}
     WHERE occurred_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @sinceDays DAY)
       AND status = 'COMPLETED'
     GROUP BY day, area
     ORDER BY day DESC
     LIMIT @maxRows`,
    { sinceDays: opts.sinceDays, maxRows: opts.maxRows ?? 500 }
  );
}

export interface AreaDemandRow {
  area: string | null;
  trips: number;
  avg_fare: number;
  avg_distance_km: number;
}

export async function demandByArea(opts: QueryOptions): Promise<AreaDemandRow[] | null> {
  if (!isQueryable()) return null;
  return runQuery<AreaDemandRow>(
    `SELECT
       pickup_area AS area,
       COUNT(*) AS trips,
       IFNULL(AVG(fare_actual), 0) AS avg_fare,
       IFNULL(AVG(distance_km), 0) AS avg_distance_km
     FROM ${tableRef("trips")}
     WHERE occurred_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @sinceDays DAY)
       AND status = 'COMPLETED'
     GROUP BY area
     ORDER BY trips DESC
     LIMIT @maxRows`,
    { sinceDays: opts.sinceDays, maxRows: opts.maxRows ?? 50 }
  );
}

export interface PeakHourRow {
  hour_of_day: number;
  trips: number;
}

export async function peakHours(opts: QueryOptions): Promise<PeakHourRow[] | null> {
  if (!isQueryable()) return null;
  return runQuery<PeakHourRow>(
    `SELECT
       EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'Africa/Johannesburg') AS hour_of_day,
       COUNT(*) AS trips
     FROM ${tableRef("trips")}
     WHERE occurred_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @sinceDays DAY)
       AND status = 'COMPLETED'
     GROUP BY hour_of_day
     ORDER BY hour_of_day`,
    { sinceDays: opts.sinceDays }
  );
}

export interface SummaryRow {
  total_trips: number;
  completed_trips: number;
  cancelled_trips: number;
  total_revenue: number;
  avg_fare: number;
  driver_earnings: number;
}

export async function summary(opts: QueryOptions): Promise<SummaryRow | null> {
  if (!isQueryable()) return null;
  const rows = await runQuery<SummaryRow>(
    `SELECT
       COUNT(*) AS total_trips,
       COUNTIF(status = 'COMPLETED') AS completed_trips,
       COUNTIF(status = 'CANCELLED') AS cancelled_trips,
       IFNULL(SUM(IF(status = 'COMPLETED', fare_actual, 0)), 0) AS total_revenue,
       IFNULL(AVG(IF(status = 'COMPLETED', fare_actual, NULL)), 0) AS avg_fare,
       IFNULL(SUM(IF(status = 'COMPLETED', driver_earnings, 0)), 0) AS driver_earnings
     FROM ${tableRef("trips")}
     WHERE occurred_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @sinceDays DAY)`,
    { sinceDays: opts.sinceDays }
  );
  return rows?.[0] ?? null;
}

/**
 * Accuracy of the Maps ETA against reality.
 *
 * This is the baseline the Vertex AI ETA model has to beat, and the query that
 * says whether training is worth attempting yet — `sample_size` is the count of
 * trips with both a prediction and an outcome.
 */
export interface EtaAccuracyRow {
  sample_size: number;
  mean_absolute_error_minutes: number;
  mean_error_minutes: number;
}

export async function etaAccuracy(opts: QueryOptions): Promise<EtaAccuracyRow | null> {
  if (!isQueryable()) return null;
  const rows = await runQuery<EtaAccuracyRow>(
    `SELECT
       COUNT(*) AS sample_size,
       IFNULL(AVG(ABS(actual_duration_minutes - estimated_duration_minutes)), 0)
         AS mean_absolute_error_minutes,
       IFNULL(AVG(actual_duration_minutes - estimated_duration_minutes), 0)
         AS mean_error_minutes
     FROM ${tableRef("trips")}
     WHERE occurred_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @sinceDays DAY)
       AND status = 'COMPLETED'
       AND actual_duration_minutes IS NOT NULL
       AND estimated_duration_minutes IS NOT NULL`,
    { sinceDays: opts.sinceDays }
  );
  return rows?.[0] ?? null;
}

/** Test-only hook. */
export function __resetQueryClient(): void {
  queryClientPromise = null;
}
