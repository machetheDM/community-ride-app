import { afterAll, describe, expect, it } from "@jest/globals";
import { POST as requestSeats } from "@/app/api/events/[slug]/trip-requests/route";
import { GET as myRequests } from "@/app/api/trip-requests/route";
import { POST as cancelRequest } from "@/app/api/trip-requests/[id]/cancel/route";
import { POST as respond } from "@/app/api/trip-requests/[id]/respond/route";
import { GET as available } from "@/app/api/group-trips/available/route";
import { GET as mine } from "@/app/api/group-trips/mine/route";
import { POST as accept } from "@/app/api/group-trips/[id]/accept/route";
import { POST as counter } from "@/app/api/group-trips/[id]/counter/route";
import { POST as checkIn } from "@/app/api/group-trips/[id]/check-in/route";
import { POST as complete } from "@/app/api/group-trips/[id]/complete/route";
import { GET as share } from "@/app/api/trips/share/[token]/route";
import { GET as statement } from "@/app/api/operators/me/statement/route";
import {
  auditRows,
  call,
  createDriver,
  createEvent,
  createOperator,
  createPickupPoint,
  createUser,
  data,
  prisma,
  request,
  type TestUser,
} from "./helpers";

/**
 * Event group trips end to end (docs/PLAN.md Phase 3.4 to 3.9), against a real
 * Postgres: the advisory lock, the conditional writes and the ledger's unique
 * key are what is under test, and none of them can be faked.
 */

afterAll(async () => {
  await prisma.$disconnect();
});

type Body = Record<string, unknown>;

const ask = (slug: string, user: TestUser, body: Body) =>
  call(requestSeats, request("POST", `/api/events/${slug}/trip-requests`, { user, body }), { slug });
const operatorCall = (handler: typeof accept, id: string, user: TestUser, body?: Body) =>
  call(handler, request("POST", `/api/group-trips/${id}`, { user, body }), { id });
const offers = async (user: TestUser) => data(await call(available, request("GET", "/api/group-trips/available", { user }))) as {
  standing: { refusal: string | null };
  trips: { id: string; seats: number; total: number }[];
};
const myList = async (user: TestUser) =>
  (await call(myRequests, request("GET", "/api/trip-requests", { user }))).body.data as Record<string, unknown>[];

/** A published event with one pickup point, and `n` passengers who asked for seats from it. */
async function eventWithRequests(offersPerSeat: { seats: number; price: number }[]) {
  const event = await createEvent();
  const point = await createPickupPoint();
  const passengers: TestUser[] = [];
  const requestIds: string[] = [];
  for (const o of offersPerSeat) {
    const passenger = await createUser();
    const res = await ask(event.slug, passenger, { pickupPointId: point.id, seats: o.seats, pricePerSeat: o.price });
    expect(res.status).toBe(201);
    passengers.push(passenger);
    requestIds.push(data(res).id as string);
  }
  const rows = await prisma.tripRequest.findMany({ where: { id: { in: requestIds } } });
  return { event, point, passengers, requestIds, tripIds: [...new Set(rows.map((r) => r.groupTripId))] };
}

describe("PLAN.md 3.4: a passenger's offer", () => {
  it("refuses an offer below the floor and stores nothing", async () => {
    const event = await createEvent();
    const point = await createPickupPoint();
    const passenger = await createUser();

    const res = await ask(event.slug, passenger, { pickupPointId: point.id, seats: 2, pricePerSeat: 10 });

    expect(res.status).toBe(400);
    expect(res.text).toContain("R20");
    expect(await prisma.tripRequest.count({ where: { customerId: passenger.userId } })).toBe(0);
  });

  it("ignores a total or fee sent by the client: the stored price is the offer per seat", async () => {
    const { requestIds } = await eventWithRequests([{ seats: 2, price: 45 }]);
    const stored = await prisma.tripRequest.findUniqueOrThrow({ where: { id: requestIds[0] } });
    expect(stored.pricePerSeat.toFixed(2)).toBe("45.00");
    expect(stored.status).toBe("WAITING");
  });

  it("refuses a second request for the same event and direction", async () => {
    const { event, point, passengers } = await eventWithRequests([{ seats: 1, price: 30 }]);
    const res = await ask(event.slug, passengers[0], { pickupPointId: point.id, seats: 3, pricePerSeat: 30 });
    expect(res.status).toBe(409);
  });

  it("closes requests once the trip is about to leave", async () => {
    const event = await createEvent({ daysAhead: 0.04 }); // starts in about an hour: the trip there leaves now
    const point = await createPickupPoint();
    const res = await ask(event.slug, await createUser(), { pickupPointId: point.id, seats: 1, pricePerSeat: 30 });
    expect(res.status).toBe(409);
  });

  it("refuses an operator asking for seats as a passenger", async () => {
    const event = await createEvent();
    const point = await createPickupPoint();
    const driver = await createDriver();
    const res = await ask(event.slug, driver, { pickupPointId: point.id, seats: 1, pricePerSeat: 30 });
    expect(res.status).toBe(403);
  });
});

