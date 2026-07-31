import type {
  MapsConfig,
  LatLng,
  Address,
  RouteResult,
  EtaResult,
  EtaMatrixCell,
  AutocompleteSuggestion,
  AutocompleteOptions,
} from "./types";
import { MapsError, NoResultError, QuotaError } from "./errors";

/**
 * Google Maps Platform client — server side only.
 *
 * Every function here consumes billable quota, so nothing in this file may run in
 * a mobile or browser bundle: the key would ship inside the artifact. The Expo
 * apps reach these capabilities through the API's `/api/maps/*` proxy instead,
 * which is authenticated, rate limited and cached. See `./client`.
 *
 * Uses the Routes API and Places API (New) rather than the Directions, Distance
 * Matrix and Places Autocomplete web services. The older three moved to Legacy
 * status in the March 2025 pricing change; they still work for existing projects
 * but are not the surface to build new integrations on. Free tiers and per-call
 * prices are identical.
 */

const ROUTES_HOST = "https://routes.googleapis.com";
const PLACES_HOST = "https://places.googleapis.com";
const GEOCODE_HOST = "https://maps.googleapis.com";

const DEFAULT_TIMEOUT_MS = 5000;

function cfg(config: MapsConfig) {
  return {
    apiKey: config.apiKey,
    regionCode: config.regionCode ?? "ZA",
    languageCode: config.languageCode ?? "en",
    doFetch: config.fetchImpl ?? fetch,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

/**
 * Issues the upstream request with a hard timeout.
 *
 * A hung Google call must not hold a ride-booking request open indefinitely — the
 * caller gets a MapsError and can fall back, which is far better than a customer
 * watching a spinner while the socket waits.
 */
async function request(
  doFetch: typeof fetch,
  timeoutMs: number,
  url: string,
  init: RequestInit
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await doFetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new MapsError(`Maps request timed out after ${timeoutMs}ms`, 504);
    }
    throw new MapsError("Maps request failed", 502);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 403 || res.status === 429) {
    throw new QuotaError(undefined, res.status);
  }
  if (!res.ok) {
    throw new MapsError(`Maps request failed with status ${res.status}`, 502, res.status);
  }

  try {
    return await res.json();
  } catch {
    throw new MapsError("Maps returned a malformed response", 502);
  }
}

/** Google returns durations as a protobuf duration string, e.g. "165s". */
function parseDurationSeconds(duration: unknown): number {
  if (typeof duration !== "string") return 0;
  const match = /^([\d.]+)s$/.exec(duration);
  return match ? Number(match[1]) : 0;
}

function toMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

function toKm(meters: number): number {
  return Math.round((meters / 1000) * 100) / 100;
}

// ─── Geocoding ────────────────────────────────────────────────

/**
 * Address string → coordinates.
 *
 * Essentials SKU: 10,000 free calls/month, then $5 per 1,000. The API layer caches
 * results, which matters here because township addresses repeat heavily — the same
 * few pickup points appear across many rides.
 */
export async function geocodeAddress(config: MapsConfig, address: string): Promise<Address> {
  const c = cfg(config);
  const trimmed = address.trim();
  if (!trimmed) throw new MapsError("Address is required", 400);

  const url =
    `${GEOCODE_HOST}/maps/api/geocode/json` +
    `?address=${encodeURIComponent(trimmed)}` +
    `&region=${encodeURIComponent(c.regionCode)}` +
    `&language=${encodeURIComponent(c.languageCode)}` +
    `&key=${encodeURIComponent(c.apiKey)}`;

  const body = (await request(c.doFetch, c.timeoutMs, url, { method: "GET" })) as {
    status?: string;
    results?: Array<{
      formatted_address?: string;
      geometry?: { location?: { lat?: number; lng?: number } };
    }>;
  };

  if (body.status === "OVER_QUERY_LIMIT" || body.status === "REQUEST_DENIED") {
    throw new QuotaError(`Geocoding rejected: ${body.status}`);
  }
  if (body.status === "ZERO_RESULTS" || !body.results?.length) {
    throw new NoResultError(`No match for address: ${trimmed}`);
  }

  const first = body.results[0];
  const loc = first.geometry?.location;
  if (typeof loc?.lat !== "number" || typeof loc?.lng !== "number") {
    throw new MapsError("Geocoding returned a result without coordinates", 502);
  }

  return { lat: loc.lat, lng: loc.lng, formatted: first.formatted_address ?? trimmed };
}

