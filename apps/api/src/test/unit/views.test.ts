import { describe, it, expect } from "@jest/globals";
import {
  availableRideSelect,
  deliverySelect,
  driverAdminSelect,
  driverSelfSelect,
  orderSelect,
  presentAvailableRide,
  presentOrder,
  presentRide,
  productPublicSelect,
  rideSelect,
  storeDetailSelect,
  storeListSelect,
  type OrderRecord,
  type RideRecord,
} from "@/lib/views";
import { coarseArea } from "@/lib/geo";
import type { RideRelation, OrderRelation } from "@/lib/policy";

/**
 * Response shapes (OWASP API3). The guarantee under test is negative: certain
 * names never appear in anything the API reads to answer with, or in anything it
 * answers. A search over the serialised shape is blunt on purpose; it also
 * catches a field nested three levels down that a reviewer would scroll past.
 */

const NEVER = ["idNumberEnc", "idNumberHash", "licenseNumber", "pushToken"];

function namesIn(value: unknown): string {
  return JSON.stringify(value);
}

const SELECTS = {
  rideSelect,
  availableRideSelect,
  driverAdminSelect,
  driverSelfSelect,
  orderSelect,
  deliverySelect,
  productPublicSelect,
  storeListSelect,
  storeDetailSelect,
};

const CUSTOMER_PHONE = "+27000000101";
const DRIVER_PHONE = "+27000000202";

function ride(status: RideRecord["status"]): RideRecord {
  return {
    id: "ride-1",
    status,
    customerId: "u-cust",
    driverId: status === "REQUESTED" ? null : "d-1",
    pickupAddress: "12 Test Street, Testville, Fakecity",
    pickupLat: -26.1,
    pickupLng: 28.1,
    dropoffAddress: "1 Other Road, Elsewhere",
    dropoffLat: -26.2,
    dropoffLng: 28.2,
    vehicleType: "SEDAN",
    fareEstimate: "85.50",
    fareActual: null,
    distanceKm: 9.4,
    durationMinutes: 18,
    paymentMethod: "CASH",
    scheduledAt: null,
    acceptedAt: null,
    arrivedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    cancelledBy: null,
    createdAt: new Date("2026-11-04T10:00:00Z"),
    updatedAt: new Date("2026-11-04T10:00:00Z"),
    customer: { id: "u-cust", name: "Thandi Test", phone: CUSTOMER_PHONE },
    driver:
      status === "REQUESTED"
        ? null
        : {
            id: "d-1",
            rating: 4.8,
            user: { name: "Sipho Fake", phone: DRIVER_PHONE, avatar: null },
            vehicle: { type: "SEDAN", make: "Toyota", model: "Corolla", color: "White", licensePlate: "TEST 123 GP" },
          },
    payment: null,
    rating: null,
  } as unknown as RideRecord;
}

const order = {
  id: "order-1",
  status: "PREPARING",
  customerId: "u-cust",
  storeId: "store-1",
  subtotal: "40.00",
  deliveryFee: "15.00",
  total: "55.00",
  deliveryAddress: "12 Test Street, Testville",
  deliveryLat: -26.1,
  deliveryLng: 28.1,
  notes: null,
  paymentMethod: "CASH",
  confirmedAt: null,
  preparedAt: null,
  readyAt: null,
  deliveredAt: null,
  cancelledAt: null,
  cancelReason: null,
  cancelledBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  customer: { id: "u-cust", name: "Thandi Test", phone: CUSTOMER_PHONE },
  store: { id: "store-1", name: "Test Spaza", logoUrl: null, address: "Shop 1, Testville", merchantId: "m-secret" },
  items: [],
  delivery: {
    id: "del-1",
    status: "ASSIGNED",
    riderId: "r-1",
    pickedUpAt: null,
    deliveredAt: null,
    failedAt: null,
    rider: { user: { name: "Rider Person" } },
  },
} as unknown as OrderRecord;

describe("every select", () => {
  it.each(Object.entries(SELECTS))("%s never reads an ID number, a licence number or a push token", (_name, select) => {
    const text = namesIn(select);
    for (const name of NEVER) expect(text).not.toContain(name);
  });

  it("does not read a driver's live position except for the admin roster", () => {
    for (const [name, select] of Object.entries(SELECTS)) {
      if (name === "driverAdminSelect") continue;
      expect(namesIn(select)).not.toContain("currentLat");
    }
    expect(namesIn(driverAdminSelect)).toContain("currentLat");
  });

  it("does not read merchantId for any public store response", () => {
    expect(namesIn(storeListSelect)).not.toContain("merchantId");
    expect(namesIn(storeDetailSelect)).not.toContain("merchantId");
    expect(namesIn(storeListSelect)).not.toContain('"phone"');
  });
});

