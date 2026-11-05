/**
 * The ride, order and delivery state machines: which status may follow which,
 * and who may move it there.
 *
 * Before this table existed, `PATCH /api/rides/[id]` and
 * `PATCH /api/orders/[id]/status` wrote whatever status the caller sent. Any
 * signed-in user could complete a stranger's trip, take a cancelled order back
 * to PREPARING, or mark food delivered that never left the shop (PLAN.md section
 * 2, holes 4 and 5). A route now asks this file first, then makes the change as
 * one conditional write on the status it read, so the answer cannot go stale
 * between the check and the write.
 *
 * Pure TypeScript with no import of the Prisma client, on purpose: the merchant
 * portal and the apps can import `@ride/db/lifecycle` to decide which buttons to
 * show without pulling a database driver into their bundle. The status names are
 * repeated here rather than imported from the generated client for the same
 * reason; a unit test in the API checks that they still match the schema.
 *
 * The table says whether a kind of actor may make a move. Whether this
 * particular person is that actor (the ride's own customer, its assigned
 * driver, the store's merchant) is the route's question, answered in
 * `apps/api/src/lib/policy.ts`.
 */

// ─── Statuses ─────────────────────────────────────────────────

export const RIDE_STATUSES = [
  "REQUESTED",
  "ACCEPTED",
  "DRIVER_ARRIVED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];

export const ORDER_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_PICKUP",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const DELIVERY_STATUSES = [
  "PENDING",
  "ASSIGNED",
  "PICKED_UP",
  "EN_ROUTE",
  "DELIVERED",
  "FAILED",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** A ride the customer is waiting on or riding in. */
export const ACTIVE_RIDE_STATUSES: readonly RideStatus[] = [
  "REQUESTED",
  "ACCEPTED",
  "DRIVER_ARRIVED",
  "IN_PROGRESS",
];

/**
 * A driver is attached and the trip is under way. Only in these states may the
 * customer and the driver see each other's phone number: before acceptance there
 * is nobody to call, and after the trip there is no reason to.
 */
export const ACTIVE_TRIP_STATUSES: readonly RideStatus[] = ["ACCEPTED", "DRIVER_ARRIVED", "IN_PROGRESS"];

export const TERMINAL_RIDE_STATUSES: readonly RideStatus[] = ["COMPLETED", "CANCELLED"];
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = ["DELIVERED", "CANCELLED"];
export const TERMINAL_DELIVERY_STATUSES: readonly DeliveryStatus[] = ["DELIVERED", "FAILED"];

// ─── Actors ───────────────────────────────────────────────────

/**
 * Who is asking, relative to the ride. DRIVER means the ride's assigned driver,
 * except for the accept move, where it means a driver who passed the
 * eligibility check (approved, online, approved vehicle, no other active ride).
 */
export type RideActor = "CUSTOMER" | "DRIVER" | "ADMIN";

/**
 * Who is asking, relative to the order. MERCHANT is the merchant who owns the
 * order's store. DELIVERY is not a person: it is the delivery lifecycle moving
 * the order along when the assigned rider picks it up or hands it over, which
 * is the only way an order reaches OUT_FOR_DELIVERY or DELIVERED.
 */
export type OrderActor = "CUSTOMER" | "MERCHANT" | "ADMIN" | "DELIVERY";

/** The rider assigned to the delivery. Dispatch (PENDING to ASSIGNED) is Phase 2. */
export type DeliveryActor = "RIDER";

export interface Transition<S extends string, A extends string> {
  from: S;
  to: S;
  /** Audit action name, e.g. `ride.accept`. */
  action: string;
  actors: readonly A[];
  /** Actors who must give a reason for this move. */
  reasonRequiredFor?: readonly A[];
}

// ─── Rides ────────────────────────────────────────────────────

const RIDE_CANCEL = "ride.cancel";

export const RIDE_TRANSITIONS: readonly Transition<RideStatus, RideActor>[] = [
  { from: "REQUESTED", to: "ACCEPTED", action: "ride.accept", actors: ["DRIVER"] },
  { from: "ACCEPTED", to: "DRIVER_ARRIVED", action: "ride.arrive", actors: ["DRIVER"] },
  { from: "DRIVER_ARRIVED", to: "IN_PROGRESS", action: "ride.start", actors: ["DRIVER"] },
  { from: "IN_PROGRESS", to: "COMPLETED", action: "ride.complete", actors: ["DRIVER"] },

  // A customer may walk away until the trip starts. A driver may drop a trip
  // they accepted, but must say why: a driver who accepts and cancels to cherry-
  // pick fares is a pattern an admin needs the reasons to see. Once the customer
  // is in the car only an admin can end the trip other than by completing it.
  { from: "REQUESTED", to: "CANCELLED", action: RIDE_CANCEL, actors: ["CUSTOMER", "ADMIN"] },
  {
    from: "ACCEPTED",
    to: "CANCELLED",
    action: RIDE_CANCEL,
    actors: ["CUSTOMER", "DRIVER", "ADMIN"],
    reasonRequiredFor: ["DRIVER"],
  },
  {
    from: "DRIVER_ARRIVED",
    to: "CANCELLED",
    action: RIDE_CANCEL,
    actors: ["CUSTOMER", "DRIVER", "ADMIN"],
    reasonRequiredFor: ["DRIVER"],
  },
  { from: "IN_PROGRESS", to: "CANCELLED", action: RIDE_CANCEL, actors: ["ADMIN"] },
];

// ─── Orders ───────────────────────────────────────────────────

const ORDER_CANCEL = "order.cancel";

export const ORDER_TRANSITIONS: readonly Transition<OrderStatus, OrderActor>[] = [
  { from: "PENDING", to: "CONFIRMED", action: "order.confirm", actors: ["MERCHANT"] },
  { from: "CONFIRMED", to: "PREPARING", action: "order.prepare", actors: ["MERCHANT"] },
  { from: "PREPARING", to: "READY_FOR_PICKUP", action: "order.ready", actors: ["MERCHANT"] },

  // Set only by the delivery lifecycle: the rider's pickup and handover. A
  // merchant who could set these could mark an order delivered with no rider and
  // no customer (threat model OD-4).
  { from: "READY_FOR_PICKUP", to: "OUT_FOR_DELIVERY", action: "order.out_for_delivery", actors: ["DELIVERY"] },
  { from: "OUT_FOR_DELIVERY", to: "DELIVERED", action: "order.delivered", actors: ["DELIVERY"] },

  // The customer may cancel only before the store has accepted the work; after
  // that the store has spent money on it. The merchant may cancel until the food
  // is ready. An admin may cancel anything not yet finished.
  { from: "PENDING", to: "CANCELLED", action: ORDER_CANCEL, actors: ["CUSTOMER", "MERCHANT", "ADMIN"] },
  { from: "CONFIRMED", to: "CANCELLED", action: ORDER_CANCEL, actors: ["MERCHANT", "ADMIN"] },
  { from: "PREPARING", to: "CANCELLED", action: ORDER_CANCEL, actors: ["MERCHANT", "ADMIN"] },
  { from: "READY_FOR_PICKUP", to: "CANCELLED", action: ORDER_CANCEL, actors: ["ADMIN"] },
  { from: "OUT_FOR_DELIVERY", to: "CANCELLED", action: ORDER_CANCEL, actors: ["ADMIN"] },
];

// ─── Deliveries ───────────────────────────────────────────────

export const DELIVERY_TRANSITIONS: readonly Transition<DeliveryStatus, DeliveryActor>[] = [
  { from: "ASSIGNED", to: "PICKED_UP", action: "delivery.pick_up", actors: ["RIDER"] },
  { from: "PICKED_UP", to: "EN_ROUTE", action: "delivery.en_route", actors: ["RIDER"] },
  { from: "EN_ROUTE", to: "DELIVERED", action: "delivery.deliver", actors: ["RIDER"] },
  { from: "PICKED_UP", to: "FAILED", action: "delivery.fail", actors: ["RIDER"] },
  { from: "EN_ROUTE", to: "FAILED", action: "delivery.fail", actors: ["RIDER"] },
];

/**
 * What a delivery move does to its order. The two statuses track different
 * things (the store's view and the rider's) and are written in the same
 * transaction so they cannot drift. FAILED leaves the order where it is: there
 * is no failed order status, and an admin decides whether to cancel or retry.
 */
export const ORDER_STATUS_FOR_DELIVERY: Readonly<
  Partial<Record<DeliveryStatus, { from: OrderStatus; to: OrderStatus }>>
> = {
  PICKED_UP: { from: "READY_FOR_PICKUP", to: "OUT_FOR_DELIVERY" },
  EN_ROUTE: { from: "OUT_FOR_DELIVERY", to: "OUT_FOR_DELIVERY" },
  DELIVERED: { from: "OUT_FOR_DELIVERY", to: "DELIVERED" },
};

// ─── Checks ───────────────────────────────────────────────────

/**
 * Why a move was refused. The API maps these to status codes: NO_SUCH_MOVE to
 * 409 (the record is not in a state that allows it), NOT_YOUR_MOVE to 403 (it
 * is, but not by you) and REASON_REQUIRED to 400.
 */
export type TransitionRefusal = "NO_SUCH_MOVE" | "NOT_YOUR_MOVE" | "REASON_REQUIRED";

export type TransitionCheck =
  | { allowed: true; action: string }
  | { allowed: false; refusal: TransitionRefusal };

function check<S extends string, A extends string>(
  table: readonly Transition<S, A>[],
  from: S,
  to: S,
  actor: A,
  hasReason: boolean
): TransitionCheck {
  const move = table.find((t) => t.from === from && t.to === to);
  if (!move) return { allowed: false, refusal: "NO_SUCH_MOVE" };
  if (!move.actors.includes(actor)) return { allowed: false, refusal: "NOT_YOUR_MOVE" };
  if (move.reasonRequiredFor?.includes(actor) && !hasReason) {
    return { allowed: false, refusal: "REASON_REQUIRED" };
  }
  return { allowed: true, action: move.action };
}

export function checkRideTransition(
  from: RideStatus,
  to: RideStatus,
  actor: RideActor,
  options: { hasReason?: boolean } = {}
): TransitionCheck {
  return check(RIDE_TRANSITIONS, from, to, actor, options.hasReason ?? false);
}

export function checkOrderTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: OrderActor,
  options: { hasReason?: boolean } = {}
): TransitionCheck {
  return check(ORDER_TRANSITIONS, from, to, actor, options.hasReason ?? false);
}

