/**
 * Stand-in for `@ride/maps-service` in the integration suite, wired in by
 * `moduleNameMapper` in `jest.integration.config.mjs` (a module mock that
 * silently fails to apply would reach Google; a mapped module cannot).
 *
 * Everything that would call Google refuses to; `getETA` answers a fixed
 * estimate and records that it was asked, so a test can prove that a code path
 * did or did not reach the billable call. The error classes are the real ones,
 * so `lib/maps.ts` translates failures exactly as it does in production.
 */

import type { EtaResult, LatLng, MapsConfig } from "../../../../../../packages/maps-service/src/types";

export { MapsError, NoResultError, QuotaError } from "../../../../../../packages/maps-service/src/errors";
export { decodePolyline, boundsOf } from "../../../../../../packages/maps-service/src/polyline";
export type {
  MapsConfig,
  LatLng,
  Address,
  RouteResult,
  EtaResult,
  EtaMatrixCell,
  AutocompleteSuggestion,
  AutocompleteOptions,
} from "../../../../../../packages/maps-service/src/types";

export const etaCalls: { origin: LatLng; destination: LatLng }[] = [];

export async function getETA(_config: MapsConfig, origin: LatLng, destination: LatLng): Promise<EtaResult> {
  etaCalls.push({ origin, destination });
  return { distanceKm: 9.4, durationMinutes: 18 };
}

function offline(): never {
  throw new Error("The integration suite does not call Google Maps");
}

export const geocodeAddress = offline;
export const reverseGeocode = offline;
export const getRoute = offline;
export const getEtaMatrix = offline;
export const placesAutocomplete = offline;
export const getPlaceCoordinates = offline;