describe("presentRide", () => {
  const relations: RideRelation[] = ["CUSTOMER", "DRIVER", "ADMIN"];
  const statuses: RideRecord["status"][] = [
    "REQUESTED",
    "ACCEPTED",
    "DRIVER_ARRIVED",
    "IN_PROGRESS",
    "COMPLETED",
    "CANCELLED",
  ];

  it("never carries a forbidden field or the driver's coordinates, for any caller in any state", () => {
    for (const relation of relations) {
      for (const status of statuses) {
        const text = namesIn(presentRide(ride(status), relation));
        for (const name of [...NEVER, "currentLat", "currentLng"]) expect(text).not.toContain(name);
      }
    }
  });

  it("shows the customer the driver's phone and plate during the trip and not after it", () => {
    for (const status of ["ACCEPTED", "DRIVER_ARRIVED", "IN_PROGRESS"] as const) {
      const text = namesIn(presentRide(ride(status), "CUSTOMER"));
      expect(text).toContain(DRIVER_PHONE);
      expect(text).toContain("TEST 123 GP");
    }
    for (const status of ["COMPLETED", "CANCELLED"] as const) {
      const text = namesIn(presentRide(ride(status), "CUSTOMER"));
      expect(text).not.toContain(DRIVER_PHONE);
      expect(text).not.toContain("TEST 123 GP");
    }
  });

  it("shows the driver the customer's first name always and phone only during the trip", () => {
    const during = presentRide(ride("IN_PROGRESS"), "DRIVER");
    expect(during.customer).toEqual({ name: "Thandi", phone: CUSTOMER_PHONE });
    const after = presentRide(ride("COMPLETED"), "DRIVER");
    expect(after.customer).toEqual({ name: "Thandi" });
    expect(namesIn(after)).not.toContain("Thandi Test");
    expect(namesIn(after)).not.toContain(CUSTOMER_PHONE);
  });

  it("does not hand a customer their own ride's internal ids beyond their own", () => {
    const view = presentRide(ride("ACCEPTED"), "CUSTOMER");
    expect(view).not.toHaveProperty("customerId");
    expect(view).not.toHaveProperty("driverId");
  });
});

describe("presentAvailableRide", () => {
  it("shows an area, distances, the fare and the vehicle type, and nothing that identifies the customer", () => {
    const view = presentAvailableRide(
      {
        id: "ride-1",
        pickupAddress: "12 Test Street, Testville, Fakecity",
        pickupLat: -26.1,
        pickupLng: 28.1,
        dropoffAddress: "1 Other Road, Elsewhere",
        distanceKm: 9.4,
        fareEstimate: "85.50" as never,
        vehicleType: "SEDAN",
        createdAt: new Date(),
      },
      { lat: -26.11, lng: 28.11 }
    );
    expect(Object.keys(view).sort()).toEqual(
      ["createdAt", "distanceKm", "dropoffArea", "fareEstimate", "id", "pickupArea", "pickupDistanceKm", "vehicleType"].sort()
    );
    expect(view.pickupArea).toBe("Testville");
    expect(namesIn(view)).not.toContain("12 Test Street");
    // Half-kilometre steps, so the exact pickup cannot be triangulated.
    expect((view.pickupDistanceKm ?? 0) * 2).toBe(Math.round((view.pickupDistanceKm ?? 0) * 2));
  });
});

describe("presentOrder", () => {
  const relations: OrderRelation[] = ["CUSTOMER", "MERCHANT", "RIDER", "ADMIN"];

  it("never carries a forbidden field or the merchant id, for any caller", () => {
    for (const relation of relations) {
      const text = namesIn(presentOrder(order, relation));
      for (const name of [...NEVER, "merchantId", "m-secret", "riderId"]) expect(text).not.toContain(name);
    }
  });

  it("shows the customer's phone to an admin only", () => {
    for (const relation of ["CUSTOMER", "MERCHANT", "RIDER"] as const) {
      expect(namesIn(presentOrder(order, relation))).not.toContain(CUSTOMER_PHONE);
    }
    expect(namesIn(presentOrder(order, "ADMIN"))).toContain(CUSTOMER_PHONE);
  });
});

describe("coarseArea", () => {
  it("returns the suburb of a Google-style address", () => {
    expect(coarseArea("12 Vilakazi St, Orlando West, Soweto, 1804, South Africa")).toBe("Orlando West");
  });

  it("skips a street line with a number in it instead of returning it", () => {
    expect(coarseArea("Unit 4, 12 Vilakazi St, Orlando West")).toBe("Orlando West");
  });

  it("says nothing rather than echo an address it cannot split", () => {
    expect(coarseArea("12 Vilakazi Street")).toBeNull();
    expect(coarseArea("")).toBeNull();
    expect(coarseArea(null)).toBeNull();
  });
});