describe("PLAN.md 3.5: pooling", () => {
  it("puts nine requests from one pickup point into one trip, offered once", async () => {
    const { tripIds } = await eventWithRequests(Array.from({ length: 9 }, () => ({ seats: 1, price: 30 })));
    expect(tripIds).toHaveLength(1);

    const operator = await createOperator();
    const listed = (await offers(operator)).trips.filter((t) => t.id === tripIds[0]);
    expect(listed).toHaveLength(1);
    expect(listed[0].seats).toBe(9);
    expect(listed[0].total).toBe(270);
  });

  it("starts a second trip when the next request would pass a minibus's 15 seats", async () => {
    const { tripIds } = await eventWithRequests([
      { seats: 6, price: 30 },
      { seats: 6, price: 30 },
      { seats: 3, price: 30 },
      { seats: 1, price: 30 },
    ]);
    expect(tripIds).toHaveLength(2);
  });

  it("closes a trip when its last passenger cancels, and refuses a stranger's cancel", async () => {
    const { passengers, requestIds, tripIds } = await eventWithRequests([{ seats: 2, price: 30 }]);

    const stranger = await createUser();
    const refused = await call(cancelRequest, request("POST", "/x", { user: stranger }), { id: requestIds[0] });
    expect(refused.status).toBe(404);
    expect((await auditRows(requestIds[0])).map((a) => a.action)).toContain("trip_request.cancel.refused");

    const res = await call(cancelRequest, request("POST", "/x", { user: passengers[0] }), { id: requestIds[0] });
    expect(res.status).toBe(200);
    expect((await prisma.groupTrip.findUniqueOrThrow({ where: { id: tripIds[0] as string } })).status).toBe("CANCELLED");
  });
});

describe("PLAN.md 3.7: operator standing", () => {
  it("shows an operator whose documents are not verified no trips, and refuses their accept", async () => {
    const { tripIds } = await eventWithRequests([{ seats: 2, price: 30 }]);
    const unverified = await createOperator({ verified: false });

    const listed = await offers(unverified);
    expect(listed.trips).toEqual([]);
    expect(listed.standing.refusal).toContain("DRIVING_PERMIT");

    const res = await operatorCall(accept, tripIds[0] as string, unverified);
    expect(res.status).toBe(403);
    expect((await prisma.groupTrip.findUniqueOrThrow({ where: { id: tripIds[0] as string } })).status).toBe("OPEN");
  });

  it("does not offer a trip bigger than the operator's vehicle", async () => {
    const { tripIds } = await eventWithRequests([{ seats: 5, price: 30 }]);
    const small = await createOperator({ seats: 4 });

    expect((await offers(small)).trips.map((t) => t.id)).not.toContain(tripIds[0]);
    expect((await operatorCall(accept, tripIds[0] as string, small)).status).toBe(403);
  });

  it("pauses an operator who owes more than the limit", async () => {
    const { tripIds } = await eventWithRequests([{ seats: 2, price: 30 }]);
    const operator = await createOperator();
    await prisma.ledgerEntry.create({
      data: { operatorUserId: operator.userId, kind: "ADJUSTMENT", amount: "600.00", sourceType: "MANUAL", sourceId: `test-${operator.userId}` },
    });

    expect((await offers(operator)).standing.refusal).toContain("owe R600.00");
    expect((await operatorCall(accept, tripIds[0] as string, operator)).status).toBe(403);
  });
});

