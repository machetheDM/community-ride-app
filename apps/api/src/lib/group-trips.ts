import type { Prisma } from "@ride/db";
import { decryptField, encryptField, keyedHash } from "@ride/db/crypto";
import {
  COUNTER_WINDOW_MINUTES,
  fitsTrip,
  missingDocuments,
  newCheckInCode,
  owedBalance,
  owedRefusal,
  seatPrice,
  seatsOf,
  tripTotals,
  type PoolMember,
} from "@ride/db/trips";
import { AuthorizationError, NotFoundError } from "@/lib/errors";
import { haversineKm } from "@/lib/geo";
import { logger } from "@/lib/logger";
import { sendPushToUser } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { firstName } from "@/lib/policy";

/**
 * Event group trips on the server (docs/PLAN.md Phase 3.4 to 3.9): pooling, the
 * operator's standing, booking, counters and what each party sees.
 *
 * Concurrency, in one place:
 * - Every change to which requests sit in which OPEN trip takes the pool's
 *   advisory lock (event, direction, pickup point). Joining a trip and an operator
 *   taking it are therefore serialised: a request cannot join a trip in the
 *   instant it is booked and be left behind, unseen by the operator.
 * - Every trip status change is a conditional write on the status it was read
 *   in, so of two operators accepting the same trip one gets the trip and the
 *   other a 409 (PLAN.md 3.6's concurrency test).
 */

type Tx = Prisma.TransactionClient;

/** A request in these statuses holds seats on its trip. */
export const MEMBER_STATUSES = ["WAITING", "CONFIRMING", "BOOKED", "BOARDED"] as const;
/** A passenger may cancel in these; after boarding, the trip is under way. */
export const CANCELLABLE_REQUEST_STATUSES = ["WAITING", "CONFIRMING", "BOOKED"] as const;
/** A passenger whose request ended this way may ask again (the unique key is per event and direction). */
export const REOPENABLE_REQUEST_STATUSES = ["CANCELLED", "DECLINED"] as const;

/** Wrong boarding codes one trip tolerates before check-in is locked. */
export const CHECK_IN_WRONG_LIMIT = 20;

// ─── Locks and pooling ────────────────────────────────────────

