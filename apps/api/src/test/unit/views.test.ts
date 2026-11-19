import { describe, it, expect } from "@jest/globals";
import {
  availableDeliverySelect,
  availableRideSelect,
  deliverySelect,
  driverAdminSelect,
  driverSelfSelect,
  orderSelect,
  presentAvailableDelivery,
  presentAvailableRide,
  presentOrder,
  presentRide,
  productPublicSelect,
  riderSelfSelect,
  rideSelect,
  storeDetailSelect,
  storeListSelect,
  type AvailableDeliveryRecord,
  type OrderRecord,
  type RideRecord,
} from "@/lib/views";
import { encryptField } from "@ride/db/crypto";
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
  availableDeliverySelect,
  riderSelfSelect,
  productPublicSelect,
  storeListSelect,
  storeDetailSelect,
};

const CUSTOMER_PHONE = "+27000000101";
const DRIVER_PHONE = "+27000000202";
const DRIVER_AT = { lat: -26.123, lng: 28.123 };

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
            currentLat: DRIVER_AT.lat,
            currentLng: DRIVER_AT.lng,
            user: { name: "Sipho Fake", phone: DRIVER_PHONE, avatar: null },
            vehicle: { type: "SEDAN", make: "Toyota", model: "Corolla", color: "White", licensePlate: "TEST 123 GP" },
          },
    payment: null,
    rating: null,
  } as unknown as RideRecord;
}

const HANDOVER = "7391";
const RIDER_AT = { lat: -26.15, lng: 28.15 };

/** The fixture order with its delivery in `status`. */
function orderWithDelivery(status: string): OrderRecord {
  return {
    ...order,
    delivery: {
      ...(order.delivery as object),
      status,
      handoverCodeEnc: encryptField(HANDOVER),
      rider: {
        currentLat: RIDER_AT.lat,
        currentLng: RIDER_AT.lng,
        user: { name: "Rider Person" },
        vehicle: { type: "SCOOTER", color: "Red", licensePlate: "TEST 456 GP" },
      },
    },
  } as unknown as OrderRecord;
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

  it("reads a live position only for the admin roster, a ride's driver and an order's delivery rider", () => {
    // The order read takes the assigned scooter rider's position for the
    // customer's tracking screen; presentOrder lets it out only to the customer,
    // between pickup and handover (tested under presentOrder).
    for (const [name, select] of Object.entries(SELECTS)) {
      if (name === "driverAdminSelect" || name === "orderSelect" || name === "rideSelect") continue;
      expect(namesIn(select)).not.toContain("currentLat");
    }
    expect(namesIn(driverAdminSelect)).toContain("currentLat");
    expect(namesIn(orderSelect.delivery.select.rider)).toContain("currentLat");
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

  it("shows the driver's position to the ride's customer during the trip, and to nobody else at any time", () => {
    const at = String(DRIVER_AT.lat);
    for (const status of ["ACCEPTED", "DRIVER_ARRIVED", "IN_PROGRESS"] as const) {
      expect(presentRide(ride(status), "CUSTOMER")).toMatchObject({ driver: { location: DRIVER_AT } });
      expect(namesIn(presentRide(ride(status), "DRIVER"))).not.toContain(at);
      expect(namesIn(presentRide(ride(status), "ADMIN"))).not.toContain(at);
    }
    for (const status of ["COMPLETED", "CANCELLED"] as const) {
      expect(namesIn(presentRide(ride(status), "CUSTOMER"))).not.toContain(at);
    }
  });

  it("never carries a forbidden field or the raw coordinate columns, for any caller in any state", () => {
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

  it("shows the customer's phone to an admin, and to the rider only while the delivery is theirs and active", () => {
    for (const relation of ["CUSTOMER", "MERCHANT"] as const) {
      expect(namesIn(presentOrder(orderWithDelivery("EN_ROUTE"), relation))).not.toContain(CUSTOMER_PHONE);
    }
    for (const status of ["ASSIGNED", "PICKED_UP", "EN_ROUTE"]) {
      expect(namesIn(presentOrder(orderWithDelivery(status), "RIDER"))).toContain(CUSTOMER_PHONE);
    }
    for (const status of ["PENDING", "DELIVERED", "FAILED"]) {
      expect(namesIn(presentOrder(orderWithDelivery(status), "RIDER"))).not.toContain(CUSTOMER_PHONE);
    }
    expect(namesIn(presentOrder(order, "ADMIN"))).toContain(CUSTOMER_PHONE);
  });

  it("gives the handover code to the customer alone, and only until the delivery is over", () => {
    for (const status of ["PENDING", "ASSIGNED", "PICKED_UP", "EN_ROUTE"]) {
      expect(namesIn(presentOrder(orderWithDelivery(status), "CUSTOMER"))).toContain(HANDOVER);
      for (const relation of ["MERCHANT", "RIDER", "ADMIN"] as const) {
        const text = namesIn(presentOrder(orderWithDelivery(status), relation));
        expect(text).not.toContain(HANDOVER);
        expect(text).not.toContain("handoverCode");
      }
    }
    for (const status of ["DELIVERED", "FAILED"]) {
      expect(namesIn(presentOrder(orderWithDelivery(status), "CUSTOMER"))).not.toContain(HANDOVER);
    }
  });

  it("never copies the encrypted code out, for anyone", () => {
    for (const relation of relations) {
      expect(namesIn(presentOrder(orderWithDelivery("EN_ROUTE"), relation))).not.toContain("handoverCodeEnc");
    }
  });

  it("shows the customer where the rider is between pickup and handover, and nobody else ever", () => {
    for (const status of ["PICKED_UP", "EN_ROUTE"]) {
      expect(namesIn(presentOrder(orderWithDelivery(status), "CUSTOMER"))).toContain(String(RIDER_AT.lat));
    }
    for (const status of ["PENDING", "ASSIGNED", "DELIVERED", "FAILED"]) {
      expect(namesIn(presentOrder(orderWithDelivery(status), "CUSTOMER"))).not.toContain(String(RIDER_AT.lat));
    }
    for (const relation of ["MERCHANT", "RIDER", "ADMIN"] as const) {
      expect(namesIn(presentOrder(orderWithDelivery("EN_ROUTE"), relation))).not.toContain(String(RIDER_AT.lat));
    }
  });
});

describe("presentAvailableDelivery", () => {
  it("shows the store, a suburb and rounded distances, and nothing that identifies the customer", () => {
    const record = {
      id: "del-1",
      createdAt: new Date(),
      order: {
        id: "order-1",
        status: "CONFIRMED",
        customerId: "u-cust",
        deliveryFee: "18.00",
        deliveryAddress: "12 Test Street, Testville, Fakecity",
        deliveryLat: -26.21,
        deliveryLng: 28.05,
        createdAt: new Date(),
        _count: { items: 2 },
        store: { name: "Test Spaza", address: "Shop 1, Testville Plaza", lat: -26.2, lng: 28.04, complex: { name: "Test Mall" } },
      },
    } as unknown as AvailableDeliveryRecord;

    const view = presentAvailableDelivery(record, 1.234);

    expect(view).toMatchObject({ dropoffArea: "Testville", distanceToStoreKm: 1.2, itemCount: 2 });
    expect(view.store).toEqual({ name: "Test Spaza", address: "Shop 1, Testville Plaza", complex: "Test Mall" });
    const text = namesIn(view);
    for (const hidden of ["12 Test Street", "u-cust", "-26.21", "customerId"]) expect(text).not.toContain(hidden);
    expect(((view.storeToDropoffKm ?? 0) * 2) % 1).toBe(0);
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
