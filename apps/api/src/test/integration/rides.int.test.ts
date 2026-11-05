import { afterAll, afterEach, describe, expect, it } from "@jest/globals";
import { GET as listRides, POST as bookRide } from "@/app/api/rides/route";
import { GET as getRide, PATCH as patchRide } from "@/app/api/rides/[id]/route";
import { GET as availableRides } from "@/app/api/rides/available/route";
// The same module the routes get for `@/lib/notifications` (see moduleNameMapper).
import { sentPushes } from "./fakes/notifications";
import {
  auditRows,
  call,
  createDriver,
  createRide,
  createUser,
  data,
  eventually,
  items,
  prisma,
  request,
  type TestUser,
} from "./helpers";

/**
 * Rides: who may list, read and move them. Each `describe` names the hole in
 * PLAN.md section 2 or the finding in docs/threat-model.md it closes. Run with
 * the route files of d7b4f1e put back, every test here failed except three
 * controls that pass on both: a customer sees their own rides, the ride's own
 * parties can read it, and a booking answers 503 without Maps.
 */

afterAll(async () => {
  await prisma.$disconnect();
});

const patch = (id: string, user: TestUser | undefined, body: unknown) =>
  call(patchRide, request("PATCH", `/api/rides/${id}`, { user, body }), { id });

describe("hole 1: the ride list", () => {
  it("answers a request without a token with 401, not with every customer's rides", async () => {
    const customer = await createUser();
    await createRide(customer.userId);

    const res = await call(listRides, request("GET", "/api/rides"));

    expect(res.status).toBe(401);
    expect(res.text).not.toContain("12 Test Street");
  });

  it("shows a customer their own rides only", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const mine = await createRide(alice.userId);
    const theirs = await createRide(bob.userId);

    const res = await call(listRides, request("GET", "/api/rides", { user: alice }));

    const ids = items(res).map((r) => r.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
  });

  it("shows a driver the rides assigned to them and not the ones waiting for someone", async () => {
    const driver = await createDriver();
    const customer = await createUser();
    const assigned = await createRide(customer.userId, { status: "ACCEPTED", driverId: driver.driverId });
    const waiting = await createRide(customer.userId);

    const ids = items(await call(listRides, request("GET", "/api/rides?active=true", { user: driver }))).map((r) => r.id);

    expect(ids).toContain(assigned.id);
    expect(ids).not.toContain(waiting.id);
  });
});

