import { describe, it, expect } from "@jest/globals";
import {
  counterRefusal,
  departureFor,
  feeOn,
  fitsTrip,
  newCheckInCode,
  priceRefusal,
  seatPrice,
  seatsOf,
  tripTotals,
  type PoolMember,
} from "@ride/db/trips";

describe("seat price", () => {
  it("never goes below R20 a seat, however short the trip", () => {
    expect(seatPrice(0).floor).toBe(20);
    expect(seatPrice(2).floor).toBe(20);
  });

  it("rises with distance, in R5 steps, with a suggested range up to one and a half times the floor", () => {
    const price = seatPrice(30); // 39 road km at R1.20 = R46.80, rounded up to R50
    expect(price).toEqual({ floor: 50, suggestedLow: 50, suggestedHigh: 75 });
  });

  it("refuses an offer below the floor, which is the plan's check for 3.4", () => {
    const price = seatPrice(30);
    expect(priceRefusal(45, price)).toMatch(/least a seat on this trip can go for is R50/);
    expect(priceRefusal(50, price)).toBeNull();
    expect(priceRefusal(0, price)).toMatch(/Offer a price/);
    expect(priceRefusal(Number.NaN, price)).toMatch(/Offer a price/);
    expect(priceRefusal(251, price)).toMatch(/more than this trip needs/);
  });
});

describe("pooling", () => {
  const member = (id: string, seats: number, pricePerSeat = 50): PoolMember => ({ id, seats, pricePerSeat });

  it("fits nine requests of one seat into one trip, the plan's check for 3.5", () => {
    const members: PoolMember[] = [];
    for (let i = 0; i < 9; i++) {
      expect(fitsTrip(members, 1)).toBe(true);
      members.push(member(`r${i}`, 1));
    }
    expect(tripTotals(members)).toEqual({ seats: 9, total: 450, lowestPerSeat: 50 });
  });

  it("never grows a trip past a minibus's fifteen seats", () => {
    const members = [member("a", 6), member("b", 6)];
    expect(fitsTrip(members, 3)).toBe(true);
    expect(fitsTrip(members, 4)).toBe(false);
  });

  it("totals each passenger at their own price", () => {
    expect(tripTotals([member("a", 2, 50), member("b", 1, 70)])).toEqual({ seats: 3, total: 170, lowestPerSeat: 50 });
    expect(tripTotals([])).toEqual({ seats: 0, total: 0, lowestPerSeat: null });
  });

  it("leaves an hour before the event, and comes back at its end or four hours after the start", () => {
    const startsAt = new Date("2026-12-05T18:00:00Z");
    expect(departureFor({ startsAt, endsAt: null }, "TO_EVENT").toISOString()).toBe("2026-12-05T17:00:00.000Z");
    expect(departureFor({ startsAt, endsAt: null }, "FROM_EVENT").toISOString()).toBe("2026-12-05T22:00:00.000Z");
    const endsAt = new Date("2026-12-06T01:00:00Z");
    expect(departureFor({ startsAt, endsAt }, "FROM_EVENT").toISOString()).toBe("2026-12-06T01:00:00.000Z");
  });
});

describe("a counter-offer", () => {
  const price = seatPrice(30);
  const members: PoolMember[] = [
    { id: "a", seats: 2, pricePerSeat: 50 },
    { id: "b", seats: 1, pricePerSeat: 60 },
  ];

  it("must be above what the lowest passenger offered, or it is an acceptance", () => {
    expect(counterRefusal(50, members, price)).toMatch(/accept the trip instead/);
    expect(counterRefusal(55, members, price)).toBeNull();
  });

  it("cannot be more than twice the highest offer, or below the floor", () => {
    expect(counterRefusal(121, members, price)).toMatch(/at most R120/);
    expect(counterRefusal(40, members, price)).toMatch(/least a seat/);
  });
});

describe("seats, codes and fees", () => {
  it("count a vehicle's own seats, or its type's usual number", () => {
    expect(seatsOf({ type: "MINIBUS", seats: null })).toBe(15);
    expect(seatsOf({ type: "MINIBUS", seats: 14 })).toBe(14);
    expect(seatsOf({ type: "SCOOTER", seats: null })).toBe(0);
  });

  it("make four-digit boarding codes from the whole range", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = newCheckInCode();
      expect(code).toMatch(/^\d{4}$/);
      seen.add(code);
    }
    expect(seen.size).toBeGreaterThan(180);
  });

  it("take the fee to the cent", () => {
    expect(feeOn(450, 15)).toBe(67.5);
    expect(feeOn(99.99, 12)).toBe(12);
  });
});