/** Coordinates → address string. Used to label a driver's current position. */
export async function reverseGeocode(config: MapsConfig, point: LatLng): Promise<Address> {
  const c = cfg(config);

  const url =
    `${GEOCODE_HOST}/maps/api/geocode/json` +
    `?latlng=${point.lat},${point.lng}` +
    `&language=${encodeURIComponent(c.languageCode)}` +
    `&key=${encodeURIComponent(c.apiKey)}`;

  const body = (await request(c.doFetch, c.timeoutMs, url, { method: "GET" })) as {
    status?: string;
    results?: Array<{ formatted_address?: string }>;
  };

  if (body.status === "OVER_QUERY_LIMIT" || body.status === "REQUEST_DENIED") {
    throw new QuotaError(`Reverse geocoding rejected: ${body.status}`);
  }
  if (!body.results?.length) {
    throw new NoResultError("No address for those coordinates");
  }

  return {
    lat: point.lat,
    lng: point.lng,
    formatted: body.results[0].formatted_address ?? `${point.lat}, ${point.lng}`,
  };
}

// ─── Routes ───────────────────────────────────────────────────

/**
 * Full route between two points, including the polyline for map rendering.
 *
 * `TRAFFIC_AWARE` rather than `TRAFFIC_UNAWARE` because the duration feeds both the
 * fare and the ETA shown to the customer, and Gauteng peak traffic moves it a lot.
 */
export async function getRoute(
  config: MapsConfig,
  origin: LatLng,
  destination: LatLng
): Promise<RouteResult> {
  const c = cfg(config);

  const body = (await request(
    c.doFetch,
    c.timeoutMs,
    `${ROUTES_HOST}/directions/v2:computeRoutes`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": c.apiKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: {
          location: { latLng: { latitude: destination.lat, longitude: destination.lng } },
        },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        regionCode: c.regionCode,
        languageCode: c.languageCode,
      }),
    }
  )) as {
    routes?: Array<{
      distanceMeters?: number;
      duration?: string;
      polyline?: { encodedPolyline?: string };
    }>;
  };

  const route = body.routes?.[0];
  if (!route) throw new NoResultError("No route between those points");

  return {
    distanceKm: toKm(route.distanceMeters ?? 0),
    durationMinutes: toMinutes(parseDurationSeconds(route.duration)),
    polyline: route.polyline?.encodedPolyline ?? null,
  };
}

/**
 * Many-to-many travel times.
 *
 * This is the driver-matching primitive: one pickup point against every online
 * driver in a single billable call, rather than N separate route lookups. Google
 * bills per origin-destination *pair*, so keep the driver list bounded upstream.
 */
export async function getEtaMatrix(
  config: MapsConfig,
  origins: LatLng[],
  destinations: LatLng[]
): Promise<EtaMatrixCell[]> {
  const c = cfg(config);
  if (!origins.length || !destinations.length) return [];

  const body = (await request(
    c.doFetch,
    c.timeoutMs,
    `${ROUTES_HOST}/distanceMatrix/v2:computeRouteMatrix`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": c.apiKey,
        "X-Goog-FieldMask":
          "originIndex,destinationIndex,duration,distanceMeters,condition",
      },
      body: JSON.stringify({
        origins: origins.map((o) => ({
          waypoint: { location: { latLng: { latitude: o.lat, longitude: o.lng } } },
        })),
        destinations: destinations.map((d) => ({
          waypoint: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
        })),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
      }),
    }
  )) as Array<{
    originIndex?: number;
    destinationIndex?: number;
    distanceMeters?: number;
    duration?: string;
    condition?: string;
  }>;

  if (!Array.isArray(body)) {
    throw new MapsError("Route matrix returned an unexpected shape", 502);
  }

  return body.map((cell) => ({
    originIndex: cell.originIndex ?? 0,
    destinationIndex: cell.destinationIndex ?? 0,
    distanceKm: toKm(cell.distanceMeters ?? 0),
    durationMinutes: toMinutes(parseDurationSeconds(cell.duration)),
    // Google omits `condition` on success in some responses; only an explicit
    // ROUTE_NOT_FOUND means the pair is genuinely unroutable.
    routable: cell.condition !== "ROUTE_NOT_FOUND",
  }));
}