/** Serialises every change to one pool, until the transaction ends. */
export async function lockPool(
  tx: Tx,
  pool: { eventId: string; direction: string; pickupPointId: string }
): Promise<void> {
  const key = `pool:${pool.eventId}:${pool.direction}:${pool.pickupPointId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

export async function membersOf(tx: Tx, groupTripId: string) {
  const rows = await tx.tripRequest.findMany({
    where: { groupTripId, status: { in: [...MEMBER_STATUSES] } },
    select: { id: true, seats: true, pricePerSeat: true, status: true, customerId: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ ...r, pricePerSeat: Number(r.pricePerSeat) }));
}

function asPool(members: { id: string; seats: number; pricePerSeat: number }[]): PoolMember[] {
  return members.map((m) => ({ id: m.id, seats: m.seats, pricePerSeat: m.pricePerSeat }));
}

/**
 * The OPEN trip a request of `seats` joins, made if none has room (PLAN.md 3.5:
 * pooled by event, direction and pickup point; never more than a minibus holds).
 * The caller holds the pool lock.
 */
export async function tripForRequest(
  tx: Tx,
  pool: { eventId: string; direction: "TO_EVENT" | "FROM_EVENT"; pickupPointId: string; departAt: Date },
  seats: number
): Promise<string> {
  const open = await tx.groupTrip.findMany({
    where: { eventId: pool.eventId, direction: pool.direction, pickupPointId: pool.pickupPointId, status: "OPEN" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  for (const trip of open) {
    if (fitsTrip(asPool(await membersOf(tx, trip.id)), seats)) return trip.id;
  }
  const made = await tx.groupTrip.create({
    data: {
      eventId: pool.eventId,
      direction: pool.direction,
      pickupPointId: pool.pickupPointId,
      departAt: pool.departAt,
    },
    select: { id: true },
  });
  return made.id;
}

/**
 * After a request leaves a trip: a trip nobody is on any more is cancelled, so it
 * stops being offered. The caller holds the pool lock.
 */
export async function closeIfEmpty(tx: Tx, groupTripId: string): Promise<boolean> {
  const left = await tx.tripRequest.count({ where: { groupTripId, status: { in: [...MEMBER_STATUSES] } } });
  if (left > 0) return false;
  const closed = await tx.groupTrip.updateMany({
    where: { id: groupTripId, status: { in: ["OPEN", "COUNTERED"] } },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  return closed.count === 1;
}

// ─── Counters ─────────────────────────────────────────────────

export function counterExpiry(now: Date): Date {
  return new Date(now.getTime() + COUNTER_WINDOW_MINUTES * 60_000);
}

/**
 * A counter nobody finished answering in time lapses: the trip reopens to every
 * operator and the passengers who had not answered are back to waiting at their
 * own offer. Those who accepted keep the higher price they agreed to. Lazy: done
 * when the trip is next touched, not by a timer. The caller holds the pool lock.
 */
export async function lapseCounterIfExpired(
  tx: Tx,
  trip: { id: string; status: string; counterExpiresAt: Date | null },
  now = new Date()
): Promise<boolean> {
  if (trip.status !== "COUNTERED" || !trip.counterExpiresAt || trip.counterExpiresAt > now) return false;
  const reopened = await tx.groupTrip.updateMany({
    where: { id: trip.id, status: "COUNTERED" },
    data: { status: "OPEN", counterDriverId: null, counterPricePerSeat: null, counteredAt: null, counterExpiresAt: null },
  });
  if (reopened.count !== 1) return false;
  await tx.tripRequest.updateMany({ where: { groupTripId: trip.id, status: "CONFIRMING" }, data: { status: "WAITING" } });
  return true;
}

/**
 * Lapses expired counters before trips are listed, each under its pool's lock,
 * so a lapsed trip shows up as open again for every operator.
 */
export async function lapseExpiredCounters(now = new Date()): Promise<number> {
  const expired = await prisma.groupTrip.findMany({
    where: { status: "COUNTERED", counterExpiresAt: { lte: now } },
    select: { id: true, eventId: true, direction: true, pickupPointId: true },
    take: 50,
  });
  let lapsed = 0;
  for (const trip of expired) {
    const done = await prisma.$transaction(async (tx) => {
      await lockPool(tx, trip);
      const current = await tx.groupTrip.findUnique({
        where: { id: trip.id },
        select: { id: true, status: true, counterExpiresAt: true },
      });
      return current ? lapseCounterIfExpired(tx, current, now) : false;
    });
    if (done) lapsed += 1;
  }
  return lapsed;
}

// ─── Booking ──────────────────────────────────────────────────

/** The token in a trip's share link, derived so every passenger on it gets the same link. */
export function shareTokenFor(groupTripId: string): string {
  return keyedHash(`share-trip:${groupTripId}`).slice(0, 40);
}

export function shareTokenHash(token: string): string {
  return keyedHash(`share-token:${token}`);
}

/**
 * Hands an OPEN or COUNTERED trip to an operator. The write is conditional on
 * the status the caller read, so a second operator gets 0 rows and a 409. Each
 * passenger still on the trip gets their own boarding code, unique on the trip.
 * At a counter, everyone who agreed pays the counter price, including anyone who
 * had offered more.
 */
export async function bookTrip(
  tx: Tx,
  trip: { id: string; status: "OPEN" | "COUNTERED" },
  driverId: string,
  platformFeePercent: number,
  counterPricePerSeat: number | null,
  now = new Date()
): Promise<boolean> {
  const booked = await tx.groupTrip.updateMany({
    where: { id: trip.id, status: trip.status },
    data: {
      status: "BOOKED",
      driverId,
      bookedAt: now,
      platformFeePercent,
      shareTokenHash: shareTokenHash(shareTokenFor(trip.id)),
      counterExpiresAt: null,
    },
  });
  if (booked.count !== 1) return false;

  const riding = await tx.tripRequest.findMany({
    where: { groupTripId: trip.id, status: "WAITING" },
    select: { id: true },
  });
  const used = new Set<string>();
  for (const r of riding) {
    let code = newCheckInCode();
    while (used.has(code)) code = newCheckInCode();
    used.add(code);
    await tx.tripRequest.update({
      where: { id: r.id },
      data: {
        status: "BOOKED",
        checkInCodeEnc: encryptField(code),
        ...(counterPricePerSeat !== null ? { pricePerSeat: counterPricePerSeat.toFixed(2) } : {}),
      },
    });
  }
  return true;
}

/**
 * Once every passenger has answered a counter (accepted, declined or left), the
 * trip goes to the operator who countered, at the counter price, with everyone
 * who agreed. If nobody did, it closes. Until then nothing changes. The caller
 * holds the pool lock.
 */
export async function settleCounter(
  tx: Tx,
  groupTripId: string,
  platformFeePercent: number,
  now = new Date()
): Promise<"WAITING_FOR_ANSWERS" | "BOOKED" | "CLOSED" | "NOT_COUNTERED"> {
  const trip = await tx.groupTrip.findUnique({
    where: { id: groupTripId },
    select: { id: true, status: true, counterDriverId: true, counterPricePerSeat: true },
  });
  if (!trip || trip.status !== "COUNTERED" || !trip.counterDriverId || trip.counterPricePerSeat === null) return "NOT_COUNTERED";
  const pending = await tx.tripRequest.count({ where: { groupTripId, status: "CONFIRMING" } });
  if (pending > 0) return "WAITING_FOR_ANSWERS";
  const agreed = await tx.tripRequest.count({ where: { groupTripId, status: "WAITING" } });
  if (agreed === 0) {
    await closeIfEmpty(tx, groupTripId);
    return "CLOSED";
  }
  const booked = await bookTrip(
    tx,
    { id: groupTripId, status: "COUNTERED" },
    trip.counterDriverId,
    platformFeePercent,
    Number(trip.counterPricePerSeat),
    now
  );
  return booked ? "BOOKED" : "NOT_COUNTERED";
}

// ─── The operator's standing ──────────────────────────────────

export interface OperatorStanding {
  refusal: string | null;
  seats: number;
  owed: number;
  missing: string[];
}

/**
 * Whether a driver may see and take group trips, and how many passengers their
 * vehicle takes. Read from the database on each call: an admin approving the
 * operator and each document (PLAN.md 3.7), an approved vehicle with seats, and
 * fees owed at or under the limit (3.8). Nothing here approves itself.
 */
export async function operatorStanding(tx: Tx, driver: { id: string; userId: string }, now = new Date()): Promise<OperatorStanding> {
  // One after another, not Promise.all: inside a transaction these share one
  // connection, and pg refuses (and will stop allowing) overlapping queries on it.
  const row = await tx.driver.findUnique({
    where: { id: driver.id },
    select: { isApproved: true, vehicle: { select: { isApproved: true, type: true, seats: true } } },
  });
  const documents = await tx.operatorDocument.findMany({
    where: { userId: driver.userId },
    select: { kind: true, status: true, expiresOn: true },
  });
  const ledger = await tx.ledgerEntry.findMany({ where: { operatorUserId: driver.userId }, select: { kind: true, amount: true } });
  const owed = owedBalance(ledger);
  const missing = missingDocuments(documents, now);
  const seats = row?.vehicle ? seatsOf(row.vehicle) : 0;

  let refusal: string | null = null;
  if (!row?.isApproved) refusal = "Your operator account has not been approved yet";
  else if (!row.vehicle) refusal = "Register a vehicle before taking group trips";
  else if (!row.vehicle.isApproved) refusal = "Your vehicle has not been approved yet";
  else if (missing.length > 0) refusal = `These documents still need an admin's check: ${missing.join(", ")}`;
  else if (seats < 1) refusal = "Your vehicle carries no passengers";
  else refusal = owedRefusal(owed);

  return { refusal, seats, owed, missing };
}

