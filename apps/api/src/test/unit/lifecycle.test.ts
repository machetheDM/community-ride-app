import { describe, it, expect } from "@jest/globals";
import type {
  RideStatus as DbRideStatus,
  OrderStatus as DbOrderStatus,
  DeliveryStatus as DbDeliveryStatus,
} from "@ride/db";
import {
  RIDE_STATUSES,
  ORDER_STATUSES,
  DELIVERY_STATUSES,
  canTransitionRide,
  canTransitionOrder,
  canTransitionDelivery,
  checkRideTransition,
  checkOrderTransition,
  nextOrderStatuses,
  nextRideStatuses,
  isRideTerminal,
  isOrderTerminal,
  isDeliveryTerminal,
  ORDER_STATUS_FOR_DELIVERY,
  type RideActor,
  type OrderActor,
  type DeliveryActor,
} from "@ride/db/lifecycle";

/**
 * The state machines are the whole defence against "any signed-in user sets any
 * status" (PLAN.md holes 4 and 5), so every cell of every table is checked: each
 * allowed move is listed by hand below, and every other combination of from, to
 * and actor must be refused. Adding a move to the table without adding it here
 * fails this file, which is the point: a new move is a security decision.
 */

const RIDE_ACTORS: RideActor[] = ["CUSTOMER", "DRIVER", "ADMIN"];
const ORDER_ACTORS: OrderActor[] = ["CUSTOMER", "MERCHANT", "ADMIN", "DELIVERY"];
const DELIVERY_ACTORS: DeliveryActor[] = ["RIDER"];

const ALLOWED_RIDE_MOVES = new Set([
  "REQUESTED>ACCEPTED:DRIVER",
  "ACCEPTED>DRIVER_ARRIVED:DRIVER",
  "DRIVER_ARRIVED>IN_PROGRESS:DRIVER",
  "IN_PROGRESS>COMPLETED:DRIVER",
  "REQUESTED>CANCELLED:CUSTOMER",
  "REQUESTED>CANCELLED:ADMIN",
  "ACCEPTED>CANCELLED:CUSTOMER",
  "ACCEPTED>CANCELLED:DRIVER",
  "ACCEPTED>CANCELLED:ADMIN",
  "DRIVER_ARRIVED>CANCELLED:CUSTOMER",
  "DRIVER_ARRIVED>CANCELLED:DRIVER",
  "DRIVER_ARRIVED>CANCELLED:ADMIN",
  "IN_PROGRESS>CANCELLED:ADMIN",
]);

const ALLOWED_ORDER_MOVES = new Set([
  "PENDING>CONFIRMED:MERCHANT",
  "CONFIRMED>PREPARING:MERCHANT",
  "PREPARING>READY_FOR_PICKUP:MERCHANT",
  "READY_FOR_PICKUP>OUT_FOR_DELIVERY:DELIVERY",
  "OUT_FOR_DELIVERY>DELIVERED:DELIVERY",
  "PENDING>CANCELLED:CUSTOMER",
  "PENDING>CANCELLED:MERCHANT",
  "PENDING>CANCELLED:ADMIN",
  "CONFIRMED>CANCELLED:MERCHANT",
  "CONFIRMED>CANCELLED:ADMIN",
  "PREPARING>CANCELLED:MERCHANT",
  "PREPARING>CANCELLED:ADMIN",
  "READY_FOR_PICKUP>CANCELLED:ADMIN",
  "OUT_FOR_DELIVERY>CANCELLED:ADMIN",
]);

const ALLOWED_DELIVERY_MOVES = new Set([
  "ASSIGNED>PICKED_UP:RIDER",
  "PICKED_UP>EN_ROUTE:RIDER",
  "EN_ROUTE>DELIVERED:RIDER",
  "PICKED_UP>FAILED:RIDER",
  "EN_ROUTE>FAILED:RIDER",
]);

