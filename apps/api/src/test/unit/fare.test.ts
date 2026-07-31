import { describe, it, expect } from "@jest/globals";
import { calculateFare, VEHICLE_RATES, type PricingPolicy } from "@/lib/fare";

const policy: PricingPolicy = {
  perMinuteRate: 1.5,
  minimumFare: 25,
  platformFeePercent: 10,
};

describe("calculateFare", () => {
  it("prices a sedan trip from distance and duration", () => {
    // 15 base + (7 × 10km) + (1.5 × 20min) = 15 + 70 + 30 = 115
    const fare = calculateFare("SEDAN", 10, 20, policy);
    expect(fare.baseFare).toBe(15);
    expect(fare.distanceFare).toBe(70);
    expect(fare.timeFare).toBe(30);
    expect(fare.total).toBe(115);
  });

  it("charges different vehicle types differently for the same trip", () => {
    const sedan = calculateFare("SEDAN", 10, 20, policy);
    const bakkie = calculateFare("BAKKIE", 10, 20, policy);
    const bicycle = calculateFare("BICYCLE", 10, 20, policy);

    expect(bakkie.total).toBeGreaterThan(sedan.total);
    expect(bicycle.total).toBeLessThan(sedan.total);
  });

  it("applies the minimum fare on very short trips", () => {
    // 8 base + (3 × 0.5km) + (1.5 × 2min) = 12.5, below the 25 minimum.
    const fare = calculateFare("BICYCLE", 0.5, 2, policy);
    expect(fare.total).toBe(25);
    expect(fare.minimumApplied).toBe(true);
  });

  it("does not flag the minimum when the calculated fare clears it", () => {
    const fare = calculateFare("SEDAN", 10, 20, policy);
    expect(fare.minimumApplied).toBe(false);
  });

  it("splits the total into platform fee and driver earnings", () => {
    const fare = calculateFare("SEDAN", 10, 20, policy);
    expect(fare.platformFee).toBe(11.5); // 10% of 115
    expect(fare.driverEarnings).toBe(103.5);
    expect(fare.platformFee + fare.driverEarnings).toBeCloseTo(fare.total, 2);
  });

  it("falls back to sedan rates for an unknown vehicle type", () => {
    const unknown = calculateFare("HELICOPTER", 10, 20, policy);
    const sedan = calculateFare("SEDAN", 10, 20, policy);
    expect(unknown.total).toBe(sedan.total);
    expect(unknown.vehicleType).toBe("SEDAN");
  });

  it("treats negative or non-finite inputs as zero rather than producing a credit", () => {
    for (const bad of [-5, NaN, Infinity]) {
      const fare = calculateFare("SEDAN", bad, bad, policy);
      expect(fare.distanceKm).toBe(0);
      expect(fare.durationMinutes).toBe(0);
      // Base 15 alone is under the minimum, so the floor applies.
      expect(fare.total).toBe(25);
    }
  });

  it("rounds money to two decimals", () => {
    const fare = calculateFare("SEDAN", 3.333, 7, policy);
    expect(fare.total).toBe(Math.round(fare.total * 100) / 100);
    expect(String(fare.total).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });

  it("covers every vehicle type the booking screen offers", () => {
    // Guards against the app offering a type the rate card has no entry for,
    // which would silently price it as a sedan.
    for (const type of ["SEDAN", "MINIVAN", "BAKKIE", "SCOOTER", "BICYCLE"]) {
      expect(VEHICLE_RATES[type]).toBeDefined();
    }
  });
});
