import type {
  LatLng,
  Address,
  RouteResult,
  EtaResult,
  AutocompleteSuggestion,
} from "./types";

/**
 * Client for the API's `/api/maps/*` proxy routes.
 *
 * The Expo apps use this instead of talking to Google directly. That is a security
 * decision, not a stylistic one: a key shipped in an app binary can be extracted
 * from the APK, and Geocoding / Routes / Places all bill per request — an extracted
 * key is someone else's traffic on our billing account. Bundle-ID restriction does
 * not prevent this, because the restriction is asserted by the caller.
 *
 * The only key that ships in the apps is the Maps SDK render key, which is
 * bundle-restricted and whose SKU is free at unlimited volume.
 *
 * No React here — this file is imported by both Expo apps, which pin React 18.3.1
 * while the API is on React 19.
 */

export interface MapsClientOptions {
  /** Base URL of the API, e.g. http://10.0.2.2:3000 */
  baseUrl: string;
  /** JWT from AuthContext. The proxy routes require auth. */
  token: string | null;
  fetchImpl?: typeof fetch;
}

export class MapsClientError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "MapsClientError";
    this.status = status;
  }
}

async function call<T>(
  opts: MapsClientOptions,
  path: string,
  init: RequestInit & { signal?: AbortSignal }
): Promise<T> {
  const doFetch = opts.fetchImpl ?? fetch;

  const res = await doFetch(`${opts.baseUrl}/api/maps/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; data?: T; error?: string }
    | null;

  if (!res.ok || !json?.success) {
    throw new MapsClientError(json?.error ?? `Maps request failed (${res.status})`, res.status);
  }

  return json.data as T;
}

export function createMapsClient(opts: MapsClientOptions) {
  return {
    geocode(address: string, signal?: AbortSignal): Promise<Address> {
      return call<Address>(opts, "geocode", {
        method: "POST",
        body: JSON.stringify({ address }),
        signal,
      });
    },

    route(origin: LatLng, destination: LatLng, signal?: AbortSignal): Promise<RouteResult> {
      return call<RouteResult>(opts, "route", {
        method: "POST",
        body: JSON.stringify({ origin, destination }),
        signal,
      });
    },

    eta(origin: LatLng, destination: LatLng, signal?: AbortSignal): Promise<EtaResult> {
      return call<EtaResult>(opts, "eta", {
        method: "POST",
        body: JSON.stringify({ origin, destination }),
        signal,
      });
    },

    /**
     * `sessionToken` must be stable across the keystrokes of one address entry and
     * reused for the final `resolvePlace` call — that is what keeps autocomplete on
     * the free Session SKU. `newSessionToken()` below mints one per entry session.
     */
    autocomplete(
      input: string,
      sessionToken: string,
      bias?: { center: LatLng; radiusMeters: number },
      signal?: AbortSignal
    ): Promise<AutocompleteSuggestion[]> {
      return call<AutocompleteSuggestion[]>(opts, "autocomplete", {
        method: "POST",
        body: JSON.stringify({ input, sessionToken, bias }),
        signal,
      });
    },

    resolvePlace(placeId: string, sessionToken: string, signal?: AbortSignal): Promise<Address> {
      return call<Address>(opts, "autocomplete", {
        method: "PUT",
        body: JSON.stringify({ placeId, sessionToken }),
        signal,
      });
    },
  };
}

export type MapsClient = ReturnType<typeof createMapsClient>;

/**
 * Mints an autocomplete session token.
 *
 * Uses `crypto.randomUUID` where available and falls back to a random string —
 * React Native's Hermes runtime does not always expose the Web Crypto API. The
 * token is only a billing correlator, never a security credential, so the fallback
 * carries no risk.
 */
export function newSessionToken(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export type { LatLng, Address, RouteResult, EtaResult, AutocompleteSuggestion };
