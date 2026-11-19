import { randomInt } from "node:crypto";

/**
 * The rules of event group trips (docs/PLAN.md Phase 3), as pure functions so
 * every one is tested on its own and the API and portal cannot disagree: seat
 * counts, the price floor and suggested range, pooling, and when a group trip is
 * worth an operator's while. No database import.
 */

export type VehicleTypeName = "SEDAN" | "MINIVAN" | "BAKKIE" | "SCOOTER" | "BICYCLE" | "MINIBUS";

/** Passenger seats by vehicle type, when the vehicle does not say. */
export const DEFAULT_SEATS: Record<VehicleTypeName, number> = {
  SEDAN: 4,
  MINIVAN: 7,
  BAKKIE: 2,
  SCOOTER: 0,
  BICYCLE: 0,
  MINIBUS: 15,
};

export function seatsOf(vehicle: { type: string; seats: number | null }): number {
  if (typeof vehicle.seats === "number" && vehicle.seats > 0) return vehicle.seats;
  return DEFAULT_SEATS[vehicle.type as VehicleTypeName] ?? 0;
}

/** Most seats one passenger may ask for: a family, not a block booking. */
export const MAX_SEATS_PER_REQUEST = 6;

// ─── Price floor and suggestion ───────────────────────────────

/**
 * The rate a seat is priced from, per km, and the least a seat can cost.
 *
 * Derived from the minibus's running cost the way a taxi fare is: about R1.20 a
 * seat per km at township fares, and never under R20 a seat, which is roughly the
 * shortest local taxi fare. These are the starting values in the plan, to be
 * replaced by measured acceptance (PLAN.md 7.2); they live here so one change
 * moves the floor everywhere.
 */
export const SEAT_RATE_PER_KM = 1.2;
export const SEAT_FLOOR_MINIMUM = 20;
/** The suggested range runs from the floor to this multiple of it. */
export const SUGGESTED_MULTIPLE = 1.5;

export interface SeatPrice {
  floor: number;
  suggestedLow: number;
  suggestedHigh: number;
}

/** Rounded up to the next R5, so the numbers people see are the ones they would say. */
function roundUp5(value: number): number {
  return Math.ceil(value / 5) * 5;
}

/**
 * The floor per seat and the suggested range for a trip of `km` (straight line
 * between the pickup point and the venue, times 1.3 for roads).
 *
 * A floor exists so an offer never falls below what covers the operator's fuel
 * and our fee (threat model PL-1); it is enforced on the server, not only shown
 * in the app.
 */
export function seatPrice(straightLineKm: number): SeatPrice {
  const roadKm = Math.max(0, straightLineKm) * 1.3;
  const floor = roundUp5(Math.max(SEAT_FLOOR_MINIMUM, roadKm * SEAT_RATE_PER_KM));
  return { floor, suggestedLow: floor, suggestedHigh: roundUp5(floor * SUGGESTED_MULTIPLE) };
}

/** Why a price per seat is refused, or null when it stands. */
export function priceRefusal(pricePerSeat: number, price: SeatPrice): string | null {
  if (!Number.isFinite(pricePerSeat) || pricePerSeat <= 0) return "Offer a price per seat in rands";
  if (pricePerSeat < price.floor) return `The least a seat on this trip can go for is R${price.floor}`;
  if (pricePerSeat > price.floor * 5) return `R${pricePerSeat} a seat is more than this trip needs`;
  return null;
}

// ─── Pooling ──────────────────────────────────────────────────

/** Requests are pooled per event, direction and pickup point; a trip departs at this offset from the event. */
export const DEPART_BEFORE_START_MINUTES = 60;
export const RETURN_AFTER_END_MINUTES = 0;

/**
 * When a group trip leaves: an hour before the event starts for the trip there;
 * at the event's end (or four hours after its start, when no end is known) for
 * the trip back.
 */
export function departureFor(event: { startsAt: Date; endsAt: Date | null }, direction: "TO_EVENT" | "FROM_EVENT"): Date {
  if (direction === "TO_EVENT") return new Date(event.startsAt.getTime() - DEPART_BEFORE_START_MINUTES * 60_000);
  const end = event.endsAt ?? new Date(event.startsAt.getTime() + 4 * 3_600_000);
  return new Date(end.getTime() + RETURN_AFTER_END_MINUTES * 60_000);
}

export interface PoolMember {
  id: string;
  seats: number;
  pricePerSeat: number;
}

/**
 * Whether one more request fits a trip that already holds `members`: the trip
 * never grows beyond the largest vehicle that could take it (a minibus).
 */
