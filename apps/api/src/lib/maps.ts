import type { MapsConfig, Address, LatLng } from "@ride/maps-service";
import { geocodeAddress, MapsError, NoResultError, QuotaError } from "@ride/maps-service";
import { AppError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * The single place that knows where the Maps key comes from.
 *
 * `GOOGLE_MAPS_SERVER_KEY` is a *different* key from the one in the mobile apps:
 *   - App key   → Maps SDK render only, restricted by bundle ID / package name.
 *                 Its SKU is free at unlimited volume, so an extracted copy costs
 *                 nothing.
 *   - Server key → Geocoding, Routes and Places. Restricted by the API's egress IP
 *                 and by API. These SKUs bill per request, so this key must never
 *                 reach a client bundle. It is read here, server-side only, and is
 *                 deliberately not prefixed NEXT_PUBLIC_.
 */

export class MapsNotConfiguredError extends MapsError {
  constructor() {
    super("Maps is not configured on this server", 503);
    this.name = "MapsNotConfiguredError";
  }
}

/**
 * Resolved per call rather than at module load.
 *
 * Reading it at import would make the whole API fail to boot when the key is
 * absent — which is wrong, because rides, orders and auth all work fine without
 * Maps. Only the `/api/maps/*` routes should degrade.
 */
export function getMapsConfig(): MapsConfig {
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;

  if (!apiKey) throw new MapsNotConfiguredError();

  return {
    apiKey,
    regionCode: process.env.GOOGLE_MAPS_REGION ?? "ZA",
    languageCode: "en",
    timeoutMs: 5000,
  };
}

/** True when the server can serve Maps requests at all. */
export function isMapsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_SERVER_KEY);
}

// ─── Geocode cache ────────────────────────────────────────────

interface CacheEntry {
  value: Address;
  expiresAt: number;
}

/**
 * TTL cache over geocoding results.
 *
 * This is a cost control, not a latency optimisation. Geocoding is 10,000 free
 * calls a month and $5 per 1,000 after that, and a hyperlocal service geocodes the
 * same handful of township pickup points over and over — the same taxi rank, the
 * same shopping complex entrance. Caching those collapses a large share of billable
 * calls into one.
 *
 * Process-local and therefore per-instance, exactly like the rate limiter in
 * `rate-limit.ts`. Behind multiple Cloud Run instances each keeps its own copy, so
 * the hit rate drops but correctness does not change. A shared cache (Memorystore)
 * would be the next step if instance count ever grows.
 */
const geocodeCache = new Map<string, CacheEntry>();

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // Addresses do not move.
const MAX_CACHE_ENTRIES = 5_000;

function cacheKey(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}

function sweep(now: number): void {
  for (const [key, entry] of geocodeCache) {
    if (entry.expiresAt <= now) geocodeCache.delete(key);
  }
}

/**
 * Geocodes an address, serving repeats from cache.
 *
 * `geocoder` is injectable so the cache can be tested without reaching Google —
 * the same seam `@ride/maps-service` provides through `MapsConfig.fetchImpl`.
 * Callers in production always use the default.
 */
export async function geocodeCached(
  address: string,
  geocoder: (config: MapsConfig, address: string) => Promise<Address> = geocodeAddress
): Promise<Address> {
  const key = cacheKey(address);
  const now = Date.now();

  const hit = geocodeCache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  // Config resolved before the call so a missing key fails fast, without a
  // cache write and without an outbound request.
  const config = getMapsConfig();
  const result = await geocoder(config, address);

  if (geocodeCache.size >= MAX_CACHE_ENTRIES) {
    sweep(now);
    // Still full after sweeping: drop the oldest insertion. Map preserves order.
    if (geocodeCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = geocodeCache.keys().next();
      if (!oldest.done) geocodeCache.delete(oldest.value);
    }
  }

  geocodeCache.set(key, { value: result, expiresAt: now + CACHE_TTL_MS });
  return result;
}

/** Test-only hook, mirroring `__resetRateLimitStore`. */
export function __resetGeocodeCache(): void {
  geocodeCache.clear();
}

/** Rough sanity bounds for South Africa, used to reject nonsense coordinates. */
export function isPlausibleZaCoordinate(point: LatLng): boolean {
  return (
    point.lat >= -35.5 && point.lat <= -21.5 && point.lng >= 15.5 && point.lng <= 33.5
  );
}

// ─── Error bridging ───────────────────────────────────────────

/**
 * Translates a `MapsError` into the API's `AppError` hierarchy.
 *
 * `withErrorHandler` only recognises `AppError`, so without this every upstream
 * Google failure — including an ordinary "no such address" — would surface as an
 * opaque 500. `@ride/maps-service` deliberately does not import the API's error
 * classes (it has no business depending on the app that consumes it), so the
 * translation happens here instead.
 *
 * Quota exhaustion is logged at error level: it is the one failure mode that costs
 * money and needs a human, rather than a bad address the customer can just retype.
 */
export function toAppError(error: unknown): unknown {
  if (error instanceof MapsNotConfiguredError) {
    logger.error("Maps request attempted but GOOGLE_MAPS_SERVER_KEY is not set");
    return new AppError("Maps is unavailable on this server", 503, "MAPS_NOT_CONFIGURED");
  }
  if (error instanceof QuotaError) {
    logger.error("Google Maps quota exceeded or key rejected", {
      upstreamStatus: error.upstreamStatus,
    });
    return new AppError("Maps is temporarily unavailable", 503, "MAPS_QUOTA");
  }
  if (error instanceof NoResultError) {
    return new NotFoundError("Address");
  }
  if (error instanceof MapsError) {
    logger.warn("Google Maps request failed", {
      message: error.message,
      upstreamStatus: error.upstreamStatus,
    });
    return new AppError("Could not reach the maps service", 502, "MAPS_UPSTREAM");
  }
  return error;
}

/** Runs a maps call, rethrowing failures in the API's error vocabulary. */
export async function withMaps<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toAppError(error);
  }
}
