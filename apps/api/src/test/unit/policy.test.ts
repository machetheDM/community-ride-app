import { describe, it, expect } from "@jest/globals";
import {
  acceptRefusal,
  firstName,
  goOnlineRefusal,
  isAssignedRider,
  orderListScope,
  orderRelation,
  rideListScope,
  rideRelation,
  storeOrderRefusal,
  workRefusal,
  type Viewer,
} from "@/lib/policy";

/**
 * Object-level authorisation, one rule at a time (OWASP API1). The routes ask
 * these functions and nothing else, so a rule that is right here is right in
 * every route that uses it.
 */

const customer: Viewer = { userId: "u-cust", role: "CUSTOMER" };
const stranger: Viewer = { userId: "u-other", role: "CUSTOMER" };
const driver: Viewer = { userId: "u-drv", role: "DRIVER", driverId: "d-1" };
const otherDriver: Viewer = { userId: "u-drv2", role: "DRIVER", driverId: "d-2" };
const driverWithoutProfile: Viewer = { userId: "u-drv3", role: "DRIVER", driverId: null };
const admin: Viewer = { userId: "u-admin", role: "ADMIN" };
const merchant: Viewer = { userId: "u-merch", role: "MERCHANT", merchantId: "m-1" };
const otherMerchant: Viewer = { userId: "u-merch2", role: "MERCHANT", merchantId: "m-2" };
const rider: Viewer = { userId: "u-rider", role: "RIDER", riderId: "r-1" };
const otherRider: Viewer = { userId: "u-rider2", role: "RIDER", riderId: "r-2" };

const ride = { customerId: "u-cust", driverId: "d-1" };
const waitingRide = { customerId: "u-cust", driverId: null };

const approvedDriver = { isApproved: true, isOnline: true, vehicle: { isApproved: true } };

describe("rideRelation", () => {
  it("knows the customer, the assigned driver and an admin", () => {
    expect(rideRelation(customer, ride)).toBe("CUSTOMER");
    expect(rideRelation(driver, ride)).toBe("DRIVER");
    expect(rideRelation(admin, ride)).toBe("ADMIN");
  });

  it("gives another customer nothing, which the routes answer with 404", () => {
    expect(rideRelation(stranger, ride)).toBeNull();
  });

  it("gives a driver who is not assigned nothing, even though they are a driver", () => {
    expect(rideRelation(otherDriver, ride)).toBeNull();
    expect(rideRelation(otherDriver, waitingRide)).toBeNull();
  });

  it("does not match a driver without a profile to a ride without a driver", () => {
    // null === null must not read as "assigned".
    expect(rideRelation(driverWithoutProfile, waitingRide)).toBeNull();
  });
});

describe("rideListScope", () => {
  it("scopes a customer to their own rides and a driver to their assigned ones", () => {
    expect(rideListScope(customer)).toEqual({ customerId: "u-cust" });
    expect(rideListScope(driver)).toEqual({ driverId: "d-1" });
  });

  it("gives an admin everything and a driver without a profile nothing", () => {
    expect(rideListScope(admin)).toEqual({});
    expect(rideListScope(driverWithoutProfile)).toBeNull();
  });
});

describe("driver standing", () => {
  it("lets an approved driver with an approved vehicle go online", () => {
    expect(goOnlineRefusal(approvedDriver)).toBeNull();
  });

  it("refuses an unapproved operator, a missing vehicle and an unapproved vehicle", () => {
    expect(goOnlineRefusal({ ...approvedDriver, isApproved: false })).toMatch(/not been approved/);
    expect(goOnlineRefusal({ ...approvedDriver, vehicle: null })).toMatch(/vehicle/);
    expect(goOnlineRefusal({ ...approvedDriver, vehicle: { isApproved: false } })).toMatch(/vehicle/);
  });

  it("requires an approved driver to be online before they see or take rides", () => {
    expect(workRefusal(approvedDriver)).toBeNull();
    expect(workRefusal({ ...approvedDriver, isOnline: false })).toMatch(/online/);
  });
});

