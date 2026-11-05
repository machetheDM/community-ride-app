import { afterAll, afterEach, describe, expect, it } from "@jest/globals";
import { GET as listDrivers } from "@/app/api/drivers/route";
import { GET as getMe, PATCH as patchMe } from "@/app/api/drivers/me/route";
import { GET as getRide } from "@/app/api/rides/[id]/route";
import { __resetArrivalNotifications } from "@/lib/arrival";
// The modules the routes get for `@ride/maps-service` and `@/lib/notifications`.
import { etaCalls } from "./fakes/maps-service";
import { sentPushes } from "./fakes/notifications";
import { call, createDriver, createRide, createUser, data, eventually, prisma, request, type TestUser } from "./helpers";

/**
 * Operators: the roster, their own profile and the position they report. The
 * roster is the request a person hunting operators would poll (threat model
 * RD-6), so it is tested hardest.
 */

afterAll(async () => {
  await prisma.$disconnect();
});

const update = (user: TestUser, body: unknown) => call(patchMe, request("PATCH", "/api/drivers/me", { user, body }));

describe("hole 3: the driver roster", () => {
  it("answers a request without a token with 401", async () => {
    await createDriver();

    const res = await call(listDrivers, request("GET", "/api/drivers"));

    expect(res.status).toBe(401);
  });

  it("refuses a customer", async () => {
    const customer = await createUser();

    const res = await call(listDrivers, request("GET", "/api/drivers", { user: customer }));

    expect(res.status).toBe(403);
  });

  it("gives an admin the roster with no ID number and no licence number", async () => {
    await createDriver();
    const admin = await createUser("ADMIN");

    const res = await call(listDrivers, request("GET", "/api/drivers", { user: admin }));

    expect(res.status).toBe(200);
    expect((res.body.data as unknown[]).length).toBeGreaterThan(0);
    for (const field of ["idNumberEnc", "idNumberHash", "licenseNumber", "TEST-LIC-", "test-ciphertext"]) {
      expect(res.text).not.toContain(field);
    }
    expect(res.text).toContain("idNumberLast4");
  });
});

describe("threat model finding 6: drivers' live locations", () => {
  it("are not handed to a stranger asking for every online driver", async () => {
    await createDriver({ lat: -26.123456, lng: 28.654321 });

    const anonymous = await call(listDrivers, request("GET", "/api/drivers?isOnline=true"));
    const customer = await call(
      listDrivers,
      request("GET", "/api/drivers?isOnline=true", { user: await createUser() })
    );

    for (const res of [anonymous, customer]) {
      expect(res.status).toBeGreaterThanOrEqual(401);
      expect(res.text).not.toContain("-26.123456");
    }
  });

  it("are not in the customer's view of their own active trip", async () => {
    const customer = await createUser();
    const driver = await createDriver({ lat: -26.111111, lng: 28.222222 });
    const ride = await createRide(customer.userId, { status: "ACCEPTED", driverId: driver.driverId });

    const res = await call(getRide, request("GET", `/api/rides/${ride.id}`, { user: customer }), { id: ride.id });

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("currentLat");
    expect(res.text).not.toContain("-26.111111");
    // What the customer does get during the trip: who, how to call, which car.
    expect(res.text).toContain(driver.phone);
  });

  it("are not in the driver's own profile either", async () => {
    const driver = await createDriver({ lat: -26.333333, lng: 28.444444 });

    const res = await call(getMe, request("GET", "/api/drivers/me", { user: driver }));

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("-26.333333");
    expect(res.text).not.toContain("licenseNumber");
  });
});

describe("threat model finding 8: PATCH /api/drivers/me", () => {
  afterEach(() => {
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
    __resetArrivalNotifications();
  });

  it("refuses a position off the globe and stores nothing", async () => {
    const driver = await createDriver({ lat: -26.2, lng: 28.04 });

    const res = await update(driver, { currentLat: 999, currentLng: 28 });

    expect(res.status).toBe(400);
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: driver.driverId } })).currentLat).toBe(-26.2);
  });

  it("refuses a heading that is not a number of degrees, and an online flag that is not a boolean", async () => {
    const driver = await createDriver();

    expect((await update(driver, { heading: "north" })).status).toBe(400);
    expect((await update(driver, { isOnline: "yes" })).status).toBe(400);
  });

  it("refuses to let an operator who is not approved go online", async () => {
    const driver = await createDriver({ approved: false, online: false });

    const res = await update(driver, { isOnline: true });

    expect(res.status).toBe(403);
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: driver.driverId } })).isOnline).toBe(false);
  });

  it("refuses to let a driver with an unapproved vehicle go online", async () => {
    const driver = await createDriver({ online: false, vehicleApproved: false });

    expect((await update(driver, { isOnline: true })).status).toBe(403);
  });

  it("keeps no position from an unapproved operator and spends no ETA call or push on it", async () => {
    process.env.GOOGLE_MAPS_SERVER_KEY = "fake-key-for-the-offline-fake";
    // The state the old route allowed: an unapproved operator holding a ride.
    const driver = await createDriver({ approved: false, online: true, lat: -26.5, lng: 28.5 });
    const customer = await createUser();
    await prisma.user.update({ where: { id: customer.userId }, data: { pushToken: "ExponentPushToken[test-arrival-1]" } });
    await createRide(customer.userId, { status: "ACCEPTED", driverId: driver.driverId });
    const near = { currentLat: -26.2105, currentLng: 28.0505 };
    const etaBefore = etaCalls.length;

    const res = await update(driver, near);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(res.status).toBe(200);
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: driver.driverId } })).currentLat).toBe(-26.5);
    expect(etaCalls.slice(etaBefore).some((c) => c.origin.lat === near.currentLat)).toBe(false);
    expect(sentPushes.some((p) => p.tokens.includes("ExponentPushToken[test-arrival-1]"))).toBe(false);
  });

  it("does store an approved, online driver's position and runs the arrival check for it", async () => {
    // The control for the test above: the same request from an approved driver
    // reaches the ETA call, so the silence above is the policy, not a broken path.
    process.env.GOOGLE_MAPS_SERVER_KEY = "fake-key-for-the-offline-fake";
    const driver = await createDriver();
    const customer = await createUser();
    await prisma.user.update({ where: { id: customer.userId }, data: { pushToken: "ExponentPushToken[test-arrival-2]" } });
    await createRide(customer.userId, { status: "ACCEPTED", driverId: driver.driverId });
    const etaBefore = etaCalls.length;

    const res = await update(driver, { currentLat: -26.2105, currentLng: 28.0505 });

    expect(res.status).toBe(200);
    await eventually(() => etaCalls.slice(etaBefore).some((c) => c.origin.lat === -26.2105));
    expect((await prisma.driver.findUniqueOrThrow({ where: { id: driver.driverId } })).currentLat).toBe(-26.2105);
  });

  it("forgets the last position when the driver goes offline", async () => {
    const driver = await createDriver();

    const res = await update(driver, { isOnline: false });

    expect(res.status).toBe(200);
    expect(data(res).isOnline).toBe(false);
    const after = await prisma.driver.findUniqueOrThrow({ where: { id: driver.driverId } });
    expect([after.currentLat, after.currentLng]).toEqual([null, null]);
  });
});