/** Convenience single-pair ETA, on the same matrix endpoint. */
export async function getETA(
  config: MapsConfig,
  origin: LatLng,
  destination: LatLng
): Promise<EtaResult> {
  const cells = await getEtaMatrix(config, [origin], [destination]);
  const cell = cells.find((x) => x.routable);
  if (!cell) throw new NoResultError("No route between those points");
  return { distanceKm: cell.distanceKm, durationMinutes: cell.durationMinutes };
}

// ─── Places ───────────────────────────────────────────────────

/**
 * Address autocomplete.
 *
 * The `sessionToken` is not optional in practice: with it, usage bills against the
 * Autocomplete Session SKU, which is free at unlimited volume. Without it, every
 * keystroke bills against Per Request — 10,000 free, then $2.83 per 1,000. Same
 * feature, and the difference between R0 and a real invoice at scale.
 */
export async function placesAutocomplete(
  config: MapsConfig,
  input: string,
  options: AutocompleteOptions
): Promise<AutocompleteSuggestion[]> {
  const c = cfg(config);
  const trimmed = input.trim();
  if (!trimmed) return [];

  const payload: Record<string, unknown> = {
    input: trimmed,
    sessionToken: options.sessionToken,
    regionCode: c.regionCode,
    languageCode: c.languageCode,
    includedRegionCodes: [c.regionCode],
  };

  if (options.bias) {
    payload.locationBias = {
      circle: {
        center: { latitude: options.bias.center.lat, longitude: options.bias.center.lng },
        radius: options.bias.radiusMeters,
      },
    };
  }

  const body = (await request(
    c.doFetch,
    c.timeoutMs,
    `${PLACES_HOST}/v1/places:autocomplete`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": c.apiKey,
        "X-Goog-FieldMask":
          "suggestions.placePrediction.placeId," +
          "suggestions.placePrediction.text.text," +
          "suggestions.placePrediction.structuredFormat.mainText.text," +
          "suggestions.placePrediction.structuredFormat.secondaryText.text",
      },
      body: JSON.stringify(payload),
    }
  )) as {
    suggestions?: Array<{
      placePrediction?: {
        placeId?: string;
        text?: { text?: string };
        structuredFormat?: {
          mainText?: { text?: string };
          secondaryText?: { text?: string };
        };
      };
    }>;
  };

  // An empty response is a normal outcome for a partial query, not an error.
  return (body.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
    .map((p) => ({
      placeId: p.placeId as string,
      text: p.text?.text ?? "",
      mainText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
      secondaryText: p.structuredFormat?.secondaryText?.text ?? "",
    }));
}

/**
 * Resolves a suggestion chosen by the user into coordinates.
 *
 * Called with the same `sessionToken` the autocomplete keystrokes used — that is
 * what closes the billing session and keeps the whole interaction on the free SKU.
 */
export async function getPlaceCoordinates(
  config: MapsConfig,
  placeId: string,
  sessionToken: string
): Promise<Address> {
  const c = cfg(config);

  const body = (await request(
    c.doFetch,
    c.timeoutMs,
    `${PLACES_HOST}/v1/places/${encodeURIComponent(placeId)}` +
      `?sessionToken=${encodeURIComponent(sessionToken)}`,
    {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": c.apiKey,
        "X-Goog-FieldMask": "location,formattedAddress",
      },
    }
  )) as {
    location?: { latitude?: number; longitude?: number };
    formattedAddress?: string;
  };

  if (typeof body.location?.latitude !== "number" || typeof body.location?.longitude !== "number") {
    throw new NoResultError("Place has no coordinates");
  }

  return {
    lat: body.location.latitude,
    lng: body.location.longitude,
    formatted: body.formattedAddress ?? "",
  };
}
