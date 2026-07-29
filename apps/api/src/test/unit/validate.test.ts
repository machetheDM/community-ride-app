import { describe, it, expect } from "@jest/globals";
import { rideCreateSchema, orderCreateSchema, phoneSchema } from "@/lib/validate";

describe("Validation Schemas", () => {
  describe("phoneSchema", () => {
    it("should normalize SA phone numbers", () => {
      expect(phoneSchema.parse("0810000001")).toBe("+27810000001");
      expect(phoneSchema.parse("+27810000001")).toBe("+27810000001");
    });
  });

  describe("rideCreateSchema", () => {
    it("should accept valid ride request", () => {
      const result = rideCreateSchema.parse({
        pickupAddress: "123 Main St",
        dropoffAddress: "456 Oak Ave",
        fareEstimate: 50,
      });
      expect(result.vehicleType).toBe("SEDAN");
      expect(result.paymentMethod).toBe("CASH");
    });

    it("should reject missing addresses", () => {
      expect(() => rideCreateSchema.parse({})).toThrow();
    });
  });

  describe("orderCreateSchema", () => {
    it("should accept valid order", () => {
      const result = orderCreateSchema.parse({
        storeId: "store-1",
        items: [{ productId: "prod-1", quantity: 2 }],
        deliveryAddress: "123 Main St",
      });
      expect(result.items).toHaveLength(1);
    });

    it("should reject empty items", () => {
      expect(() =>
        orderCreateSchema.parse({ storeId: "store-1", items: [], deliveryAddress: "123 Main St" })
      ).toThrow();
    });
  });
});