export function fitsTrip(members: PoolMember[], seats: number): boolean {
  return members.reduce((sum, m) => sum + m.seats, 0) + seats <= DEFAULT_SEATS.MINIBUS;
}

/** What a group trip offers an operator: seats, the total, and the lowest seat price in it. */
export function tripTotals(members: PoolMember[]): { seats: number; total: number; lowestPerSeat: number | null } {
  const seats = members.reduce((sum, m) => sum + m.seats, 0);
  const total = Math.round(members.reduce((sum, m) => sum + m.seats * m.pricePerSeat, 0) * 100) / 100;
  const lowestPerSeat = members.length ? Math.min(...members.map((m) => m.pricePerSeat)) : null;
  return { seats, total, lowestPerSeat };
}

/**
 * Whether a counter-offer is a counter at all: one price per seat for the whole
 * trip, above what the lowest passenger offered (or it would just be accepting),
 * and not more than twice the highest (a counter that only exists to be refused).
 */
export function counterRefusal(counterPerSeat: number, members: PoolMember[], price: SeatPrice): string | null {
  const base = priceRefusal(counterPerSeat, price);
  if (base) return base;
  if (members.length === 0) return "This trip has no passengers";
  const lowest = Math.min(...members.map((m) => m.pricePerSeat));
  const highest = Math.max(...members.map((m) => m.pricePerSeat));
  if (counterPerSeat <= lowest) return "That is what the passengers offered; accept the trip instead";
  if (counterPerSeat > highest * 2) return `A counter can be at most R${highest * 2} a seat on this trip`;
  return null;
}

/** How long passengers have to answer a counter before it lapses and the trip reopens. */
export const COUNTER_WINDOW_MINUTES = 30;

// ─── Codes ────────────────────────────────────────────────────

/** A 4-digit boarding code for a passenger, from the CSPRNG. */
export function newCheckInCode(): string {
  return randomInt(0, 10_000).toString().padStart(4, "0");
}

// ─── Fees ─────────────────────────────────────────────────────

/** Our share of `amount`, to the cent. */
export function feeOn(amount: number, percent: number): number {
  return Math.round(amount * percent) / 100;
}

/**
 * Above what an operator may owe before they are paused. Low on purpose: a cash
 * business where the fee is settled weekly, and a limit is the only thing that
 * makes "owed" mean anything (PLAN.md 3.8).
 */
export const OWED_LIMIT_RANDS = 500;

// ─── Tracked links ────────────────────────────────────────────

/** Where a visit came from. Anything else counts as direct, so the label set stays small and known. */
export const VISIT_CHANNELS = ["fb", "wa", "sms", "ig", "poster", "direct"] as const;
export type VisitChannel = (typeof VISIT_CHANNELS)[number];

export function visitChannel(value: unknown): VisitChannel {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (VISIT_CHANNELS as readonly string[]).includes(v) ? (v as VisitChannel) : "direct";
}

// ─── The event funnel ─────────────────────────────────────────

export interface FunnelInput {
  visits: { channel: string; count: number }[];
  requests: { status: string; seats: number }[];
  /** Fees owed to us from this event's completed trips. */
  fees: number;
  /** What promoting the event cost. */
  spend: number;
}

/** Statuses in which a passenger's seats were taken by an operator. */
const BOOKED_STATUSES = ["BOOKED", "BOARDED", "COMPLETED", "NO_SHOW"];

/**
 * One event's funnel (docs/PLAN.md §4, lane 1b step 10): page views by channel,
 * requests, seats booked, fees earned and promotion spent. The question it
 * answers is whether promoting the event paid for itself (`net`); the decision it
 * informs is whether to keep promoting that venue's events. Ratios are null where
 * the denominator is zero, never a division by zero dressed up as 0%.
 */
export function eventFunnel(input: FunnelInput) {
  const views = input.visits.reduce((sum, v) => sum + v.count, 0);
  const requests = input.requests.length;
  const seatsRequested = input.requests.reduce((sum, r) => sum + r.seats, 0);
  const seatsBooked = input.requests.filter((r) => BOOKED_STATUSES.includes(r.status)).reduce((sum, r) => sum + r.seats, 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    views,
    viewsByChannel: [...input.visits].sort((a, b) => b.count - a.count),
    requests,
    seatsRequested,
    seatsBooked,
    requestsPerView: views > 0 ? round2(requests / views) : null,
    fees: round2(input.fees),
    spend: round2(input.spend),
    net: round2(input.fees - input.spend),
    spendPerBookedSeat: seatsBooked > 0 ? round2(input.spend / seatsBooked) : null,
  };
}