function everyMove<S extends string, A extends string>(statuses: readonly S[], actors: readonly A[]) {
  const moves: { from: S; to: S; actor: A; key: string }[] = [];
  for (const from of statuses) {
    for (const to of statuses) {
      for (const actor of actors) moves.push({ from, to, actor, key: `${from}>${to}:${actor}` });
    }
  }
  return moves;
}

describe("the status lists", () => {
  it("match the database enums exactly, so the portal and the API agree with the schema", () => {
    // Compile-time: each side assignable to the other. A status added to the
    // schema but not here (or the reverse) breaks `tsc`.
    const ride: [DbRideStatus] extends [(typeof RIDE_STATUSES)[number]]
      ? [(typeof RIDE_STATUSES)[number]] extends [DbRideStatus]
        ? true
        : false
      : false = true;
    const order: [DbOrderStatus] extends [(typeof ORDER_STATUSES)[number]]
      ? [(typeof ORDER_STATUSES)[number]] extends [DbOrderStatus]
        ? true
        : false
      : false = true;
    const delivery: [DbDeliveryStatus] extends [(typeof DELIVERY_STATUSES)[number]]
      ? [(typeof DELIVERY_STATUSES)[number]] extends [DbDeliveryStatus]
        ? true
        : false
      : false = true;
    expect([ride, order, delivery]).toEqual([true, true, true]);
  });
});

describe("ride lifecycle", () => {
  it("allows exactly the listed moves out of all 108 combinations of from, to and actor", () => {
    const wrong = everyMove(RIDE_STATUSES, RIDE_ACTORS)
      .filter(({ from, to, actor, key }) => canTransitionRide(from, to, actor) !== ALLOWED_RIDE_MOVES.has(key))
      .map(({ key }) => key);
    expect(wrong).toEqual([]);
  });

  it("lets only the assigned driver accept, arrive, start and complete; never an admin or the customer", () => {
    expect(checkRideTransition("IN_PROGRESS", "COMPLETED", "CUSTOMER")).toEqual({ allowed: false, refusal: "NOT_YOUR_MOVE" });
    expect(checkRideTransition("IN_PROGRESS", "COMPLETED", "ADMIN")).toEqual({ allowed: false, refusal: "NOT_YOUR_MOVE" });
    expect(checkRideTransition("REQUESTED", "ACCEPTED", "DRIVER")).toEqual({ allowed: true, action: "ride.accept" });
  });

  it("refuses a skipped step as no such move, so a driver cannot complete a ride they never started", () => {
    expect(checkRideTransition("ACCEPTED", "COMPLETED", "DRIVER")).toEqual({ allowed: false, refusal: "NO_SUCH_MOVE" });
    expect(checkRideTransition("REQUESTED", "COMPLETED", "DRIVER")).toEqual({ allowed: false, refusal: "NO_SUCH_MOVE" });
  });

  it("requires a reason when the driver cancels, and not when the customer does", () => {
    expect(checkRideTransition("ACCEPTED", "CANCELLED", "DRIVER")).toEqual({ allowed: false, refusal: "REASON_REQUIRED" });
    expect(checkRideTransition("DRIVER_ARRIVED", "CANCELLED", "DRIVER")).toEqual({ allowed: false, refusal: "REASON_REQUIRED" });
    expect(checkRideTransition("ACCEPTED", "CANCELLED", "DRIVER", { hasReason: true })).toEqual({
      allowed: true,
      action: "ride.cancel",
    });
    expect(checkRideTransition("ACCEPTED", "CANCELLED", "CUSTOMER")).toEqual({ allowed: true, action: "ride.cancel" });
  });

  it("treats completed and cancelled rides as terminal: nobody can move them anywhere", () => {
    for (const from of ["COMPLETED", "CANCELLED"] as const) {
      expect(isRideTerminal(from)).toBe(true);
      for (const actor of RIDE_ACTORS) expect(nextRideStatuses(from, actor)).toEqual([]);
    }
    expect(isRideTerminal("IN_PROGRESS")).toBe(false);
  });

  it("lets an admin cancel from every non-terminal state", () => {
    for (const from of ["REQUESTED", "ACCEPTED", "DRIVER_ARRIVED", "IN_PROGRESS"] as const) {
      expect(canTransitionRide(from, "CANCELLED", "ADMIN")).toBe(true);
    }
  });
});