describe("hole 2: one ride", () => {
  it("answers a request without a token with 401", async () => {
    const customer = await createUser();
    const ride = await createRide(customer.userId);

    const res = await call(getRide, request("GET", `/api/rides/${ride.id}`), { id: ride.id });

    expect(res.status).toBe(401);
  });

  it("answers another customer with 404, as if the ride did not exist, and records the attempt", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const ride = await createRide(owner.userId);

    const res = await call(getRide, request("GET", `/api/rides/${ride.id}`, { user: stranger }), { id: ride.id });
    const missing = await call(getRide, request("GET", "/api/rides/no-such-ride", { user: stranger }), {
      id: "no-such-ride",
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe(missing.body.error);
    expect(res.text).not.toContain(owner.phone);
    const audit = await auditRows(ride.id);
    expect(audit.map((a) => a.action)).toContain("ride.read.refused");
    expect(audit.find((a) => a.action === "ride.read.refused")?.actorUserId).toBe(stranger.userId);
  });

  it("answers a driver who is not assigned to the ride with 404", async () => {
    const owner = await createUser();
    const assigned = await createDriver();
    const other = await createDriver();
    const ride = await createRide(owner.userId, { status: "ACCEPTED", driverId: assigned.driverId });

    const res = await call(getRide, request("GET", `/api/rides/${ride.id}`, { user: other }), { id: ride.id });

    expect(res.status).toBe(404);
  });

  it("shows the ride to its customer, its driver and an admin", async () => {
    const owner = await createUser();
    const driver = await createDriver();
    const admin = await createUser("ADMIN");
    const ride = await createRide(owner.userId, { status: "ACCEPTED", driverId: driver.driverId });

    for (const user of [owner, driver, admin]) {
      const res = await call(getRide, request("GET", `/api/rides/${ride.id}`, { user }), { id: ride.id });
      expect(res.status).toBe(200);
      expect(data(res).id).toBe(ride.id);
    }
  });
});

describe("hole 4: changing a ride's status", () => {
  it("refuses a stranger who tries to complete someone else's ride, and leaves the ride alone", async () => {
    const owner = await createUser();
    const driver = await createDriver();
    const stranger = await createUser();
    const ride = await createRide(owner.userId, { status: "IN_PROGRESS", driverId: driver.driverId });

    const res = await patch(ride.id, stranger, { status: "COMPLETED", fareActual: 0 });

    expect(res.status).toBe(404);
    const after = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });
    expect(after.status).toBe("IN_PROGRESS");
    expect(after.fareActual).toBeNull();
  });

  it("refuses the customer who tries to mark their own trip completed", async () => {
    const owner = await createUser();
    const driver = await createDriver();
    const ride = await createRide(owner.userId, { status: "IN_PROGRESS", driverId: driver.driverId });

    const res = await patch(ride.id, owner, { status: "COMPLETED" });

    expect(res.status).toBe(403);
    expect((await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } })).status).toBe("IN_PROGRESS");
  });

  it("ignores a fare sent by the client and charges the booked estimate on completion", async () => {
    const owner = await createUser();
    const driver = await createDriver();
    const ride = await createRide(owner.userId, { status: "IN_PROGRESS", driverId: driver.driverId });

    const res = await patch(ride.id, driver, { status: "COMPLETED", fareActual: 0 });

    expect(res.status).toBe(200);
    const after = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });
    expect(after.fareActual?.toFixed(2)).toBe("85.50");
    expect(after.completedAt).not.toBeNull();
  });

  it("refuses a skipped step: an accepted ride cannot jump to completed", async () => {
    const owner = await createUser();
    const driver = await createDriver();
    const ride = await createRide(owner.userId, { status: "ACCEPTED", driverId: driver.driverId });

    const res = await patch(ride.id, driver, { status: "COMPLETED" });

    expect(res.status).toBe(409);
    expect((await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } })).status).toBe("ACCEPTED");
  });

  it("answers a status it does not know with 400", async () => {
    const owner = await createUser();
    const ride = await createRide(owner.userId);

    const res = await patch(ride.id, owner, { status: "TELEPORTED" });

    expect(res.status).toBe(400);
  });

  it("gives exactly one of two drivers racing to accept the same ride the ride, and the other 409", async () => {
    const owner = await createUser();
    const first = await createDriver();
    const second = await createDriver();
    const ride = await createRide(owner.userId);

    const results = await Promise.all([
      patch(ride.id, first, { status: "ACCEPTED" }),
      patch(ride.id, second, { status: "ACCEPTED" }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results[0].status === 200 ? first : second;
    const after = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });
    expect(after.driverId).toBe(winner.driverId);
    expect(after.status).toBe("ACCEPTED");
    expect(after.acceptedAt).not.toBeNull();
  });

  it("records the accepted move in the audit log in the same transaction, with from and to", async () => {
    const owner = await createUser();
    const driver = await createDriver();
    const ride = await createRide(owner.userId);

    await patch(ride.id, driver, { status: "ACCEPTED" });

    const accept = (await auditRows(ride.id)).find((a) => a.action === "ride.accept");
    expect(accept).toBeDefined();
    expect(accept?.actorUserId).toBe(driver.userId);
    expect(accept?.detail).toMatchObject({ from: "REQUESTED", to: "ACCEPTED" });
  });

  it("lets nobody change a completed ride, an admin included", async () => {
    const owner = await createUser();
    const driver = await createDriver();
    const admin = await createUser("ADMIN");
    const ride = await createRide(owner.userId, { status: "COMPLETED", driverId: driver.driverId });

    const byCustomer = await patch(ride.id, owner, { status: "CANCELLED" });
    const byAdmin = await patch(ride.id, admin, { status: "CANCELLED" });
    const byDriver = await patch(ride.id, driver, { status: "IN_PROGRESS" });

    expect([byCustomer.status, byAdmin.status, byDriver.status]).toEqual([409, 409, 409]);
    expect((await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } })).status).toBe("COMPLETED");
    expect((await auditRows(ride.id)).filter((a) => a.action.endsWith(".refused"))).toHaveLength(3);
  });

  it("makes the driver give a reason to cancel an accepted ride, and records who cancelled", async () => {
    const owner = await createUser();
    const driver = await createDriver();
    const ride = await createRide(owner.userId, { status: "ACCEPTED", driverId: driver.driverId });

    const without = await patch(ride.id, driver, { status: "CANCELLED" });
    const withReason = await patch(ride.id, driver, { status: "CANCELLED", cancelReason: "Flat tyre" });

    expect(without.status).toBe(400);
    expect(withReason.status).toBe(200);
    const after = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });
    expect(after.cancelledBy).toBe("DRIVER");
    expect(after.cancelReason).toBe("Flat tyre");
    expect(after.cancelledAt).not.toBeNull();
  });

  it("lets the customer cancel before the trip starts but not once it is in progress", async () => {
    const owner = await createUser();
    const driver = await createDriver();
    const early = await createRide(owner.userId, { status: "DRIVER_ARRIVED", driverId: driver.driverId });
    const late = await createRide(owner.userId, { status: "IN_PROGRESS", driverId: driver.driverId });

    expect((await patch(early.id, owner, { status: "CANCELLED" })).status).toBe(200);
    expect((await patch(late.id, owner, { status: "CANCELLED" })).status).toBe(403);
    expect((await prisma.ride.findUniqueOrThrow({ where: { id: early.id } })).cancelledBy).toBe("CUSTOMER");
  });

  it("refuses a driver a second ride while they already have one", async () => {
    const owner = await createUser();
    const driver = await createDriver();
    await createRide(owner.userId, { status: "IN_PROGRESS", driverId: driver.driverId });
    const another = await createRide(owner.userId);

    const res = await patch(another.id, driver, { status: "ACCEPTED" });

    expect(res.status).toBe(403);
  });
});

