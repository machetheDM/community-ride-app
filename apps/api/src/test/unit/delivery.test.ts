import { describe, it, expect } from "@jest/globals";
import { encryptField } from "@ride/db/crypto";
import {
  checkHandoverCode,
  deliveryFeeFor,
  HANDOVER_MAX_ATTEMPTS,
  newHandoverCode,
  outsideZoneRefusal,
  revealHandoverCode,
  type StoreForPricing,
} from "@/lib/delivery";
import { riderAcceptRefusal, riderWorkRefusal, type Viewer } from "@/lib/policy";
import { deliveryStatusSchema } from "@/lib/validate";

describe("handover codes", () => {
  it("are four digits, from the full range, and stored encrypted", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { code, stored } = newHandoverCode();
      expect(code).toMatch(/^\d{4}$/);
      expect(stored).toMatch(/^v1\./);
      expect(stored).not.toContain(code);
      expect(revealHandoverCode(stored)).toBe(code);
      seen.add(code);
    }
    // Two hundred draws from ten thousand codes repeat rarely; a constant or a
    // tiny range would collapse this set.
    expect(seen.size).toBeGreaterThan(180);
  });

  it("accept the right code and refuse a wrong one", () => {
    const stored = encryptField("2468");
    expect(checkHandoverCode(stored, 0, "2468")).toBe("OK");
    expect(checkHandoverCode(stored, 0, "2469")).toBe("WRONG");
    expect(checkHandoverCode(stored, 0, "246")).toBe("WRONG");
  });

  it("lock at the limit, even against the right code", () => {
    const stored = encryptField("2468");
    expect(checkHandoverCode(stored, HANDOVER_MAX_ATTEMPTS - 1, "2468")).toBe("OK");
    expect(checkHandoverCode(stored, HANDOVER_MAX_ATTEMPTS, "2468")).toBe("LOCKED");
  });

  it("cannot be completed by code when none was stored, or the stored one is unreadable", () => {
    expect(checkHandoverCode(null, 0, "2468")).toBe("MISSING");
    expect(checkHandoverCode("v1.not.a.real-ciphertext", 0, "2468")).toBe("MISSING");
    expect(revealHandoverCode("garbage")).toBeNull();
  });

  it("must be sent with delivered, and only with a rider's own moves", () => {
    expect(deliveryStatusSchema.safeParse({ status: "DELIVERED" }).success).toBe(false);
    expect(deliveryStatusSchema.safeParse({ status: "DELIVERED", handoverCode: "12345" }).success).toBe(false);
    expect(deliveryStatusSchema.safeParse({ status: "DELIVERED", handoverCode: "1234" }).success).toBe(true);
    expect(deliveryStatusSchema.safeParse({ status: "PICKED_UP" }).success).toBe(true);
    expect(deliveryStatusSchema.safeParse({ status: "ASSIGNED" }).success).toBe(false);
    expect(deliveryStatusSchema.safeParse({ status: "PENDING" }).success).toBe(false);
  });
});

describe("a store's delivery fee and zone", () => {
  const complex = { deliveryFee: "18.00", deliveryRadiusKm: 5, lat: -26.2, lng: 28.04, isActive: true };
  const inComplex: StoreForPricing = { deliveryFee: "25.00", lat: -26.2, lng: 28.04, complex };
  const standAlone: StoreForPricing = { deliveryFee: "25.00", lat: -26.2, lng: 28.04, complex: null };

  it("is the complex's fee for a store in an active complex, the store's own otherwise", () => {
    expect(String(deliveryFeeFor(inComplex))).toBe("18.00");
    expect(String(deliveryFeeFor(standAlone))).toBe("25.00");
    expect(String(deliveryFeeFor({ ...inComplex, complex: { ...complex, isActive: false } }))).toBe("25.00");
  });

  it("refuses an address beyond the complex's radius and accepts one inside it", () => {
    expect(outsideZoneRefusal(inComplex, { lat: -26.21, lng: 28.05 })).toBeNull();
    expect(outsideZoneRefusal(inComplex, { lat: -26.0, lng: 28.04 })).toMatch(/22\.\d km from the complex; deliveries go up to 5 km/);
  });

  it("puts no radius on a stand-alone store or an inactive complex", () => {
    expect(outsideZoneRefusal(standAlone, { lat: -25.0, lng: 28.0 })).toBeNull();
    expect(outsideZoneRefusal({ ...inComplex, complex: { ...complex, isActive: false } }, { lat: -25.0, lng: 28.0 })).toBeNull();
  });
});

describe("who may take a delivery", () => {
  const working = { isApproved: true, isOnline: true, vehicle: { isApproved: true } };
  const rider: Viewer = { userId: "u-rider", role: "RIDER", riderId: "r-1" };

  it("is an approved, online rider with an approved vehicle", () => {
    expect(riderWorkRefusal(working)).toBeNull();
    expect(riderWorkRefusal({ ...working, isApproved: false })).toMatch(/not been approved/);
    expect(riderWorkRefusal({ ...working, isOnline: false })).toMatch(/Go online to see and accept deliveries/);
    expect(riderWorkRefusal({ ...working, vehicle: null })).toMatch(/Register a vehicle/);
    expect(riderWorkRefusal({ ...working, vehicle: { isApproved: false } })).toMatch(/vehicle has not been approved/);
  });

  it("holding no other delivery, and not delivering their own order", () => {
    expect(riderAcceptRefusal(working, 0, rider, { customerId: "u-cust" })).toBeNull();
    expect(riderAcceptRefusal(working, 1, rider, { customerId: "u-cust" })).toMatch(/Finish your current delivery/);
    expect(riderAcceptRefusal(working, 0, rider, { customerId: "u-rider" })).toMatch(/your own order/);
  });
});