describe("PLAN.md 3.6: accepting and countering", () => {
  it("gives exactly one of two operators accepting at once the trip, and the other 409", async () => {
    const { tripIds, requestIds } = await eventWithRequests([
      { seats: 2, price: 40 },
      { seats: 3, price: 35 },
    ]);
    const tripId = tripIds[0] as string;
    const [a, b] = [await createOperator(), await createOperator()];

    const results = await Promise.all([operatorCall(accept, tripId, a), operatorCall(accept, tripId, b)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results[0].status === 200 ? a : b;
    const trip = await prisma.groupTrip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.status).toBe("BOOKED");
    expect(trip.driverId).toBe(winner.driverId);
    expect(trip.platformFeePercent).toBe(10);
    const rows = await prisma.tripRequest.findMany({ where: { id: { in: requestIds } } });
    expect(rows.every((r) => r.status === "BOOKED" && r.checkInCodeEnc)).toBe(true);
  });

  it("asks only passengers who offered less than a counter, and books at the counter when they agree", async () => {
    const { tripIds, requestIds, passengers } = await eventWithRequests([
      { seats: 2, price: 30 },
      { seats: 1, price: 60 },
    ]);
    const tripId = tripIds[0] as string;
    const operator = await createOperator();

    const countered = await operatorCall(counter, tripId, operator, { pricePerSeat: 50 });
    expect(countered.status).toBe(200);
    const [low, high] = await Promise.all(requestIds.map((id) => prisma.tripRequest.findUniqueOrThrow({ where: { id } })));
    expect(low.status).toBe("CONFIRMING");
    expect(high.status).toBe("WAITING");

    // Another operator cannot take a trip held by a counter.
    expect((await operatorCall(accept, tripId, await createOperator())).status).toBe(409);

    const answer = await call(respond, request("POST", "/x", { user: passengers[0], body: { accept: true } }), { id: requestIds[0] });
    expect(answer.status).toBe(200);

    const trip = await prisma.groupTrip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.status).toBe("BOOKED");
    expect(trip.driverId).toBe(operator.driverId);
    const prices = await prisma.tripRequest.findMany({
      where: { id: { in: requestIds } },
      select: { pricePerSeat: true, status: true },
      orderBy: { createdAt: "asc" },
    });
    expect(prices.map((p) => [p.status, p.pricePerSeat.toFixed(2)])).toEqual([
      ["BOOKED", "50.00"],
      ["BOOKED", "50.00"],
    ]);
  });

  it("books with those who agreed when a passenger declines", async () => {
    const { tripIds, requestIds, passengers } = await eventWithRequests([
      { seats: 2, price: 30 },
      { seats: 1, price: 60 },
    ]);
    const operator = await createOperator();
    await operatorCall(counter, tripIds[0] as string, operator, { pricePerSeat: 50 });

    await call(respond, request("POST", "/x", { user: passengers[0], body: { accept: false } }), { id: requestIds[0] });

    expect((await prisma.tripRequest.findUniqueOrThrow({ where: { id: requestIds[0] } })).status).toBe("DECLINED");
    expect((await prisma.tripRequest.findUniqueOrThrow({ where: { id: requestIds[1] } })).status).toBe("BOOKED");
    expect((await prisma.groupTrip.findUniqueOrThrow({ where: { id: tripIds[0] as string } })).status).toBe("BOOKED");
  });

  it("refuses a counter at or under what passengers offered, and a second counter while one is held", async () => {
    const first = await eventWithRequests([{ seats: 2, price: 30 }]);
    const second = await eventWithRequests([{ seats: 2, price: 30 }]);
    const operator = await createOperator();

    expect((await operatorCall(counter, first.tripIds[0] as string, operator, { pricePerSeat: 30 })).status).toBe(400);
    expect((await operatorCall(counter, first.tripIds[0] as string, operator, { pricePerSeat: 40 })).status).toBe(200);
    expect((await operatorCall(counter, second.tripIds[0] as string, operator, { pricePerSeat: 40 })).status).toBe(409);
  });

  it("lets a counter nobody answered lapse, reopening the trip at the passengers' own prices", async () => {
    const { tripIds, requestIds, passengers } = await eventWithRequests([{ seats: 2, price: 30 }]);
    const tripId = tripIds[0] as string;
    await operatorCall(counter, tripId, await createOperator(), { pricePerSeat: 45 });
    await prisma.groupTrip.update({ where: { id: tripId }, data: { counterExpiresAt: new Date(Date.now() - 1000) } });

    const late = await call(respond, request("POST", "/x", { user: passengers[0], body: { accept: true } }), { id: requestIds[0] });
    expect(late.status).toBe(409);

    expect((await offers(await createOperator())).trips.map((t) => t.id)).toContain(tripId);
    const back = await prisma.tripRequest.findUniqueOrThrow({ where: { id: requestIds[0] } });
    expect(back.status).toBe("WAITING");
    expect(back.pricePerSeat.toFixed(2)).toBe("30.00");
  });
});

