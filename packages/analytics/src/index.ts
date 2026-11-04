import { createHash, randomUUID } from "node:crypto";
import type { TripEvent, OrderEvent, AnalyticsTable } from "./events";

export type { TripEvent, OrderEvent, AnalyticsTable };

export {
  runQuery,
  isQueryable,
  tableRef,
  summary,
  demandByArea,
  peakHours,
  tripsPerDay,
  etaAccuracy,
  __resetQueryClient,
} from "./query";

export type {
  QueryOptions,
  SummaryRow,
  AreaDemandRow,
  PeakHourRow,
  TripsPerDayRow,
  EtaAccuracyRow,
} from "./query";

/**
 * @ride/analytics — trip and order events streamed to BigQuery.
 *
 * SERVER ONLY.
 *
 * Two rules govern everything here:
 *
 * 1. **Analytics never breaks the business operation.** A ride completing is the
 *    thing that matters; recording it for later analysis is not. Every write is
 *    fire-and-forget with errors caught and logged, so a BigQuery outage, an
 *    expired credential or a schema drift cannot fail a trip.
 *
 * 2. **Unconfigured is a valid state, not an error.** With `BIGQUERY_DATASET`
 *    unset every function no-ops silently. CI, local development and any
 *    deployment without GCP credentials all work untouched.
 */

export interface AnalyticsLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
}

const consoleLogger: AnalyticsLogger = {
  info: (m, meta) => console.log(m, meta ?? ""),
  warn: (m, meta) => console.warn(m, meta ?? ""),
};

export interface AnalyticsOptions {
  logger?: AnalyticsLogger;
}

/** True when the environment is configured to stream. */
export function isAnalyticsEnabled(): boolean {
  return Boolean(process.env.BIGQUERY_DATASET && process.env.GOOGLE_CLOUD_PROJECT);
}

/**
 * Pseudonymises an identifier before it leaves the operational database.
 *
 * BigQuery is a separate analytical store with a different access model, and none
 * of the questions it answers — trips per township, peak hours, cancellation
 * trends — need to identify a person. A keyed hash preserves the ability to count
 * distinct customers and repeat riders while making the rows useless for looking
 * someone up.
 *
 * Keyed with `ANALYTICS_HASH_SALT`. Without a salt, hashing a cuid is reversible by
 * anyone who can enumerate ids from the primary database, so an unset salt disables
 * the field rather than emitting a false assurance of anonymity.
 */
export function pseudonymise(id: string | null | undefined): string | null {
  if (!id) return null;
  const salt = process.env.ANALYTICS_HASH_SALT;
  if (!salt) return null;
  return createHash("sha256").update(`${salt}:${id}`).digest("hex").slice(0, 32);
}

/**
 * Reduces an address to a coarse area label.
 *
 * Takes the suburb/township component rather than the street. "12 Vilakazi St,
 * Orlando West, Soweto" becomes "Orlando West" — enough to answer "which townships
 * are growing", not enough to locate a household.
 */
export function areaOf(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  // Second component is the suburb in the format Google returns for ZA addresses;
  // a single-component address has no street to strip.
  return (parts.length > 1 ? parts[1] : parts[0]).slice(0, 100);
}

export function newEventId(): string {
  return randomUUID();
}

// ─── Client ───────────────────────────────────────────────────

type BigQueryTable = {
  insert: (rows: unknown[], options?: { raw?: boolean }) => Promise<unknown>;
};
type BigQueryDataset = { table: (id: string) => BigQueryTable };
type BigQueryClient = { dataset: (id: string) => BigQueryDataset };

let clientPromise: Promise<BigQueryClient | null> | null = null;

/**
 * Loads the BigQuery client lazily and at most once.
 *
 * Dynamic import so `@google-cloud/bigquery` never enters the bundle of a
 * deployment that does not stream analytics, and so a missing or broken credential
 * cannot prevent the app from starting.
 *
 * Authentication is Application Default Credentials — on Cloud Run that is the
 * attached service account, with no key file anywhere. See docs/gcp-architecture.md.
 */
async function getClient(log: AnalyticsLogger): Promise<BigQueryClient | null> {
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    if (!isAnalyticsEnabled()) {
      log.info("[analytics] BIGQUERY_DATASET not set — analytics disabled");
      return null;
    }
    try {
      const { BigQuery } = await import("@google-cloud/bigquery");
      return new BigQuery({
        projectId: process.env.GOOGLE_CLOUD_PROJECT,
      }) as unknown as BigQueryClient;
    } catch (error) {
      log.warn("[analytics] BigQuery client failed to initialise — analytics disabled", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  })();

  return clientPromise;
}

/**
 * Streams rows into a table.
 *
 * Resolves `false` on any failure rather than rejecting — callers are on the tail
 * of a completed ride or order and have nothing useful to do with an exception.
 */
/**
 * Ceiling on a single write, credential discovery included.
 *
 * Application Default Credentials resolve instantly on Cloud Run from the metadata
 * server, but on a machine without them the lookup retries against an unreachable
 * endpoint and the call hangs for a long time rather than failing. Since these
 * writes are fired and not awaited, hangs would accumulate silently instead of
 * surfacing. A bound makes the failure deterministic and observable.
 */
const DEFAULT_INSERT_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms).unref?.()
    ),
  ]);
}

async function insert(
  table: AnalyticsTable,
  rows: unknown[],
  options: AnalyticsOptions = {}
): Promise<boolean> {
  const log = options.logger ?? consoleLogger;
  if (!rows.length) return true;

  const timeoutMs = Number(process.env.BIGQUERY_TIMEOUT_MS) || DEFAULT_INSERT_TIMEOUT_MS;

  try {
    const client = await withTimeout(getClient(log), timeoutMs, "BigQuery client init");
    if (!client) return false;

    await withTimeout(
      client.dataset(process.env.BIGQUERY_DATASET as string).table(table).insert(rows),
      timeoutMs,
      "BigQuery insert"
    );
    return true;
  } catch (error) {
    // BigQuery reports per-row rejections in a nested `errors` array that does not
    // survive String(error); surfacing it is the difference between a debuggable
    // schema mismatch and a mystery.
    const detail = (error as { errors?: unknown[] })?.errors;
    log.warn("[analytics] insert failed — event dropped", {
      table,
      rowCount: rows.length,
      error: error instanceof Error ? error.message : String(error),
      ...(detail ? { detail: JSON.stringify(detail).slice(0, 500) } : {}),
    });
    return false;
  }
}

// ─── Public API ───────────────────────────────────────────────

/** Records a completed or cancelled trip. Never throws. */
export function recordTrip(event: TripEvent, options?: AnalyticsOptions): Promise<boolean> {
  return insert("trips", [event], options);
}

/** Records a delivered or cancelled order. Never throws. */
export function recordOrder(event: OrderEvent, options?: AnalyticsOptions): Promise<boolean> {
  return insert("orders", [event], options);
}

/** Test-only hook: drops the memoised client. */
export function __resetAnalyticsClient(): void {
  clientPromise = null;
}
