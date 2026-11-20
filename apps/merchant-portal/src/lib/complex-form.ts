/**
 * Validation for the admin's "new shopping complex" form (docs/PLAN.md Phase 2.2).
 *
 * Pure, like access.ts, so the API's test suite checks it: the form posts to a
 * Server Action, which is a public endpoint whatever the page shows, so every
 * field is parsed here rather than trusted from the browser.
 */

export interface ComplexInput {
  name: string;
  slug: string;
  address: string;
  lat: number;
  lng: number;
  deliveryRadiusKm: number;
  deliveryFee: string;
}

export type ComplexFormResult = { ok: true; value: ComplexInput } | { ok: false; errors: Record<string, string> };

/**
 * South Africa's bounding box, roughly. A complex outside it is a typo (a sign
 * flipped on the latitude puts Soweto in the Indian Ocean north of the equator),
 * and a delivery zone drawn around a typo would refuse every order.
 */
const SA_BOUNDS = { minLat: -35, maxLat: -22, minLng: 16, maxLng: 33 };

/** "Demo Junction Mall" becomes "demo-junction-mall": lower case, letters and digits, single hyphens. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown): number | null {
  const raw = text(value);
  if (raw === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseComplexForm(input: Record<string, unknown>): ComplexFormResult {
  const errors: Record<string, string> = {};

  const name = text(input.name);
  if (name.length < 2 || name.length > 100) errors.name = "Give the complex a name of 2 to 100 characters";
  const slug = slugify(name);
  if (!errors.name && slug.length < 2) errors.name = "The name needs some letters or digits";

  const address = text(input.address);
  if (address.length < 5 || address.length > 200) errors.address = "Give the street address (5 to 200 characters)";

  const lat = number(input.lat);
  const lng = number(input.lng);
  if (lat === null || lat < SA_BOUNDS.minLat || lat > SA_BOUNDS.maxLat) {
    errors.lat = "Latitude must be in South Africa, between -35 and -22 (it is negative)";
  }
  if (lng === null || lng < SA_BOUNDS.minLng || lng > SA_BOUNDS.maxLng) {
    errors.lng = "Longitude must be in South Africa, between 16 and 33";
  }

  const radius = number(input.deliveryRadiusKm);
  if (radius === null || radius < 0.5 || radius > 30) errors.deliveryRadiusKm = "Delivery radius is 0.5 to 30 km";

  // Rands to the cent, as a string, so it reaches Postgres' decimal column without
  // passing through a float.
  const feeRaw = text(input.deliveryFee);
  const feeOk = /^\d{1,4}(\.\d{1,2})?$/.test(feeRaw) && Number(feeRaw) <= 500;
  if (!feeOk) errors.deliveryFee = "Delivery fee is in rands, 0 to 500, at most two decimals";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      slug,
      address,
      lat: lat as number,
      lng: lng as number,
      deliveryRadiusKm: radius as number,
      deliveryFee: feeRaw,
    },
  };
}
