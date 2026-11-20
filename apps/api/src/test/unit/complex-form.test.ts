import { describe, it, expect } from "@jest/globals";
import { parseComplexForm, slugify } from "../../../../merchant-portal/src/lib/complex-form";

/**
 * The admin's "new shopping complex" form, tested from the API suite because the
 * portal has no test runner. The form posts to a Server Action, which anyone can
 * call with anything, so these are the only checks that stand between a typo and
 * a delivery zone that refuses every order.
 */

const valid = {
  name: "Junction Plaza",
  address: "1 Main Road, Testville",
  lat: "-24.65",
  lng: "29.93",
  deliveryRadiusKm: "8",
  deliveryFee: "20",
};

describe("parseComplexForm", () => {
  it("accepts a complete form and derives the slug from the name", () => {
    const result = parseComplexForm(valid);
    expect(result).toEqual({
      ok: true,
      value: {
        name: "Junction Plaza",
        slug: "junction-plaza",
        address: "1 Main Road, Testville",
        lat: -24.65,
        lng: 29.93,
        deliveryRadiusKm: 8,
        deliveryFee: "20",
      },
    });
  });

  it("refuses a latitude with its sign flipped, which would put the complex north of the equator", () => {
    const result = parseComplexForm({ ...valid, lat: "24.65" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.lat).toMatch(/negative/);
  });

  it("refuses coordinates outside South Africa", () => {
    expect(parseComplexForm({ ...valid, lng: "45" }).ok).toBe(false);
    expect(parseComplexForm({ ...valid, lat: "-40" }).ok).toBe(false);
  });

  it("refuses a radius a scooter cannot ride, or none", () => {
    expect(parseComplexForm({ ...valid, deliveryRadiusKm: "0.1" }).ok).toBe(false);
    expect(parseComplexForm({ ...valid, deliveryRadiusKm: "50" }).ok).toBe(false);
    expect(parseComplexForm({ ...valid, deliveryRadiusKm: "" }).ok).toBe(false);
  });

  it("takes the fee as rands to the cent, never a float or a negative", () => {
    expect(parseComplexForm({ ...valid, deliveryFee: "18.50" }).ok).toBe(true);
    for (const fee of ["18.505", "-5", "1e2", "abc", "600"]) {
      expect(parseComplexForm({ ...valid, deliveryFee: fee }).ok).toBe(false);
    }
  });

  it("reports every bad field at once, not the first only", () => {
    const result = parseComplexForm({ name: "", address: "", lat: "", lng: "", deliveryRadiusKm: "", deliveryFee: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(
        ["address", "deliveryFee", "deliveryRadiusKm", "lat", "lng", "name"].sort()
      );
    }
  });

  it("ignores fields it does not know, so a crafted post cannot set isActive or an id", () => {
    const result = parseComplexForm({ ...valid, isActive: "false", id: "chosen-id" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toHaveProperty("isActive");
      expect(result.value).not.toHaveProperty("id");
    }
  });
});

describe("slugify", () => {
  it("makes a lower-case, hyphenated slug and drops accents and punctuation", () => {
    expect(slugify("Mall @ Ga-Rankuwa — Phase 2")).toBe("mall-ga-rankuwa-phase-2");
    expect(slugify("Café Élan")).toBe("cafe-elan");
  });
});
