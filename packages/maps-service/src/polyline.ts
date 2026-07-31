import type { LatLng } from "./types";

/**
 * Decodes Google's encoded polyline format into coordinates.
 *
 * The Routes API returns the route geometry as an encoded string, but
 * `react-native-maps`'s `<Polyline>` wants an array of points — so something has to
 * do this, and doing it here keeps it pure and unit-testable rather than buried in
 * a component.
 *
 * Algorithm per Google's Encoded Polyline Algorithm Format: values are stored as
 * successive deltas, each in chunks of 5 bits with the continuation bit set, and
 * signed values are zig-zag encoded in the low bit.
 */
export function decodePolyline(encoded: string): LatLng[] {
  if (!encoded) return [];

  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);

    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);

    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

/** Bounding box around a set of points, for fitting the map to a route. */
export function boundsOf(points: LatLng[]): {
  northEast: LatLng;
  southWest: LatLng;
} | null {
  if (!points.length) return null;

  let minLat = points[0].lat;
  let maxLat = points[0].lat;
  let minLng = points[0].lng;
  let maxLng = points[0].lng;

  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  return { northEast: { lat: maxLat, lng: maxLng }, southWest: { lat: minLat, lng: minLng } };
}
