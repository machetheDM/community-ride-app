import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { NoResultError, QuotaError, MapsError } from "@ride/maps-service";
import { AppError, NotFoundError } from "@/lib/errors";

/**
 * The cache is a cost control, so these tests are really about billing: a second
 * lookup for the same address must not reach Google, because that call is a
 * chargeable event past 10,000 a month.
 *
 * `@ride/maps-service` is mocked at the module boundary so the real HTTP client
 * never runs — `geocodeCached` is what is under test, not Google's response
 * parsing, which `maps-service.test.ts` covers.
 */

import { geocodeCached, __resetGeocodeCache, toAppError, isPlausibleZaCoordinate } from "@/lib/maps";
import type { Address } from "@ride/maps-service";

const SOWETO: Address = { lat: -26.2382, lng: 27.9089, formatted: "Vilakazi St, Soweto" };

/**
 * The fake geocoder is injected rather than module-mocked.
 *
 * An earlier version used `jest.mock("@ride/maps-service", …)`. Under next/jest the
 * factory did not intercept, the real client ran, and the test made a live request
 * to Google — passing "test-key" and failing on REQUEST_DENIED. Injection cannot
 * fail that way: if the seam is wrong the test errors immediately instead of
 * quietly reaching the internet.
 */
// Declared with no parameters: TypeScript accepts a function of lower arity where
// a wider signature is expected, and unused named parameters would trip the
// zero-warnings lint gate.
const makeGeocoder = () => jest.fn(async (): Promise<Address> => SOWETO);

describe("geocodeCached", () => {
  let geocoder: ReturnType<typeof makeGeocoder>;

  beforeEach(() => {
    __resetGeocodeCache();
    geocoder = makeGeocoder();
    process.env.GOOGLE_MAPS_SERVER_KEY = "test-key";
  });

  afterEach(() => {
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
  });

  it("calls Google once and serves the repeat from cache", async () => {
    const first = await geocodeCached("Vilakazi Street, Soweto", geocoder);
    const second = await geocodeCached("Vilakazi Street, Soweto", geocoder);

    expect(first).toEqual(SOWETO);
    expect(second).toEqual(SOWETO);
    expect(geocoder).toHaveBeenCalledTimes(1);
  });

  it("treats case and whitespace differences as the same address", async () => {
    await geocodeCached("Vilakazi Street, Soweto", geocoder);
    await geocodeCached("  vilakazi   STREET,   soweto  ", geocoder);

    expect(geocoder).toHaveBeenCalledTimes(1);
  });

  it("still calls Google for a genuinely different address", async () => {
    await geocodeCached("Vilakazi Street, Soweto", geocoder);
    await geocodeCached("Maponya Mall, Soweto", geocoder);

    expect(geocoder).toHaveBeenCalledTimes(2);
  });

  it("does not cache failures, so a transient error can be retried", async () => {
    geocoder.mockRejectedValueOnce(new NoResultError("nope") as never);

    await expect(geocodeCached("Somewhere", geocoder)).rejects.toBeInstanceOf(NoResultError);

    expect(await geocodeCached("Somewhere", geocoder)).toEqual(SOWETO);
    expect(geocoder).toHaveBeenCalledTimes(2);
  });

  it("fails when no server key is configured rather than calling Google anonymously", async () => {
    delete process.env.GOOGLE_MAPS_SERVER_KEY;

    await expect(geocodeCached("Soweto", geocoder)).rejects.toBeInstanceOf(MapsError);
    expect(geocoder).not.toHaveBeenCalled();
  });
});

describe("toAppError", () => {
  it("maps a no-result to a 404 rather than an opaque 500", () => {
    const mapped = toAppError(new NoResultError("no match"));
    expect(mapped).toBeInstanceOf(NotFoundError);
    expect((mapped as AppError).statusCode).toBe(404);
  });

  it("maps quota exhaustion to a 503 with a distinguishable code", () => {
    const mapped = toAppError(new QuotaError()) as AppError;
    expect(mapped.statusCode).toBe(503);
    expect(mapped.code).toBe("MAPS_QUOTA");
  });

  it("maps a generic upstream failure to a 502", () => {
    const mapped = toAppError(new MapsError("boom")) as AppError;
    expect(mapped.statusCode).toBe(502);
    expect(mapped.code).toBe("MAPS_UPSTREAM");
  });

  it("passes through errors it does not own", () => {
    const original = new Error("something else");
    expect(toAppError(original)).toBe(original);
  });
});

describe("isPlausibleZaCoordinate", () => {
  it("accepts Johannesburg and Polokwane", () => {
    expect(isPlausibleZaCoordinate({ lat: -26.2041, lng: 28.0473 })).toBe(true);
    expect(isPlausibleZaCoordinate({ lat: -23.9045, lng: 29.4689 })).toBe(true);
  });

  it("rejects the 0,0 default that used to be stored for every ride", () => {
    expect(isPlausibleZaCoordinate({ lat: 0, lng: 0 })).toBe(false);
  });
});
