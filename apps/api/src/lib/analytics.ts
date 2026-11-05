import {
  recordTrip,
  recordOrder,
  pseudonymise,
  newEventId,
  isAnalyticsEnabled,
  type TripEvent,
} from "@ride/analytics";
import { logger } from "@/lib/logger";
import { coarseArea, roundCoordinate } from "@/lib/geo";

/**
 * Emits trip and order events to BigQuery.
 *
 * Every function here is fire-and-forget by construction: they resolve, never
 * reject, and callers do not await them into the response path. A ride completing
 * is the operation that matters — recording it for analysis is not allowed to slow
 * it down or fail it.
 *
 * With `BIGQUERY_DATASET` unset these are no-ops, so local development and CI are
 * unaffected.
 */

export { isAnalyticsEnabled };

/** Prisma returns Decimal columns as Decimal instances, not numbers. */
function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(String(value));
  return Number.isFinite(n) ? n : null;
}

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

function minutesBetween(from: Date | null | undefined, to: Date | null | undefined): number | null {
  if (!from || !to) return null;
  const minutes = Math.round((to.getTime() - from.getTime()) / 60_000);
  return minutes >= 0 ? minutes : null;
}

/**
 * Shape needed to emit a trip event — a subset of the Ride model.
 *
 * `cancelReason` is deliberately absent. It is free text a customer or driver
 * typed, and people type names, phone numbers and addresses into reason boxes;
 * sitting next to a stable pseudonymous key in BigQuery that is personal data
 * again (threat model AN-2). Who cancelled is what the analysis needs.
 */
export interface TripEventInput {
  id: string;
  status: string;
  customerId: string;
  driverId: string | null;
  vehicleType: string;
  paymentMethod: string;
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffAddress: string;
  distanceKm: number;
  durationMinutes: number | null;
  fareEstimate: unknown;
  fareActual: unknown;
  createdAt: Date;
  acceptedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
}

/**
 * The `cancel_reason` column now carries a code for who cancelled, never the
 * typed reason. The column keeps its name because the table schema belongs to
 * `packages/analytics`; its meaning is documented here and in the commit.
 */
export function cancelCode(ride: Pick<TripEventInput, "status" | "cancelledBy">): string | null {
  if (ride.status !== "CANCELLED") return null;
  switch (ride.cancelledBy) {
    case "CUSTOMER":
    case "DRIVER":
    case "ADMIN":
      return `CANCELLED_BY_${ride.cancelledBy}`;
    default:
      return "CANCELLED_BY_UNKNOWN";
  }
}

/**
 * Records a trip reaching a terminal state.
 *
 * `actual_duration_minutes` is derived from startedAt→completedAt rather than taken
 * from `durationMinutes`, which holds the *predicted* value written at booking.
 * Keeping the two apart is the entire point — the ETA model needs prediction and
 * outcome as separate columns to have anything to learn from.
 *
 * Coordinates are rounded to two decimals (about 1 km). An exact pickup is often
 * someone's front door, and a front door next to a stable pseudonymous key
 * re-identifies the customer; a 1 km cell is still enough for demand maps and the
 * ETA model's area features (threat model AN-2).
 */
export function emitTripEvent(
  ride: TripEventInput,
  fees?: { driverEarnings?: number | null; platformFee?: number | null }
): void {
  if (!isAnalyticsEnabled()) return;
  if (ride.status !== "COMPLETED" && ride.status !== "CANCELLED") return;

  void recordTrip(tripEventRow(ride, fees), { logger }).catch(() => {
    /* recordTrip already logs and never rejects; this guards a future change */
  });
}

/**
 * The BigQuery row for a terminal ride. Split from `emitTripEvent` so a unit
 * test can check what leaves the system without a BigQuery client.
 */
export function tripEventRow(
  ride: TripEventInput,
  fees?: { driverEarnings?: number | null; platformFee?: number | null }
): TripEvent {
  const occurredAt = ride.completedAt ?? ride.cancelledAt ?? new Date();

  return {
    event_id: newEventId(),
    ride_id: ride.id,
    occurred_at: occurredAt.toISOString(),
    status: ride.status as "COMPLETED" | "CANCELLED",
    vehicle_type: ride.vehicleType,
    payment_method: ride.paymentMethod,

    pickup_lat: roundCoordinate(ride.pickupLat),
    pickup_lng: roundCoordinate(ride.pickupLng),
    dropoff_lat: roundCoordinate(ride.dropoffLat),
    dropoff_lng: roundCoordinate(ride.dropoffLng),
    // `coarseArea`, not the package's `areaOf`: for an address with no comma
    // `areaOf` returns the whole address, street number and all.
    pickup_area: coarseArea(ride.pickupAddress),
    dropoff_area: coarseArea(ride.dropoffAddress),

    distance_km: ride.distanceKm || null,
    estimated_duration_minutes: ride.durationMinutes,
    actual_duration_minutes: minutesBetween(ride.startedAt, ride.completedAt),

    fare_estimate: num(ride.fareEstimate),
    fare_actual: num(ride.fareActual),
    driver_earnings: fees?.driverEarnings ?? null,
    platform_fee: fees?.platformFee ?? null,

    customer_key: pseudonymise(ride.customerId),
    driver_key: pseudonymise(ride.driverId),

    cancel_reason: cancelCode(ride),
    requested_at: iso(ride.createdAt),
    // Was `startedAt`, from before the schema had an acceptance time, which
    // made "time to accept" in BigQuery really "time to pickup".
    accepted_at: iso(ride.acceptedAt),
  };
}

/** Shape needed to emit an order event — a subset of the Order model. */
export interface OrderEventInput {
  id: string;
  status: string;
  customerId: string;
  storeId: string;
  storeName: string | null;
  deliveryAddress: string;
  itemCount: number;
  subtotal: unknown;
  deliveryFee: unknown;
  total: unknown;
  paymentMethod: string;
  riderId: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
}

export function emitOrderEvent(order: OrderEventInput): void {
  if (!isAnalyticsEnabled()) return;
  if (order.status !== "DELIVERED" && order.status !== "CANCELLED") return;

  const occurredAt = order.deliveredAt ?? order.cancelledAt ?? new Date();

  void recordOrder(
    {
      event_id: newEventId(),
      order_id: order.id,
      occurred_at: occurredAt.toISOString(),
      status: order.status as "DELIVERED" | "CANCELLED",
      store_id: order.storeId,
      store_name: order.storeName,
      delivery_area: coarseArea(order.deliveryAddress),
      item_count: order.itemCount,
      subtotal: num(order.subtotal),
      delivery_fee: num(order.deliveryFee),
      total: num(order.total),
      payment_method: order.paymentMethod,
      customer_key: pseudonymise(order.customerId),
      rider_key: pseudonymise(order.riderId),
      minutes_to_deliver: minutesBetween(order.createdAt, order.deliveredAt),
    },
    { logger }
  ).catch(() => {
    /* recordOrder already logs and never rejects */
  });
}