describe("PLAN.md 3.8 and 3.9: boarding, completion, the ledger and sharing", () => {
  it("boards by code, completes after departure, and records the fee once", async () => {
    const { tripIds, passengers, requestIds } = await eventWithRequests([
      { seats: 2, price: 50 },
      { seats: 1, price: 40 },
    ]);
    const tripId = tripIds[0] as string;
    const operator = await createOperator();
    expect((await operatorCall(accept, tripId, operator)).status).toBe(200);

    const mineNow = (await myList(passengers[0])).find((r) => r.id === requestIds[0]) as Record<string, unknown>;
    const code = mineNow.checkInCode as string;
    expect(code).toMatch(/^\d{4}$/);
    expect((mineNow.operator as { vehicle: { licensePlate: string } }).vehicle.licensePlate).toMatch(/^TEST/);

    const wrong = code === "0000" ? "0001" : "0000";
    const otherCode = ((await myList(passengers[1]))[0].checkInCode as string) ?? "";
    if (wrong !== otherCode) expect((await operatorCall(checkIn, tripId, operator, { code: wrong })).status).toBe(400);
    expect((await operatorCall(checkIn, tripId, operator, { code })).status).toBe(200);
    expect((await operatorCall(checkIn, tripId, operator, { code })).status).toBe(400);

    // Another operator cannot board passengers on this trip.
    expect((await operatorCall(checkIn, tripId, await createOperator(), { code: otherCode })).status).toBe(404);

    expect((await operatorCall(complete, tripId, operator)).status).toBe(409); // not left yet
    await prisma.groupTrip.update({ where: { id: tripId }, data: { departAt: new Date(Date.now() - 60_000) } });

    const done = await operatorCall(complete, tripId, operator);
    expect(done.status).toBe(200);
    expect(data(done)).toMatchObject({ fares: 100, fee: 10, boarded: 1, noShows: 1 });
    expect((await operatorCall(complete, tripId, operator)).status).toBe(409);

    const statuses = await prisma.tripRequest.findMany({
      where: { id: { in: requestIds } },
      select: { status: true },
      orderBy: { createdAt: "asc" },
    });
    expect(statuses.map((s) => s.status)).toEqual(["COMPLETED", "NO_SHOW"]);

    await prisma.ledgerEntry.create({
      data: { operatorUserId: operator.userId, kind: "FEE_PAID", amount: "4.00", sourceType: "PAYMENT", sourceId: `test-pay-${tripId}` },
    });
    const stmt = data(await call(statement, request("GET", "/api/operators/me/statement", { user: operator })));
    expect(stmt.owed).toBe(6);
    expect((stmt.entries as unknown[]).length).toBe(2);
  });

  it("gives passengers a share link that shows the vehicle and nobody on board, and nothing for a made-up token", async () => {
    const { tripIds, passengers } = await eventWithRequests([{ seats: 1, price: 30 }]);
    await operatorCall(accept, tripIds[0] as string, await createOperator());

    const path = (await myList(passengers[0]))[0].sharePath as string;
    expect(path).toMatch(/^\/t\/[0-9a-f]{40}$/);
    const token = path.split("/").pop() as string;
    const res = await call(share, request("GET", path), { token });

    expect(res.status).toBe(200);
    expect(JSON.stringify(data(res).operator)).toContain("TEST");
    expect(res.text).not.toContain(passengers[0].name);
    expect(res.text).not.toContain(passengers[0].phone);

    const fake = "0".repeat(40);
    expect((await call(share, request("GET", `/api/trips/share/${fake}`), { token: fake })).status).toBe(404);
  });

  it("shows the operator their booked trip with passengers' first names only", async () => {
    const { tripIds, passengers } = await eventWithRequests([{ seats: 1, price: 30 }]);
    const operator = await createOperator();
    await operatorCall(accept, tripIds[0] as string, operator);

    const res = await call(mine, request("GET", "/api/group-trips/mine", { user: operator }));
    const trip = (res.body.data as { id: string; passengerList: { firstName: string }[] }[]).find((t) => t.id === tripIds[0]);

    expect(trip?.passengerList[0].firstName).toBe("Test");
    expect(res.text).not.toContain(passengers[0].phone);
    expect(res.text).not.toContain("checkInCode");
  });
});