export function checkDeliveryTransition(
  from: DeliveryStatus,
  to: DeliveryStatus,
  actor: DeliveryActor,
  options: { hasReason?: boolean } = {}
): TransitionCheck {
  return check(DELIVERY_TRANSITIONS, from, to, actor, options.hasReason ?? false);
}

/** True when `actor` may move a ride from `from` to `to`, a reason given if one is needed. */
export function canTransitionRide(from: RideStatus, to: RideStatus, actor: RideActor): boolean {
  return checkRideTransition(from, to, actor, { hasReason: true }).allowed;
}

/**
 * True when `actor` may move an order from `from` to `to`. The merchant portal
 * uses this to decide which buttons a merchant sees, and the API uses the same
 * table to refuse anything else, so the two cannot disagree.
 */
export function canTransitionOrder(from: OrderStatus, to: OrderStatus, actor: OrderActor): boolean {
  return checkOrderTransition(from, to, actor, { hasReason: true }).allowed;
}

export function canTransitionDelivery(from: DeliveryStatus, to: DeliveryStatus, actor: DeliveryActor): boolean {
  return checkDeliveryTransition(from, to, actor, { hasReason: true }).allowed;
}

/** The statuses `actor` may move a ride to from `from`. */
export function nextRideStatuses(from: RideStatus, actor: RideActor): RideStatus[] {
  return RIDE_TRANSITIONS.filter((t) => t.from === from && t.actors.includes(actor)).map((t) => t.to);
}

/** The statuses `actor` may move an order to from `from`, for the portal's buttons. */
export function nextOrderStatuses(from: OrderStatus, actor: OrderActor): OrderStatus[] {
  return ORDER_TRANSITIONS.filter((t) => t.from === from && t.actors.includes(actor)).map((t) => t.to);
}

export function isRideTerminal(status: RideStatus): boolean {
  return TERMINAL_RIDE_STATUSES.includes(status);
}

export function isOrderTerminal(status: OrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

export function isDeliveryTerminal(status: DeliveryStatus): boolean {
  return TERMINAL_DELIVERY_STATUSES.includes(status);
}
