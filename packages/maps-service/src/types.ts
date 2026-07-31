import type { LatLng, Address } from "@ride/types";

export type { LatLng, Address };

/**
 * Per-call configuration.
 *
 * The key is passed in rather than read from `process.env` inside this package,
 * so the package stays testable without environment setup and so there is exactly
 * one place (the API's `lib/maps.ts`) that knows where the key comes from.
 */
export interface MapsConfig {
  apiKey: string;
  /** Biases geocoding and autocomplete results. Defaults to "ZA". */
  regionCode?: string;
  /** Defaults to "en". */
  languageCode?: string;
  /** Overridable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Milliseconds before an upstream call is aborted. Defaults to 5000. */
  timeoutMs?: number;
}

export interface RouteResult {
  distanceKm: number;
  durationMinutes: number;
  /** Encoded polyline, for rendering the route on the map. */
  polyline: string | null;
}

export interface EtaResult {
  distanceKm: number;
  durationMinutes: number;
}

/** One cell of a route matrix, indexed back to the input arrays. */
export interface EtaMatrixCell extends EtaResult {
  originIndex: number;
  destinationIndex: number;
  /** False when Google could not route between this pair. */
  routable: boolean;
}

export interface AutocompleteSuggestion {
  placeId: string;
  /** Full suggestion text, e.g. "Vilakazi St, Orlando West, Soweto". */
  text: string;
  /** Leading portion, e.g. "Vilakazi St". */
  mainText: string;
  /** Trailing portion, e.g. "Orlando West, Soweto". */
  secondaryText: string;
}

export interface AutocompleteOptions {
  /**
   * Groups the keystroke requests and the final place resolution into one
   * billable session. Autocomplete *Session* usage is free at unlimited volume;
   * Per Request usage is billed past 10k/month. Always pass this.
   */
  sessionToken: string;
  /** Biases results toward the rider's current area. */
  bias?: { center: LatLng; radiusMeters: number };
}