/** The driver behind a viewer, for the operator routes; a non-driver is refused (and audited by the caller). */
export function operatorOf(viewer: { userId: string; role: string; driverId?: string | null }): { id: string; userId: string } {
  if (viewer.role !== "DRIVER") throw new AuthorizationError("Group trips are for registered operators");
  if (!viewer.driverId) throw new NotFoundError("Operator profile");
  return { id: viewer.driverId, userId: viewer.userId };
}

/** Locks an operator's row, after the pool lock, so their own checks (one counter, no overlap) are serialised. */
export async function lockOperator(tx: Tx, driverId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "ride"."Driver" WHERE id = ${driverId} FOR UPDATE`;
}

/** What the operator owes, derived from the ledger (never a stored balance). */
export async function owedBy(tx: Tx, userId: string): Promise<number> {
  const rows = await tx.ledgerEntry.findMany({ where: { operatorUserId: userId }, select: { kind: true, amount: true } });
  return owedBalance(rows);
}

// ─── What each party sees ─────────────────────────────────────

export const tripOfferSelect = {
  id: true,
  status: true,
  direction: true,
  departAt: true,
  counterDriverId: true,
  counterPricePerSeat: true,
  counterExpiresAt: true,
  driverId: true,
  bookedAt: true,
  completedAt: true,
  platformFeePercent: true,
  event: { select: { title: true, slug: true, startsAt: true, venue: { select: { name: true, address: true, lat: true, lng: true } } } },
  pickupPoint: { select: { id: true, name: true, address: true, lat: true, lng: true } },
} satisfies Prisma.GroupTripSelect;

export type TripOfferRecord = Prisma.GroupTripGetPayload<{ select: typeof tripOfferSelect }>;

/**
 * A trip as an operator sees it before taking it: where, when, how many seats
 * and what the passengers offered in total. No passenger is named; an operator
 * learns first names only once the trip is theirs.
 */
export function presentOffer(trip: TripOfferRecord, members: { seats: number; pricePerSeat: number }[]) {
  const totals = tripTotals(members.map((m, i) => ({ id: String(i), ...m })));
  const km = haversineKm(trip.pickupPoint, trip.event.venue);
  return {
    id: trip.id,
    status: trip.status,
    direction: trip.direction,
    departAt: trip.departAt,
    event: { title: trip.event.title, startsAt: trip.event.startsAt, venue: trip.event.venue.name },
    pickupPoint: { name: trip.pickupPoint.name, address: trip.pickupPoint.address, lat: trip.pickupPoint.lat, lng: trip.pickupPoint.lng },
    distanceKm: Math.round(km * 10) / 10,
    seats: totals.seats,
    total: totals.total,
    lowestPerSeat: totals.lowestPerSeat,
    floorPerSeat: seatPrice(km).floor,
    passengers: members.length,
  };
}

/** The trip as its operator sees it once booked: first names, seats, status. No phone, no code. */
export function presentOperatorTrip(
  trip: TripOfferRecord,
  members: { id: string; seats: number; pricePerSeat: number; status: string; customer: { name: string | null } }[]
) {
  return {
    ...presentOffer(trip, members),
    counterPricePerSeat: trip.counterPricePerSeat === null ? null : Number(trip.counterPricePerSeat),
    counterExpiresAt: trip.counterExpiresAt,
    passengerList: members.map((m) => ({
      id: m.id,
      firstName: firstName(m.customer.name),
      seats: m.seats,
      pricePerSeat: m.pricePerSeat,
      status: m.status,
    })),
  };
}

export const myRequestSelect = {
  id: true,
  status: true,
  direction: true,
  seats: true,
  pricePerSeat: true,
  checkInCodeEnc: true,
  createdAt: true,
  event: { select: { title: true, slug: true, startsAt: true, venue: { select: { name: true } } } },
  pickupPoint: { select: { name: true, address: true, lat: true, lng: true } },
  groupTrip: {
    select: {
      id: true,
      status: true,
      departAt: true,
      counterPricePerSeat: true,
      counterExpiresAt: true,
      driver: {
        select: {
          user: { select: { name: true } },
          vehicle: { select: { make: true, model: true, color: true, licensePlate: true } },
        },
      },
    },
  },
} satisfies Prisma.TripRequestSelect;

export type MyRequestRecord = Prisma.TripRequestGetPayload<{ select: typeof myRequestSelect }>;

const SHOWS_OPERATOR = ["BOOKED", "BOARDED", "COMPLETED", "NO_SHOW"];

/**
 * A passenger's own request. The operator and vehicle appear once the trip is
 * booked, so the passenger knows which car to get into; the boarding code only
 * while it can still be used; the counter only while it is being asked.
 */
export function presentMyRequest(r: MyRequestRecord) {
  const booked = SHOWS_OPERATOR.includes(r.status) && r.groupTrip?.driver;
  return {
    id: r.id,
    status: r.status,
    direction: r.direction,
    seats: r.seats,
    pricePerSeat: Number(r.pricePerSeat),
    total: Math.round(r.seats * Number(r.pricePerSeat) * 100) / 100,
    event: { title: r.event.title, slug: r.event.slug, startsAt: r.event.startsAt, venue: r.event.venue.name },
    pickupPoint: r.pickupPoint,
    departAt: r.groupTrip?.departAt ?? null,
    tripStatus: r.groupTrip?.status ?? null,
    counter:
      r.status === "CONFIRMING" && r.groupTrip?.counterPricePerSeat
        ? { pricePerSeat: Number(r.groupTrip.counterPricePerSeat), expiresAt: r.groupTrip.counterExpiresAt }
        : null,
    operator:
      booked && r.groupTrip?.driver
        ? {
            firstName: firstName(r.groupTrip.driver.user.name),
            vehicle: r.groupTrip.driver.vehicle,
          }
        : null,
    checkInCode: r.status === "BOOKED" && r.checkInCodeEnc ? decryptField(r.checkInCodeEnc) : null,
    sharePath:
      booked && r.groupTrip && ["BOOKED", "BOARDED"].includes(r.status) ? `/api/trips/share/${shareTokenFor(r.groupTrip.id)}` : null,
  };
}

// ─── Notifications ────────────────────────────────────────────

/** Tells each booked passenger their trip has an operator. */
export async function notifyPassengers(groupTripId: string): Promise<void> {
  try {
    const riders = await prisma.tripRequest.findMany({
      where: { groupTripId, status: "BOOKED" },
      select: { customer: { select: { pushToken: true } }, event: { select: { title: true } } },
    });
    for (const r of riders) {
      await sendPushToUser(
        r.customer.pushToken,
        "Your event trip is booked 🚐",
        `An operator has taken your trip to ${r.event.title}. Open My trips for the vehicle and your boarding code.`,
        { screen: "my-trips" }
      );
    }
  } catch (error) {
    logger.warn("[group-trips] booking notification failed", {
      groupTripId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
