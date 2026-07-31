import {
  recordTrip,
  recordOrder,
  pseudonymise,
  areaOf,
  newEventId,
  isAnalyticsEnabled,
} from "@ride/analytics";
import { logger } from "@/lib/logger";

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

/** Shape needed to emit a trip event — a subset of the Ride model. */
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
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
}

/**
 * Records a trip reaching a terminal state.
 *
 * `actual_duration_minutes` is derived from startedAt→completedAt rather than taken
 * from `durationMinutes`, which holds the *predicted* value written at booking.
 * Keeping the two apart is the entire point — the ETA model needs prediction and
 * outcome as separate columns to have anything to learn from.
 */
export function emitTripEvent(
  ride: TripEventInput,
  fees?: { driverEarnings?: number | null; platformFee?: number | null }
): void {
  if (!isAnalyticsEnabled()) return;
  if (ride.status !== "COMPLETED" && ride.status !== "CANCELLED") return;

  const occurredAt = ride.completedAt ?? ride.cancelledAt ?? new Date();

  void recordTrip(
    {
      event_id: newEventId(),
      ride_id: ride.id,
      occurred_at: occurredAt.toISOString(),
      status: ride.status as "COMPLETED" | "CANCELLED",
      vehicle_type: ride.vehicleType,
      payment_method: ride.paymentMethod,

      pickup_lat: ride.pickupLat || null,
      pickup_lng: ride.pickupLng || null,
      dropoff_lat: ride.dropoffLat || null,
      dropoff_lng: ride.dropoffLng || null,
      pickup_area: areaOf(ride.pickupAddress),
      dropoff_area: areaOf(ride.dropoffAddress),

      distance_km: ride.distanceKm || null,
      estimated_duration_minutes: ride.durationMinutes,
      actual_duration_minutes: minutesBetween(ride.startedAt, ride.completedAt),

      fare_estimate: num(ride.fareEstimate),
      fare_actual: num(ride.fareActual),
      driver_earnings: fees?.driverEarnings ?? null,
      platform_fee: fees?.platformFee ?? null,

      customer_key: pseudonymise(ride.customerId),
      driver_key: pseudonymise(ride.driverId),

      cancel_reason: ride.cancelReason,
      requested_at: iso(ride.createdAt),
      accepted_at: iso(ride.startedAt),
    },
    { logger }
  ).catch(() => {
    /* recordTrip already logs and never rejects; this guards a future change */
  });
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
      delivery_area: areaOf(order.deliveryAddress),
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
