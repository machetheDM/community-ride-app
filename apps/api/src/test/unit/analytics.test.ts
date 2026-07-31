import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  pseudonymise,
  areaOf,
  newEventId,
  isAnalyticsEnabled,
  recordTrip,
  isQueryable,
  __resetAnalyticsClient,
  type TripEvent,
} from "@ride/analytics";

/**
 * The load-bearing property of this module is that it cannot break a ride.
 *
 * These assert the two ways that could happen: an unconfigured environment turning
 * into a thrown error, and a failing write propagating out of the emitter. Also
 * covered is the pseudonymisation rule, which is a privacy guarantee rather than a
 * convenience — raw customer ids must never reach the analytical store.
 */

const RIDE: TripEvent = {
  event_id: "evt-1",
  ride_id: "ride-1",
  occurred_at: new Date().toISOString(),
  status: "COMPLETED",
  vehicle_type: "SEDAN",
  payment_method: "CASH",
  pickup_lat: -26.2382,
  pickup_lng: 27.9089,
  dropoff_lat: -26.2041,
  dropoff_lng: 28.0473,
  pickup_area: "Orlando West",
  dropoff_area: "Johannesburg",
  distance_km: 14.3,
  estimated_duration_minutes: 24,
  actual_duration_minutes: 27,
  fare_estimate: 130,
  fare_actual: 130,
  driver_earnings: 117,
  platform_fee: 13,
  customer_key: null,
  driver_key: null,
  cancel_reason: null,
  requested_at: null,
  accepted_at: null,
};

describe("isAnalyticsEnabled", () => {
  beforeEach(() => {
    delete process.env.BIGQUERY_DATASET;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    __resetAnalyticsClient();
  });

  it("is false when nothing is configured", () => {
    expect(isAnalyticsEnabled()).toBe(false);
    expect(isQueryable()).toBe(false);
  });

  it("needs both the project and the dataset", () => {
    process.env.BIGQUERY_DATASET = "ride_analytics";
    expect(isAnalyticsEnabled()).toBe(false);

    process.env.GOOGLE_CLOUD_PROJECT = "community-ride";
    expect(isAnalyticsEnabled()).toBe(true);
  });

  afterEach(() => {
    delete process.env.BIGQUERY_DATASET;
    delete process.env.GOOGLE_CLOUD_PROJECT;
  });
});

describe("recordTrip", () => {
  beforeEach(() => {
    __resetAnalyticsClient();
    delete process.env.BIGQUERY_DATASET;
    delete process.env.GOOGLE_CLOUD_PROJECT;
  });

  it("resolves false instead of throwing when unconfigured", async () => {
    // The whole failure posture in one assertion: a completed ride calls this on
    // its tail, and it must not be able to raise.
    await expect(recordTrip(RIDE)).resolves.toBe(false);
  });

  it("gives up rather than hanging when credentials cannot be resolved", async () => {
    process.env.BIGQUERY_DATASET = "ride_analytics";
    process.env.GOOGLE_CLOUD_PROJECT = "community-ride";
    // Application Default Credentials are absent here, so the client retries a
    // metadata endpoint that never answers. On Cloud Run this resolves instantly;
    // anywhere else it hangs, and because these writes are fired and not awaited a
    // hang would pile up invisibly. The bound is what makes it deterministic.
    process.env.BIGQUERY_TIMEOUT_MS = "150";

    await expect(recordTrip(RIDE)).resolves.toBe(false);
  });

  afterEach(() => {
    delete process.env.BIGQUERY_DATASET;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.BIGQUERY_TIMEOUT_MS;
  });
});

describe("pseudonymise", () => {
  afterEach(() => {
    delete process.env.ANALYTICS_HASH_SALT;
  });

  it("returns null without a salt rather than emitting a reversible hash", () => {
    delete process.env.ANALYTICS_HASH_SALT;
    // An unsalted hash of a known id space is trivially reversible, so producing
    // one would be a false assurance of anonymity.
    expect(pseudonymise("user-abc")).toBeNull();
  });

  it("never returns the raw identifier", () => {
    process.env.ANALYTICS_HASH_SALT = "test-salt";
    const key = pseudonymise("user-abc");
    expect(key).not.toBeNull();
    expect(key).not.toContain("user-abc");
  });

  it("is stable for the same id, so distinct-customer counts work", () => {
    process.env.ANALYTICS_HASH_SALT = "test-salt";
    expect(pseudonymise("user-abc")).toBe(pseudonymise("user-abc"));
  });

  it("differs between ids", () => {
    process.env.ANALYTICS_HASH_SALT = "test-salt";
    expect(pseudonymise("user-abc")).not.toBe(pseudonymise("user-xyz"));
  });

  it("changes when the salt changes, so the mapping is not portable", () => {
    process.env.ANALYTICS_HASH_SALT = "salt-one";
    const first = pseudonymise("user-abc");
    process.env.ANALYTICS_HASH_SALT = "salt-two";
    expect(pseudonymise("user-abc")).not.toBe(first);
  });

  it("passes through null and undefined", () => {
    process.env.ANALYTICS_HASH_SALT = "test-salt";
    expect(pseudonymise(null)).toBeNull();
    expect(pseudonymise(undefined)).toBeNull();
  });
});

describe("areaOf", () => {
  it("takes the suburb rather than the street number", () => {
    // Storing the street line in a separate analytical store would be a precise
    // home address with no analytical benefit over the suburb.
    expect(areaOf("12 Vilakazi St, Orlando West, Soweto, 1804")).toBe("Orlando West");
  });

  it("falls back to the only component when there is no suburb", () => {
    expect(areaOf("Soweto")).toBe("Soweto");
  });

  it("returns null for empty input", () => {
    expect(areaOf(null)).toBeNull();
    expect(areaOf(undefined)).toBeNull();
    expect(areaOf("")).toBeNull();
  });

  it("bounds the label length", () => {
    const area = areaOf(`x, ${"y".repeat(500)}`);
    expect(area?.length).toBeLessThanOrEqual(100);
  });
});

describe("newEventId", () => {
  it("is unique per call", () => {
    expect(newEventId()).not.toBe(newEventId());
  });
});
