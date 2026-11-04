import { describe, it, expect } from "@jest/globals";
import { haversineKm } from "@/lib/arrival";

/**
 * The straight-line filter is a cost control, not a UX nicety: it decides whether a
 * billable Route Matrix call happens on a given driver location ping. Drivers report
 * position every few seconds, so getting this wrong means thousands of charged calls
 * per ride instead of a handful.
 */

const JOHANNESBURG = { lat: -26.2041, lng: 28.0473 };
const SOWETO = { lat: -26.2382, lng: 27.9089 };
const POLOKWANE = { lat: -23.9045, lng: 29.4689 };

describe("haversineKm", () => {
  it("returns zero for the same point", () => {
    expect(haversineKm(JOHANNESBURG, JOHANNESBURG)).toBe(0);
  });

  it("measures Johannesburg to Soweto at roughly 14 km", () => {
    // Real great-circle distance is about 14.2 km.
    const d = haversineKm(JOHANNESBURG, SOWETO);
    expect(d).toBeGreaterThan(13);
    expect(d).toBeLessThan(16);
  });

  it("measures Johannesburg to Polokwane at roughly 293 km", () => {
    // Great-circle, not road distance — the N1 route is nearer 320 km.
    const d = haversineKm(JOHANNESBURG, POLOKWANE);
    expect(d).toBeGreaterThan(285);
    expect(d).toBeLessThan(300);
  });

  it("is symmetric", () => {
    expect(haversineKm(JOHANNESBURG, SOWETO)).toBeCloseTo(haversineKm(SOWETO, JOHANNESBURG), 6);
  });

  it("puts a driver a few streets away inside the 3 km prefilter", () => {
    // ~500 m north of the pickup point.
    const nearby = { lat: JOHANNESBURG.lat + 0.0045, lng: JOHANNESBURG.lng };
    expect(haversineKm(nearby, JOHANNESBURG)).toBeLessThan(3);
  });

  it("puts a driver in the next township outside it, so no billable call is made", () => {
    expect(haversineKm(SOWETO, JOHANNESBURG)).toBeGreaterThan(3);
  });
});
