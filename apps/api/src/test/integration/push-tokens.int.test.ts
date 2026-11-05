import { afterAll, describe, expect, it } from "@jest/globals";
import { GET as listRides } from "@/app/api/rides/route";
import { GET as getRide, PATCH as patchRide } from "@/app/api/rides/[id]/route";
import { GET as listOrders } from "@/app/api/orders/route";
import { PATCH as patchOrderStatus } from "@/app/api/orders/[id]/status/route";
import { GET as getMe } from "@/app/api/drivers/me/route";
import { POST as registerToken } from "@/app/api/users/push-token/route";
import { call, createDriver, createOrder, createStore, createUser, prisma, request, type CallResult } from "./helpers";

/**
 * Threat model finding 16 (PU-1): push tokens in responses. A token is enough
 * to send that phone a fake "your driver is outside, pay by EFT" message, and
 * the ride and order status responses used to return the customer's.
 */

afterAll(async () => {
  await prisma.$disconnect();
});

function expectNoToken(res: CallResult, ...tokens: string[]) {
  expect(res.text).not.toContain("pushToken");
  for (const token of tokens) expect(res.text).not.toContain(token);
}

describe("threat model finding 16: push tokens", () => {
  it("never appear in ride responses, to the driver or the customer", async () => {
    const customerToken = "ExponentPushToken[test-customer-ride]";
    const driverToken = "ExponentPushToken[test-driver-ride]";
    const customer = await createUser();
    const driver = await createDriver();
    await prisma.user.update({ where: { id: customer.userId }, data: { pushToken: customerToken } });
    await prisma.user.update({ where: { id: driver.userId }, data: { pushToken: driverToken } });
    const ride = await prisma.ride.create({
      data: {
        customerId: customer.userId,
        pickupAddress: "12 Test Street, Testville",
        pickupLat: -26.2,
        pickupLng: 28,
        dropoffAddress: "1 Other Road, Elsewhere",
        dropoffLat: -26.3,
        dropoffLng: 28.1,
        fareEstimate: "50.00",
      },
    });

    const accepted = await call(
      patchRide,
      request("PATCH", `/api/rides/${ride.id}`, { user: driver, body: { status: "ACCEPTED" } }),
      { id: ride.id }
    );
    expect(accepted.status).toBe(200);
    expectNoToken(accepted, customerToken, driverToken);

    expectNoToken(await call(getRide, request("GET", `/api/rides/${ride.id}`, { user: customer }), { id: ride.id }), customerToken, driverToken);
    expectNoToken(await call(listRides, request("GET", "/api/rides", { user: customer })), customerToken, driverToken);
    expectNoToken(await call(getMe, request("GET", "/api/drivers/me", { user: driver })), driverToken);
  });

  it("never appear in order responses, to the merchant or the customer", async () => {
    const customerToken = "ExponentPushToken[test-customer-order]";
    const customer = await createUser();
    await prisma.user.update({ where: { id: customer.userId }, data: { pushToken: customerToken } });
    const { storeId, merchant } = await createStore();
    const placed = await createOrder(customer.userId, storeId);

    const confirmed = await call(
      patchOrderStatus,
      request("PATCH", `/api/orders/${placed.id}/status`, { user: merchant, body: { status: "CONFIRMED" } }),
      { id: placed.id }
    );
    expect(confirmed.status).toBe(200);
    expectNoToken(confirmed, customerToken);
    expectNoToken(await call(listOrders, request("GET", "/api/orders", { user: merchant })), customerToken);
  });

  it("are not echoed back when a phone registers one", async () => {
    const user = await createUser();
    const token = "ExponentPushToken[test-register]";

    const res = await call(registerToken, request("POST", "/api/users/push-token", { user, body: { token } }));

    expect(res.status).toBe(200);
    expect(res.text).not.toContain(token);
  });
});