describe("threat model finding 5: an operator who is not approved", () => {
  it("cannot accept a ride", async () => {
    const owner = await createUser();
    const unapproved = await createDriver({ approved: false });
    const ride = await createRide(owner.userId);

    const res = await patch(ride.id, unapproved, { status: "ACCEPTED" });

    expect(res.status).toBe(403);
    const after = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });
    expect(after.status).toBe("REQUESTED");
    expect(after.driverId).toBeNull();
  });

  it("cannot accept with a vehicle nobody has approved, or while offline", async () => {
    const owner = await createUser();
    const badVehicle = await createDriver({ vehicleApproved: false });
    const offline = await createDriver({ online: false });
    const ride = await createRide(owner.userId);

    expect((await patch(ride.id, badVehicle, { status: "ACCEPTED" })).status).toBe(403);
    expect((await patch(ride.id, offline, { status: "ACCEPTED" })).status).toBe(403);
  });
});

describe("threat model finding 7: rides waiting for a driver", () => {
  it("are refused to a customer", async () => {
    const customer = await createUser();

    const res = await call(availableRides, request("GET", "/api/rides/available", { user: customer }));

    expect(res.status).toBe(403);
  });

  it("are refused to a driver who is not approved", async () => {
    const unapproved = await createDriver({ approved: false });

    const res = await call(availableRides, request("GET", "/api/rides/available", { user: unapproved }));

    expect(res.status).toBe(403);
  });

  it("show an approved driver the area, distance, fare and vehicle, and no name, phone or address", async () => {
    const customer = await createUser("CUSTOMER", "Test Waiting Customer");
    const ride = await createRide(customer.userId, { pickupAddress: "77 Hidden Lane, Testville, Fakecity" });
    const driver = await createDriver();

    const res = await call(availableRides, request("GET", "/api/rides/available", { user: driver }));

    expect(res.status).toBe(200);
    const list = res.body.data as Record<string, unknown>[];
    const mine = list.find((r) => r.id === ride.id);
    expect(mine).toMatchObject({ pickupArea: "Testville", vehicleType: "SEDAN", distanceKm: 9.4 });
    expect(res.text).not.toContain("77 Hidden Lane");
    expect(res.text).not.toContain(customer.phone);
    expect(res.text).not.toContain("Test Waiting Customer");
    expect(mine).not.toHaveProperty("customer");
  });
});

describe("threat model finding 9: the new-ride push to nearby drivers", () => {
  afterEach(() => {
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
  });

  it("names the area, never the pickup address", async () => {
    // The Maps package is replaced by a fake for this suite (see
    // fakes/maps-service.ts); the key only gets past the "not configured" check.
    process.env.GOOGLE_MAPS_SERVER_KEY = "fake-key-for-the-offline-fake";
    const driver = await createDriver();
    await prisma.user.update({ where: { id: driver.userId }, data: { pushToken: "ExponentPushToken[test-fanout]" } });
    const customer = await createUser();

    const res = await call(
      bookRide,
      request("POST", "/api/rides", {
        user: customer,
        body: {
          pickupAddress: "55 Secret Street, Testville, Fakecity",
          pickupLat: -26.21,
          pickupLng: 28.05,
          dropoffAddress: "1 Other Test Road, Elsewhere",
          dropoffLat: -26.25,
          dropoffLng: 28.1,
        },
      })
    );
    expect(res.status).toBe(201);
    const rideId = data(res).id;

    await eventually(() => sentPushes.some((p) => p.data?.rideId === rideId));
    const push = sentPushes.find((p) => p.data?.rideId === rideId);
    expect(push?.body).not.toContain("55 Secret Street");
    expect(push?.body).toContain("Testville");
  });

  it("is never reached when Maps is not configured: the booking answers 503 and creates nothing", async () => {
    const customer = await createUser();

    const res = await call(
      bookRide,
      request("POST", "/api/rides", {
        user: customer,
        body: { pickupAddress: "1 A St, Testville", pickupLat: -26.2, pickupLng: 28, dropoffAddress: "2 B St, Elsewhere", dropoffLat: -26.3, dropoffLng: 28.1 },
      })
    );

    expect(res.status).toBe(503);
    expect(await prisma.ride.count({ where: { customerId: customer.userId } })).toBe(0);
  });
});
