/**
 * @ride/maps-service — Google Maps Platform integration.
 *
 * This entry point is SERVER ONLY. Every function consumes billable quota and
 * requires the restricted server key, so importing it from an Expo app or a
 * browser bundle would ship that key inside the artifact.
 *
 *   - Server (Next.js API routes)  → import from "@ride/maps-service"
 *   - Expo apps                    → import from "@ride/maps-service/client"
 *   - Expo UI components           → import from "@ride/maps-service/native"
 */

export {
  geocodeAddress,
  reverseGeocode,
  getRoute,
  getETA,
  getEtaMatrix,
  placesAutocomplete,
  getPlaceCoordinates,
} from "./core";

export { decodePolyline, boundsOf } from "./polyline";

export { MapsError, NoResultError, QuotaError } from "./errors";

export type {
  MapsConfig,
  LatLng,
  Address,
  RouteResult,
  EtaResult,
  EtaMatrixCell,
  AutocompleteSuggestion,
  AutocompleteOptions,
} from "./types";