describe("order lifecycle", () => {
  it("allows exactly the listed moves out of all 196 combinations of from, to and actor", () => {
    const wrong = everyMove(ORDER_STATUSES, ORDER_ACTORS)
      .filter(({ from, to, actor, key }) => canTransitionOrder(from, to, actor) !== ALLOWED_ORDER_MOVES.has(key))
      .map(({ key }) => key);
    expect(wrong).toEqual([]);
  });

  it("never lets a merchant, customer or admin set out-for-delivery or delivered", () => {
    for (const actor of ["MERCHANT", "CUSTOMER", "ADMIN"] as const) {
      for (const from of ORDER_STATUSES) {
        expect(canTransitionOrder(from, "OUT_FOR_DELIVERY", actor)).toBe(false);
        expect(canTransitionOrder(from, "DELIVERED", actor)).toBe(false);
      }
    }
  });

  it("lets the customer cancel only while the order is pending", () => {
    expect(nextOrderStatuses("PENDING", "CUSTOMER")).toEqual(["CANCELLED"]);
    expect(nextOrderStatuses("CONFIRMED", "CUSTOMER")).toEqual([]);
  });

  it("gives the merchant the buttons the portal should show", () => {
    expect(nextOrderStatuses("PENDING", "MERCHANT")).toEqual(["CONFIRMED", "CANCELLED"]);
    expect(nextOrderStatuses("PREPARING", "MERCHANT")).toEqual(["READY_FOR_PICKUP", "CANCELLED"]);
    expect(nextOrderStatuses("READY_FOR_PICKUP", "MERCHANT")).toEqual([]);
  });

  it("refuses a merchant's move with NOT_YOUR_MOVE when the edge exists for someone else", () => {
    expect(checkOrderTransition("READY_FOR_PICKUP", "OUT_FOR_DELIVERY", "MERCHANT")).toEqual({
      allowed: false,
      refusal: "NOT_YOUR_MOVE",
    });
    expect(checkOrderTransition("DELIVERED", "CANCELLED", "ADMIN")).toEqual({ allowed: false, refusal: "NO_SUCH_MOVE" });
  });

  it("treats delivered and cancelled orders as terminal", () => {
    expect(isOrderTerminal("DELIVERED")).toBe(true);
    expect(isOrderTerminal("CANCELLED")).toBe(true);
    expect(isOrderTerminal("OUT_FOR_DELIVERY")).toBe(false);
  });
});

describe("delivery lifecycle", () => {
  it("allows exactly the listed moves out of all 36 combinations, all of them the assigned rider's", () => {
    const wrong = everyMove(DELIVERY_STATUSES, DELIVERY_ACTORS)
      .filter(({ from, to, actor, key }) => canTransitionDelivery(from, to, actor) !== ALLOWED_DELIVERY_MOVES.has(key))
      .map(({ key }) => key);
    expect(wrong).toEqual([]);
  });

  it("has no move into ASSIGNED, because dispatch is not built yet", () => {
    for (const from of DELIVERY_STATUSES) expect(canTransitionDelivery(from, "ASSIGNED", "RIDER")).toBe(false);
  });

  it("moves the order only along order moves the table gives to the delivery lifecycle", () => {
    for (const step of Object.values(ORDER_STATUS_FOR_DELIVERY)) {
      if (!step || step.from === step.to) continue;
      expect(canTransitionOrder(step.from, step.to, "DELIVERY")).toBe(true);
    }
    expect(ORDER_STATUS_FOR_DELIVERY.FAILED).toBeUndefined();
  });

  it("treats delivered and failed deliveries as terminal", () => {
    expect(isDeliveryTerminal("DELIVERED")).toBe(true);
    expect(isDeliveryTerminal("FAILED")).toBe(true);
    expect(isDeliveryTerminal("EN_ROUTE")).toBe(false);
  });
});
