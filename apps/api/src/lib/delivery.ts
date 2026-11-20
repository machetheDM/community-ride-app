import { randomInt, timingSafeEqual } from "node:crypto";
import { decryptField, encryptField } from "@ride/db/crypto";
// Type-only: importing @ride/db as a value builds the database client, which a
// unit test of these rules must not need.
import type { Prisma } from "@ride/db";
import { haversineKm } from "@/lib/geo";

type Money = Prisma.Decimal | string | number;

/**
 * The rules of local delivery (docs/PLAN.md Phase 2), kept free of the database
 * so each can be tested on its own: the handover code, the complex's fee and
 * zone, and how far a rider may be offered work.
 */

// ─── Handover code ────────────────────────────────────────────

/** Wrong codes allowed before a delivery can no longer be completed by code. */
export const HANDOVER_MAX_ATTEMPTS = 5;

/**
 * A new 4-digit code, from the CSPRNG, stored encrypted.
 *
 * Four digits are enough because guessing is capped: five tries in ten thousand
 * is a 0.05% chance, and the attempts counter is in the database, not in the
 * rider's app.
 */
export function newHandoverCode(): { code: string; stored: string } {
  const code = randomInt(0, 10_000).toString().padStart(4, "0");
  return { code, stored: encryptField(code) };
}

/** The code for the customer's own screen, or null when there is none to show. */
export function revealHandoverCode(stored: string | null): string | null {
  if (!stored) return null;
  try {
    return decryptField(stored);
  } catch {
    // An unreadable code (a key rotated without re-encryption) must not break the
    // customer's order screen; the rider will be unable to complete by code, and
    // support can, which is the safe direction to fail.
    return null;
  }
}

export type HandoverCheck = "OK" | "WRONG" | "LOCKED" | "MISSING";

/**
 * Whether the code a rider entered matches.
 *
 * LOCKED is checked first, so a correct code after the limit still fails: the
 * limit would be worthless if the sixth guess could still succeed. MISSING is a
 * delivery with no stored code (one created before codes existed); it cannot be
 * completed by code either, and goes to support.
 */
export function checkHandoverCode(stored: string | null, attempts: number, entered: string): HandoverCheck {
  if (attempts >= HANDOVER_MAX_ATTEMPTS) return "LOCKED";
  const expected = revealHandoverCode(stored);
  if (expected === null) return "MISSING";
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(entered, "utf8");
  return a.length === b.length && timingSafeEqual(a, b) ? "OK" : "WRONG";
}

// ─── Complex: fee and zone ────────────────────────────────────

export interface StoreForPricing {
  deliveryFee: Money;
  lat: number;
  lng: number;
  complex: {
    deliveryFee: Money;
    deliveryRadiusKm: number;
    lat: number;
    lng: number;
    isActive: boolean;
  } | null;
}

/**
 * What the customer pays for delivery: the complex's fee for a store in an active
 * complex, the store's own fee otherwise. One fee per complex is the product
 * (PLAN.md §4, lane 2): the same price for bread or a phone charger from the
 * same mall. Returned as stored; the caller wraps it in `Prisma.Decimal`.
 */
export function deliveryFeeFor(store: StoreForPricing): Money {
  return store.complex?.isActive ? store.complex.deliveryFee : store.deliveryFee;
}

/**
 * Why an address is outside the store's delivery zone, or null when it is inside.
 *
 * Only a store in an active complex has a zone. A stand-alone shop keeps the
 * behaviour it had: no radius, because it never declared one.
 */
export function outsideZoneRefusal(store: StoreForPricing, point: { lat: number; lng: number }): string | null {
  const complex = store.complex;
  if (!complex?.isActive) return null;
  const km = haversineKm({ lat: complex.lat, lng: complex.lng }, point);
  if (km <= complex.deliveryRadiusKm) return null;
  return `This address is ${km.toFixed(1)} km from the complex; deliveries go up to ${complex.deliveryRadiusKm} km`;
}

// ─── Dispatch ─────────────────────────────────────────────────

/** How far from a rider a waiting delivery is offered; one value with the push to riders. */
export { DISPATCH_RADIUS_KM } from "@ride/db/dispatch";

/** Delivery statuses during which the rider holds the job (and its customer's details). */
export const ACTIVE_DELIVERY_STATUSES = ["ASSIGNED", "PICKED_UP", "EN_ROUTE"] as const;

/** Statuses during which the customer sees where the rider is: after pickup, before handover. */
export const TRACKED_DELIVERY_STATUSES = ["PICKED_UP", "EN_ROUTE"] as const;

/** Order statuses a rider may accept a delivery from: the store has said yes and has not cancelled. */
export const DISPATCHABLE_ORDER_STATUSES = ["CONFIRMED", "PREPARING", "READY_FOR_PICKUP"] as const;

export function isActiveDelivery(status: string): boolean {
  return (ACTIVE_DELIVERY_STATUSES as readonly string[]).includes(status);
}

export function isTrackedDelivery(status: string): boolean {
  return (TRACKED_DELIVERY_STATUSES as readonly string[]).includes(status);
}

/** One decimal place of km: enough to choose a job, too coarse to locate anyone. */
export function roundKm(km: number): number {
  return Math.round(km * 10) / 10;
}
