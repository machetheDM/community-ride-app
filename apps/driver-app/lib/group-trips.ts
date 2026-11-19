/** Group trips to events as the operator app sees them (docs/PLAN.md Phase 3.6 to 3.9). */

/** An open trip an operator could take (GET /api/group-trips/available). */
export interface TripOffer {
  id: string;
  status: string;
  direction: "TO_EVENT" | "FROM_EVENT";
  departAt: string;
  event: { title: string; startsAt: string; venue: string };
  pickupPoint: { name: string; address: string; lat: number; lng: number };
  distanceKm: number;
  seats: number;
  total: number;
  lowestPerSeat: number | null;
  floorPerSeat: number;
  passengers: number;
}

/** One of the operator's own trips (GET /api/group-trips/mine). */
export interface OperatorTrip extends TripOffer {
  counterPricePerSeat: number | null;
  counterExpiresAt: string | null;
  passengerList: { id: string; firstName: string; seats: number; pricePerSeat: number; status: string }[];
}

export interface Standing {
  refusal: string | null;
  seats: number;
  owed: number;
  missingDocuments: string[];
}

export const DOCUMENT_LABELS: Record<string, string> = {
  DRIVING_PERMIT: "Driving permit (PrDP)",
  OPERATING_LICENCE: "Operating licence",
  VEHICLE_LICENCE: "Vehicle licence disc",
  INSURANCE: "Passenger insurance",
};

export function sastDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
