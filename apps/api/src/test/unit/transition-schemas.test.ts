import { describe, it, expect } from "@jest/globals";
import {
  driverUpdateSchema,
  orderCreateSchema,
  orderStatusSchema,
  rideTransitionSchema,
} from "@/lib/validate";

/**
 * The request bodies that move rides, orders and drivers. These used to be read
 * raw from `req.json()`; the schemas existed but no route used them (threat
 * model IN-13).
 */

describe("rideTransitionSchema", () => {
  it("refuses a status the schema does not know", () => {
    expect(rideTransitionSchema.safeParse({ status: "TELEPORTED" }).success).toBe(false);
    expect(rideTransitionSchema.safeParse({}).success).toBe(false);
  });

  it("drops a client-sent fareActual instead of trusting it", () => {
    const parsed = rideTransitionSchema.parse({ status: "COMPLETED", fareActual: 0 });
    expect(parsed).toEqual({ status: "COMPLETED" });
  });

  it("treats a blank cancel reason as no reason", () => {
    expect(rideTransitionSchema.parse({ status: "CANCELLED", cancelReason: "   " }).cancelReason).toBeUndefined();
    expect(rideTransitionSchema.parse({ status: "CANCELLED", cancelReason: " Flat tyre " }).cancelReason).toBe(
      "Flat tyre"
    );
  });
});

describe("orderStatusSchema", () => {
  it("parses every order status, so a forbidden one is refused by the lifecycle and not as malformed", () => {
    expect(orderStatusSchema.safeParse({ status: "DELIVERED" }).success).toBe(true);
    expect(orderStatusSchema.safeParse({ status: "EATEN" }).success).toBe(false);
  });
});

describe("driverUpdateSchema", () => {
  it("accepts a real position, heading and online flag", () => {
    expect(
      driverUpdateSchema.safeParse({ isOnline: true, currentLat: -26.2, currentLng: 28.04, heading: 359.5 }).success
    ).toBe(true);
  });

  it("refuses coordinates and headings outside the globe and the compass", () => {
    expect(driverUpdateSchema.safeParse({ currentLat: 91, currentLng: 28 }).success).toBe(false);
    expect(driverUpdateSchema.safeParse({ currentLat: -26, currentLng: 181 }).success).toBe(false);
    expect(driverUpdateSchema.safeParse({ heading: 361 }).success).toBe(false);
    expect(driverUpdateSchema.safeParse({ heading: -1 }).success).toBe(false);
  });

  it("refuses half a position and a non-boolean online flag", () => {
    expect(driverUpdateSchema.safeParse({ currentLat: -26.2 }).success).toBe(false);
    expect(driverUpdateSchema.safeParse({ isOnline: "yes" }).success).toBe(false);
  });
});

describe("orderCreateSchema", () => {
  const base = { storeId: "s-1", deliveryAddress: "1 Test Street, Testville" };

  it("refuses the same product on two lines, which would dodge the stock check", () => {
    const result = orderCreateSchema.safeParse({
      ...base,
      items: [
        { productId: "p-1", quantity: 1 },
        { productId: "p-1", quantity: 2 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("refuses delivery coordinates off the globe", () => {
    expect(
      orderCreateSchema.safeParse({ ...base, items: [{ productId: "p-1", quantity: 1 }], deliveryLat: 120 }).success
    ).toBe(false);
  });
});
