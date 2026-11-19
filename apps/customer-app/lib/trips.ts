/** Group trips to events as the customer app sees them (docs/PLAN.md Phase 3). */

/** One of my seat requests (GET /api/trip-requests). */
export interface MyTrip {
  id: string;
  status: string;
  direction: "TO_EVENT" | "FROM_EVENT";
  seats: number;
  pricePerSeat: number;
  total: number;
  event: { title: string; slug: string; startsAt: string; venue: string };
  pickupPoint: { name: string; address: string; lat: number; lng: number };
  departAt: string | null;
  tripStatus: string | null;
  counter: { pricePerSeat: number; expiresAt: string } | null;
  operator: {
    firstName: string;
    vehicle: { make: string; model: string; color: string; licensePlate: string } | null;
  } | null;
  checkInCode: string | null;
  sharePath: string | null;
}

export const TRIP_STATUS: Record<string, { label: string; color: string }> = {
  WAITING: { label: "Waiting for an operator", color: "#f59e0b" },
  CONFIRMING: { label: "Counter-offer: answer it", color: "#38bdf8" },
  BOOKED: { label: "Booked", color: "#22c55e" },
  BOARDED: { label: "On board", color: "#22c55e" },
  COMPLETED: { label: "Done", color: "#64748b" },
  NO_SHOW: { label: "Missed", color: "#ef4444" },
  DECLINED: { label: "You declined", color: "#64748b" },
  CANCELLED: { label: "Cancelled", color: "#64748b" },
};
