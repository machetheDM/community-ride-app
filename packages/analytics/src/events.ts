/**
 * Event shapes streamed to BigQuery.
 *
 * These mirror `schema/*.json` exactly. If a field is added here it must be added
 * there too, and BigQuery streaming silently drops unknown fields rather than
 * erroring — so a mismatch shows up as quietly missing data, not a failure.
 */

/** One completed or cancelled trip. */
export interface TripEvent {
  event_id: string;
  ride_id: string;
  /** RFC 3339, UTC. */
  occurred_at: string;
  status: "COMPLETED" | "CANCELLED";
  vehicle_type: string;
  payment_method: string;

  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  /**
   * Coarse area label, derived from the pickup address rather than the exact
   * point. Analytics groups by township, and storing a precise home location in a
   * separate analytics store is a privacy liability with no analytical payoff.
   */
  pickup_area: string | null;
  dropoff_area: string | null;

  distance_km: number | null;
  /** What the Maps ETA predicted at booking time. */
  estimated_duration_minutes: number | null;
  /** What the trip actually took. Null when cancelled. */
  actual_duration_minutes: number | null;

  fare_estimate: number | null;
  fare_actual: number | null;
  driver_earnings: number | null;
  platform_fee: number | null;

  /** Hashed, never the raw id — see `pseudonymise`. */
  customer_key: string | null;
  driver_key: string | null;

  cancel_reason: string | null;
  requested_at: string | null;
  accepted_at: string | null;
}

/** One delivered or cancelled marketplace order. */
export interface OrderEvent {
  event_id: string;
  order_id: string;
  occurred_at: string;
  status: "DELIVERED" | "CANCELLED";
  store_id: string;
  store_name: string | null;
  delivery_area: string | null;
  item_count: number;
  subtotal: number | null;
  delivery_fee: number | null;
  total: number | null;
  payment_method: string;
  customer_key: string | null;
  rider_key: string | null;
  minutes_to_deliver: number | null;
}

export type AnalyticsTable = "trips" | "orders";
