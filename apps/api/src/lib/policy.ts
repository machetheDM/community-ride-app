import type { UserRoleName } from "@/lib/auth";

/**
 * Who may see and touch which record (OWASP API1, broken object-level
 * authorisation; PRACTICES.md SEC-3).
 *
 * Small pure functions with no database access, so every rule has a unit test
 * and every route asks the same question the same way. Before this file each
 * route decided for itself, and most decided nothing: the ride and order lists
 * filtered by the caller only when a token happened to be present, so calling
 * without one returned every customer's trips (PLAN.md section 2, hole 1).
 *
 * The routes load the facts (the caller from `requireActiveUser`, their driver,
 * merchant or rider profile, the record's owner columns) and these functions
 * decide. A `null` answer means "not yours", which the routes report as 404
 * rather than 403 so that a guessed id is not confirmed to exist.
 */

/** The caller, with the profile ids their role carries. */
export interface Viewer {
  userId: string;
  role: UserRoleName;
  /** Set only when the role is DRIVER and a driver profile exists. */
  driverId?: string | null;
  /** Set only when the role is MERCHANT and a merchant profile exists. */
  merchantId?: string | null;
  /** Set only when the role is RIDER and a rider profile exists. */
  riderId?: string | null;
}

// ─── Rides ────────────────────────────────────────────────────

export type RideRelation = "CUSTOMER" | "DRIVER" | "ADMIN";

export interface RideOwnership {
  customerId: string;
  driverId: string | null;
}

/**
 * How the caller stands to a ride, or null when it is none of their business.
 *
 * An admin is always ADMIN, even on a ride they booked: the role is what the
 * audit trail records, and an admin who also rides should not lose the power to
 * cancel a trip in progress because they happen to be in the car.
 */
export function rideRelation(viewer: Viewer, ride: RideOwnership): RideRelation | null {
  if (viewer.role === "ADMIN") return "ADMIN";
  if (viewer.driverId && ride.driverId === viewer.driverId) return "DRIVER";
  if (ride.customerId === viewer.userId) return "CUSTOMER";
  return null;
}

/** Prisma `where` that limits a ride list to what the caller may see; null when nothing. */
export function rideListScope(viewer: Viewer): { customerId: string } | { driverId: string } | Record<string, never> | null {
  if (viewer.role === "ADMIN") return {};
  if (viewer.role === "DRIVER") return viewer.driverId ? { driverId: viewer.driverId } : null;
  return { customerId: viewer.userId };
}

/** The facts about a driver that decide whether they may work. */
export interface DriverStanding {
  isApproved: boolean;
  isOnline: boolean;
  vehicle: { isApproved: boolean } | null;
}

/**
 * Why a driver may not go online, or null when they may.
 *
 * An admin approves the operator and, separately, the vehicle (PLAN.md 3.7).
 * Without this check an operator signed up an hour ago could go online and take
 * the first ride (threat model RD-5, RD-8).
 */
export function goOnlineRefusal(driver: Omit<DriverStanding, "isOnline">): string | null {
  if (!driver.isApproved) return "Your operator account has not been approved yet";
  if (!driver.vehicle) return "Register a vehicle before going online";
  if (!driver.vehicle.isApproved) return "Your vehicle has not been approved yet";
  return null;
}

/** Why a driver may not see or take waiting rides, or null when they may. */
export function workRefusal(driver: DriverStanding): string | null {
  const standing = goOnlineRefusal(driver);
  if (standing) return standing;
  if (!driver.isOnline) return "Go online to see and accept rides";
  return null;
}

/**
 * Why this driver may not accept this ride, or null when they may.
 *
 * One active ride at a time: a driver holding two accepted rides leaves one
 * customer waiting for a car that is not coming. A driver may not accept a ride
 * they booked themselves, which is how a fare and a rating would be faked.
 */
export function acceptRefusal(
  driver: DriverStanding,
  otherActiveRides: number,
  viewer: Viewer,
  ride: RideOwnership
): string | null {
  const standing = workRefusal(driver);
  if (standing) return standing;
  if (otherActiveRides > 0) return "Finish your current ride before accepting another";
  if (ride.customerId === viewer.userId) return "You cannot accept your own ride request";
  return null;
}

// ─── Orders ───────────────────────────────────────────────────

export type OrderRelation = "CUSTOMER" | "MERCHANT" | "RIDER" | "ADMIN";

export interface OrderOwnership {
  customerId: string;
  store: { merchantId: string };
  delivery: { riderId: string | null } | null;
}

/**
 * How the caller stands to an order, or null.
 *
 * The merchant is matched through the store (Order to Store.merchantId), never
 * through anything the request says about itself: the old portal trusted a
 * merchant id from a cookie, and the public store list handed that id out.
 */
export function orderRelation(viewer: Viewer, order: OrderOwnership): OrderRelation | null {
  if (viewer.role === "ADMIN") return "ADMIN";
  if (viewer.merchantId && order.store.merchantId === viewer.merchantId) return "MERCHANT";
  if (viewer.riderId && order.delivery?.riderId === viewer.riderId) return "RIDER";
  if (order.customerId === viewer.userId) return "CUSTOMER";
  return null;
}

type OrderScope =
  | Record<string, never>
  | { customerId: string }
  | { store: { merchantId: string } }
  | { delivery: { riderId: string } };

/** Prisma `where` that limits an order list to what the caller may see; null when nothing. */
export function orderListScope(viewer: Viewer): OrderScope | null {
  if (viewer.role === "ADMIN") return {};
  if (viewer.role === "MERCHANT") return viewer.merchantId ? { store: { merchantId: viewer.merchantId } } : null;
  if (viewer.role === "RIDER") return viewer.riderId ? { delivery: { riderId: viewer.riderId } } : null;
  return { customerId: viewer.userId };
}

/** The facts about a store that decide whether it can take an order. */
export interface StoreStanding {
  isApproved: boolean;
  isOpen: boolean;
}

/** Why a store may not take an order now, or null when it may. */
export function storeOrderRefusal(store: StoreStanding): string | null {
  if (!store.isApproved) return "Store not found";
  if (!store.isOpen) return "This store is closed right now";
  return null;
}

// ─── Deliveries ───────────────────────────────────────────────

/** Only the rider the delivery is assigned to may move it. */
export function isAssignedRider(viewer: Viewer, delivery: { riderId: string | null }): boolean {
  return Boolean(viewer.riderId) && delivery.riderId === viewer.riderId;
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * The first word of a name. What a driver sees of a customer, and a merchant of
 * the person they cook for: enough to greet them at the door, not enough to look
 * them up.
 */
export function firstName(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first || "Customer";
}
