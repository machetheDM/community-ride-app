import { describe, it, expect, afterEach } from "@jest/globals";
import { cancelCode, tripEventRow, type TripEventInput } from "@/lib/analytics";
import { roundCoordinate } from "@/lib/geo";

/**
 * What a trip row carries to BigQuery (threat model AN-2). The dataset is keyed
 * by a stable pseudonym, so anything in the row that points at a person (a
 * front-door coordinate, a typed reason naming someone) undoes the pseudonym.
 */

const RIDE: TripEventInput = {
  id: "ride-1",
  status: "CANCELLED",
  customerId: "u-cust",
  driverId: "d-1",
  vehicleType: "SEDAN",
  paymentMethod: "CASH",
  pickupLat: -26.238217,
  pickupLng: 27.908934,
  pickupAddress: "12 Vilakazi St, Orlando West, Soweto",
  dropoffLat: -26.204103,
  dropoffLng: 28.047305,
  dropoffAddress: "1 Fake Road",
  distanceKm: 14.3,
  durationMinutes: 24,
  fareEstimate: "130.00",
  fareActual: null,
  createdAt: new Date("2026-11-04T10:00:00Z"),
  acceptedAt: new Date("2026-11-04T10:02:00Z"),
  startedAt: null,
  completedAt: null,
  cancelledAt: new Date("2026-11-04T10:05:00Z"),
  cancelledBy: "DRIVER",
};

describe("tripEventRow", () => {
  afterEach(() => {
    delete process.env.ANALYTICS_HASH_SALT;
  });

  it("rounds every coordinate to two decimals, about a kilometre", () => {
    const row = tripEventRow(RIDE);
    expect(row.pickup_lat).toBe(-26.24);
    expect(row.pickup_lng).toBe(27.91);
    expect(row.dropoff_lat).toBe(-26.2);
    expect(row.dropoff_lng).toBe(28.05);
  });

  it("sends who cancelled, never what they typed", () => {
    const typed = { ...RIDE, cancelReason: "Customer at 12 Vilakazi St was rude, call 0820000000" };
    const row = tripEventRow(typed as TripEventInput);
    expect(row.cancel_reason).toBe("CANCELLED_BY_DRIVER");
    expect(JSON.stringify(row)).not.toContain("Vilakazi St was rude");
  });

  it("labels areas without the street, and leaves an unsplittable address out", () => {
    const row = tripEventRow(RIDE);
    expect(row.pickup_area).toBe("Orlando West");
    expect(row.dropoff_area).toBeNull();
  });

  it("records the acceptance time, not the pickup time, as accepted_at", () => {
    expect(tripEventRow(RIDE).accepted_at).toBe("2026-11-04T10:02:00.000Z");
  });
});

describe("cancelCode", () => {
  it("is null for a completed ride and a code for each canceller", () => {
    expect(cancelCode({ status: "COMPLETED", cancelledBy: null })).toBeNull();
    expect(cancelCode({ status: "CANCELLED", cancelledBy: "CUSTOMER" })).toBe("CANCELLED_BY_CUSTOMER");
    expect(cancelCode({ status: "CANCELLED", cancelledBy: "ADMIN" })).toBe("CANCELLED_BY_ADMIN");
    expect(cancelCode({ status: "CANCELLED", cancelledBy: "anything typed" })).toBe("CANCELLED_BY_UNKNOWN");
  });
});

describe("roundCoordinate", () => {
  it("treats the old 0,0 placeholder and missing values as no coordinate", () => {
    expect(roundCoordinate(0)).toBeNull();
    expect(roundCoordinate(null)).toBeNull();
    expect(roundCoordinate(Number.NaN)).toBeNull();
  });
});