describe("acceptRefusal", () => {
  it("lets an approved, online driver with no active ride accept someone else's ride", () => {
    expect(acceptRefusal(approvedDriver, 0, otherDriver, waitingRide)).toBeNull();
  });

  it("refuses an unapproved driver, which is the hole threat model RD-5 describes", () => {
    expect(acceptRefusal({ ...approvedDriver, isApproved: false }, 0, otherDriver, waitingRide)).not.toBeNull();
  });

  it("refuses a driver who already has an active ride", () => {
    expect(acceptRefusal(approvedDriver, 1, otherDriver, waitingRide)).toMatch(/current ride/);
  });

  it("refuses a driver accepting a ride they booked themselves", () => {
    expect(acceptRefusal(approvedDriver, 0, otherDriver, { customerId: otherDriver.userId, driverId: null })).toMatch(
      /your own/
    );
  });
});

describe("orderRelation", () => {
  const order = { customerId: "u-cust", store: { merchantId: "m-1" }, delivery: { riderId: "r-1" } };

  it("knows the customer, the store's merchant, the assigned rider and an admin", () => {
    expect(orderRelation(customer, order)).toBe("CUSTOMER");
    expect(orderRelation(merchant, order)).toBe("MERCHANT");
    expect(orderRelation(rider, order)).toBe("RIDER");
    expect(orderRelation(admin, order)).toBe("ADMIN");
  });

  it("gives another customer, another store's merchant and another rider nothing", () => {
    expect(orderRelation(stranger, order)).toBeNull();
    expect(orderRelation(otherMerchant, order)).toBeNull();
    expect(orderRelation(otherRider, order)).toBeNull();
  });

  it("does not treat a rider as assigned to an order no rider has been given", () => {
    const unassigned = { ...order, delivery: { riderId: null } };
    expect(orderRelation({ userId: "x", role: "RIDER", riderId: null }, unassigned)).toBeNull();
    expect(orderRelation(rider, { ...order, delivery: null })).toBeNull();
  });
});

describe("orderListScope", () => {
  it("scopes each role to its own orders", () => {
    expect(orderListScope(customer)).toEqual({ customerId: "u-cust" });
    expect(orderListScope(merchant)).toEqual({ store: { merchantId: "m-1" } });
    expect(orderListScope(rider)).toEqual({ delivery: { riderId: "r-1" } });
    expect(orderListScope(admin)).toEqual({});
  });

  it("gives a merchant or rider without a profile nothing rather than everything", () => {
    expect(orderListScope({ userId: "x", role: "MERCHANT", merchantId: null })).toBeNull();
    expect(orderListScope({ userId: "x", role: "RIDER", riderId: null })).toBeNull();
  });
});

describe("storeOrderRefusal", () => {
  it("takes orders only for an approved store that is open", () => {
    expect(storeOrderRefusal({ isApproved: true, isOpen: true })).toBeNull();
    expect(storeOrderRefusal({ isApproved: true, isOpen: false })).toMatch(/closed/);
    expect(storeOrderRefusal({ isApproved: false, isOpen: true })).not.toBeNull();
  });
});

describe("isAssignedRider", () => {
  it("is true only for the rider the delivery is assigned to", () => {
    expect(isAssignedRider(rider, { riderId: "r-1" })).toBe(true);
    expect(isAssignedRider(otherRider, { riderId: "r-1" })).toBe(false);
    expect(isAssignedRider({ userId: "x", role: "RIDER", riderId: null }, { riderId: null })).toBe(false);
  });
});

describe("firstName", () => {
  it("keeps the first word of a name only", () => {
    expect(firstName("Thandiwe  Test Mokoena")).toBe("Thandiwe");
    expect(firstName("  ")).toBe("Customer");
    expect(firstName(null)).toBe("Customer");
  });
});
