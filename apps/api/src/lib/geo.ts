/**
 * Plain geometry with no imports, so the views and the analytics emitter can use
 * it without loading the database client that `arrival.ts` needs.
 */

/** Great-circle distance in km. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A suburb-level label for an address: the first part after the street that has
 * no digits in it.
 *
 * `areaOf` in `@ride/analytics` takes the second comma-separated part, which is
 * right for Google's "12 Vilakazi St, Orlando West, Soweto" but returns the
 * street itself for "Unit 4, 12 Vilakazi St, Orlando West" and the whole address
 * when there is no comma. This label goes to drivers who have not accepted the
 * ride, onto lock screens through Expo, and into BigQuery, so it must fail
 * towards saying less.
 */
export function coarseArea(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const area = parts.slice(1).find((p) => !/\d/.test(p));
  return area ? area.slice(0, 100) : null;
}

/**
 * A coordinate rounded to two decimal places: about 1.1 km of latitude, and a
 * little less of longitude at South African latitudes. Coarse enough that a
 * pickup at someone's front door becomes a neighbourhood, fine enough for demand
 * maps and the ETA model's area features. Zero and missing both become null:
 * 0,0 was the old "no coordinates" placeholder, not a place anyone was picked up.
 */
export function roundCoordinate(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return null;
  return Math.round(value * 100) / 100;
}
