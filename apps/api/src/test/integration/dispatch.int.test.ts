import { afterAll, describe, expect, it } from "@jest/globals";
import { GET as listAvailable } from "@/app/api/deliveries/available/route";
import { POST as acceptDelivery } from "@/app/api/deliveries/[id]/accept/route";
import { PATCH as moveDelivery } from "@/app/api/deliveries/[id]/status/route";
import { GET as getOrder } from "@/app/api/orders/[id]/route";
import { POST as placeOrder } from "@/app/api/orders/route";
import { GET as getRiderMe, PATCH as patchRiderMe } from "@/app/api/riders/me/route";
import { PATCH as confirmOrder } from "@/app/api/orders/[id]/status/route";
import { sentPushes } from "./fakes/notifications";
import {
  auditRows,
  call,
  createOrder,
  createProduct,
  createRider,
  createStore,
  createUser,
  data,
  eventually,
  prisma,
  request,
  TEST_HANDOVER_CODE,
  type TestUser,
} from "./helpers";

/**
 * Local delivery end to end on the server (PLAN.md Phase 2): a rider finds a
 * waiting delivery, takes it, collects and hands it over with the customer's
 * code; the customer tracks it; a store in a complex charges the complex's fee
 * and delivers inside its radius.
 */

afterAll(async () => {
  await prisma.$disconnect();
});

const available = (user: TestUser) => call(listAvailable, request("GET", "/api/deliveries/available", { user }));
const accept = (id: string, user: TestUser) =>
  call(acceptDelivery, request("POST", `/api/deliveries/${id}/accept`, { user }), { id });
const move = (id: string, user: TestUser, body: unknown) =>
  call(moveDelivery, request("PATCH", `/api/deliveries/${id}/status`, { user, body }), { id });
const viewOrder = (id: string, user: TestUser) => call(getOrder, request("GET", `/api/orders/${id}`, { user }), { id });

/** A delivery waiting for a rider, at an order the store has confirmed. */
async function waitingDelivery(status: "CONFIRMED" | "PREPARING" | "READY_FOR_PICKUP" | "PENDING" = "CONFIRMED") {
  const customer = await createUser();
  const store = await createStore();
  const order = await createOrder(customer.userId, store.storeId, { status });
  if (!order.delivery) throw new Error("fixture order has no delivery");
  return { customer, store, orderId: order.id, deliveryId: order.delivery.id };
}

describe("finding a delivery", () => {
  it("lists a waiting delivery near the rider without anything that identifies the customer", async () => {
    const rider = await createRider();
    const { customer, deliveryId } = await waitingDelivery();

    const res = await available(rider);

    expect(res.status).toBe(200);
    const entry = (res.body.data as Record<string, unknown>[]).find((d) => d.id === deliveryId);
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({ dropoffArea: "Testville" });
    const text = JSON.stringify(entry);
    expect(text).not.toContain(customer.phone);
    expect(text).not.toContain(customer.name);
    expect(text).not.toContain("12 Test Street");
    expect(text).not.toContain("handover");
  });

  it("does not offer an order the store has not accepted yet", async () => {
    const rider = await createRider();
    const { deliveryId } = await waitingDelivery("PENDING");

    const res = await available(rider);

    expect((res.body.data as Record<string, unknown>[]).some((d) => d.id === deliveryId)).toBe(false);
  });

  it("does not offer a delivery from a store more than 10 km away", async () => {
    const rider = await createRider({ lat: -25.75, lng: 28.19 }); // about 50 km north of the test stores
    const { deliveryId } = await waitingDelivery();

    const res = await available(rider);

    expect((res.body.data as Record<string, unknown>[]).some((d) => d.id === deliveryId)).toBe(false);
  });

  it("refuses a rider who may not work, and records the refusal", async () => {
    for (const rider of [
      await createRider({ approved: false }),
      await createRider({ online: false }),
      await createRider({ vehicleApproved: false }),
      await createRider({ vehicleApproved: null }),
    ]) {
      const res = await available(rider);
      expect(res.status).toBe(403);
    }
    const refused = await prisma.auditLog.count({ where: { action: "delivery.list_available.refused" } });
    expect(refused).toBeGreaterThanOrEqual(4);
  });

  it("asks a rider with no position to share it", async () => {
    const rider = await createRider({ lat: null, lng: null });

    expect((await available(rider)).status).toBe(409);
  });

  it("is for riders only", async () => {
    const customer = await createUser();

    expect((await available(customer)).status).toBe(403);
  });
});

describe("taking a delivery", () => {
  it("gives the job to exactly one of two riders who accept at the same moment", async () => {
    const first = await createRider();
    const second = await createRider();
    const { deliveryId } = await waitingDelivery();

    const results = await Promise.all([accept(deliveryId, first), accept(deliveryId, second)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(delivery.status).toBe("ASSIGNED");
    expect([first.riderId, second.riderId]).toContain(delivery.riderId);
    expect(delivery.assignedAt).not.toBeNull();
    expect((await auditRows(deliveryId)).filter((a) => a.action === "delivery.accept")).toHaveLength(1);
  });

  it("shows the rider the customer only once the job is theirs", async () => {
    const rider = await createRider();
    const { customer, deliveryId } = await waitingDelivery();

    const res = await accept(deliveryId, rider);

    expect(res.status).toBe(200);
    const order = data(res);
    expect(order.customer).toEqual({ name: "Test", phone: customer.phone });
    expect(order.deliveryAddress).toBe("12 Test Street, Testville, Fakecity");
    expect(JSON.stringify(order)).not.toContain(TEST_HANDOVER_CODE);
  });

  it("refuses a second delivery while the rider holds one", async () => {
    const rider = await createRider();
    const one = await waitingDelivery();
    const two = await waitingDelivery();

    expect((await accept(one.deliveryId, rider)).status).toBe(200);
    const res = await accept(two.deliveryId, rider);

    expect(res.status).toBe(403);
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: two.deliveryId } })).status).toBe("PENDING");
  });

  it("refuses a rider who may not work", async () => {
    const rider = await createRider({ approved: false });
    const { deliveryId } = await waitingDelivery();

    expect((await accept(deliveryId, rider)).status).toBe(403);
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).riderId).toBeNull();
  });

  it("refuses a rider delivering their own order", async () => {
    const rider = await createRider();
    const store = await createStore();
    const order = await createOrder(rider.userId, store.storeId, { status: "CONFIRMED" });

    expect((await accept(order.delivery!.id, rider)).status).toBe(403);
  });

  it("refuses a delivery whose order the store has not accepted, or that was cancelled", async () => {
    const rider = await createRider();
    const pending = await waitingDelivery("PENDING");
    const cancelled = await waitingDelivery();
    await prisma.order.update({ where: { id: cancelled.orderId }, data: { status: "CANCELLED" } });

    expect((await accept(pending.deliveryId, rider)).status).toBe(409);
    expect((await accept(cancelled.deliveryId, rider)).status).toBe(409);
  });
});

describe("handing over", () => {
  async function outForDelivery() {
    const rider = await createRider();
    const job = await waitingDelivery("READY_FOR_PICKUP");
    expect((await accept(job.deliveryId, rider)).status).toBe(200);
    expect((await move(job.deliveryId, rider, { status: "PICKED_UP" })).status).toBe(200);
    expect((await move(job.deliveryId, rider, { status: "EN_ROUTE" })).status).toBe(200);
    return { rider, ...job };
  }

  it("completes with the customer's code, and the order is delivered", async () => {
    const { rider, orderId, deliveryId } = await outForDelivery();

    const res = await move(deliveryId, rider, { status: "DELIVERED", handoverCode: TEST_HANDOVER_CODE });

    expect(res.status).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("DELIVERED");
    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(delivery.enRouteAt).not.toBeNull();
    expect(delivery.deliveredAt).not.toBeNull();
  });

  it("refuses delivered without a code", async () => {
    const { rider, deliveryId } = await outForDelivery();

    expect((await move(deliveryId, rider, { status: "DELIVERED" })).status).toBe(400);
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).status).toBe("EN_ROUTE");
  });

  it("locks after five wrong codes, and then refuses even the right one", async () => {
    const { rider, orderId, deliveryId } = await outForDelivery();

    for (let i = 0; i < 5; i++) {
      expect((await move(deliveryId, rider, { status: "DELIVERED", handoverCode: "0000" })).status).toBe(400);
    }
    const right = await move(deliveryId, rider, { status: "DELIVERED", handoverCode: TEST_HANDOVER_CODE });

    expect(right.status).toBe(409);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("OUT_FOR_DELIVERY");
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).handoverAttempts).toBe(5);
    expect((await auditRows(deliveryId)).filter((a) => a.action === "delivery.handover.wrong_code")).toHaveLength(5);
  });

  it("counts wrong codes sent at the same moment one by one", async () => {
    const { rider, deliveryId } = await outForDelivery();

    await Promise.all([0, 1, 2].map(() => move(deliveryId, rider, { status: "DELIVERED", handoverCode: "0000" })));

    // A lost update would leave 1. Conditional writes either count or answer 409.
    const after = (await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).handoverAttempts;
    expect(after).toBeGreaterThanOrEqual(1);
    expect(after).toBe((await auditRows(deliveryId)).filter((a) => a.action === "delivery.handover.wrong_code").length);
  });
});

describe("what each party sees of a delivery", () => {
  it("gives the code to the customer and to nobody else", async () => {
    const rider = await createRider();
    const { customer, store, orderId, deliveryId } = await waitingDelivery();
    await accept(deliveryId, rider);
    const merchant = store.merchant;

    const asCustomer = data(await viewOrder(orderId, customer));
    const asRider = await viewOrder(orderId, rider);
    const asMerchant = await viewOrder(orderId, merchant);

    expect((asCustomer.delivery as Record<string, unknown>).handoverCode).toBe(TEST_HANDOVER_CODE);
    expect(asRider.text).not.toContain(TEST_HANDOVER_CODE);
    expect(asMerchant.text).not.toContain(TEST_HANDOVER_CODE);
    expect(asRider.text).not.toContain("handoverCode");
  });

  it("shows the customer where the rider is only between pickup and handover", async () => {
    const rider = await createRider();
    const { customer, orderId, deliveryId } = await waitingDelivery("READY_FOR_PICKUP");
    await accept(deliveryId, rider);

    const riderOf = async () => (data(await viewOrder(orderId, customer)).delivery as { rider: Record<string, unknown> }).rider;

    expect((await riderOf()).location).toBeNull();
    await move(deliveryId, rider, { status: "PICKED_UP" });
    expect((await riderOf()).location).toEqual({ lat: -26.203, lng: 28.043 });
    await move(deliveryId, rider, { status: "EN_ROUTE" });
    await move(deliveryId, rider, { status: "DELIVERED", handoverCode: TEST_HANDOVER_CODE });

    const after = data(await viewOrder(orderId, customer)).delivery as Record<string, unknown>;
    expect(after.handoverCode).toBeNull();
    expect(JSON.stringify(after)).not.toContain("-26.203");
  });

  it("stops showing the rider the customer's phone once the job is over", async () => {
    const rider = await createRider();
    const { customer, orderId, deliveryId } = await waitingDelivery("READY_FOR_PICKUP");
    await accept(deliveryId, rider);
    expect((await viewOrder(orderId, rider)).text).toContain(customer.phone);

    await move(deliveryId, rider, { status: "PICKED_UP" });
    await move(deliveryId, rider, { status: "EN_ROUTE" });
    await move(deliveryId, rider, { status: "DELIVERED", handoverCode: TEST_HANDOVER_CODE });

    expect((await viewOrder(orderId, rider)).text).not.toContain(customer.phone);
  });
});

describe("a store in a shopping complex", () => {
  const order = (user: TestUser, storeId: string, productId: string, point: { lat: number; lng: number }) =>
    call(
      placeOrder,
      request("POST", "/api/orders", {
        user,
        body: {
          storeId,
          items: [{ productId, quantity: 1 }],
          deliveryAddress: "3 Test Lane, Testville, Fakecity",
          deliveryLat: point.lat,
          deliveryLng: point.lng,
        },
      })
    );

  it("charges the complex's delivery fee, not the store's", async () => {
    const customer = await createUser();
    const { storeId } = await createStore({ complex: { fee: "18.00" } });
    const product = await createProduct(storeId, { price: "40.00" });

    const res = await order(customer, storeId, product.id, { lat: -26.21, lng: 28.05 });

    expect(res.status).toBe(201);
    expect(data(res)).toMatchObject({ deliveryFee: "18", total: "58" });
  });

  it("refuses an address outside the complex's radius, before anything is taken", async () => {
    const customer = await createUser();
    const { storeId } = await createStore({ complex: { radiusKm: 5 } });
    const product = await createProduct(storeId, { stock: 3 });

    const res = await order(customer, storeId, product.id, { lat: -26.0, lng: 28.04 }); // about 22 km away

    expect(res.status).toBe(400);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(3);
    expect(await prisma.order.count({ where: { customerId: customer.userId } })).toBe(0);
  });

  it("leaves a stand-alone store with its own fee and no radius", async () => {
    const customer = await createUser();
    const { storeId } = await createStore();
    const product = await createProduct(storeId, { price: "40.00" });

    const res = await order(customer, storeId, product.id, { lat: -26.0, lng: 28.04 });

    expect(res.status).toBe(201);
    expect(data(res)).toMatchObject({ deliveryFee: "15", total: "55" });
  });

  it("gives every new order a 4-digit handover code, stored encrypted", async () => {
    const customer = await createUser();
    const { storeId } = await createStore();
    const product = await createProduct(storeId);

    const res = await order(customer, storeId, product.id, { lat: -26.21, lng: 28.05 });

    const code = (data(res).delivery as Record<string, unknown>).handoverCode as string;
    expect(code).toMatch(/^\d{4}$/);
    const stored = await prisma.delivery.findFirstOrThrow({ where: { orderId: data(res).id as string } });
    expect(stored.handoverCodeEnc).toMatch(/^v1\./);
    expect(stored.handoverCodeEnc).not.toContain(code);
  });
});

describe("a rider's own status", () => {
  const patch = (user: TestUser, body: unknown) => call(patchRiderMe, request("PATCH", "/api/riders/me", { user, body }));

  it("cannot go online before approval", async () => {
    const rider = await createRider({ approved: false, online: false });

    expect((await patch(rider, { isOnline: true })).status).toBe(403);
  });

  it("forgets the position on going offline", async () => {
    const rider = await createRider();

    expect((await patch(rider, { isOnline: false })).status).toBe(200);
    const stored = await prisma.rider.findUniqueOrThrow({ where: { id: rider.riderId } });
    expect([stored.currentLat, stored.currentLng]).toEqual([null, null]);
  });

  it("returns the rider's own profile without their ID number or position", async () => {
    const rider = await createRider();

    const res = await call(getRiderMe, request("GET", "/api/riders/me", { user: rider }));

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("idNumberEnc");
    expect(res.text).not.toContain("-26.203");
  });
});

describe("telling riders about a new job", () => {
  const confirm = (orderId: string, user: TestUser) =>
    call(confirmOrder, request("PATCH", `/api/orders/${orderId}/status`, { user, body: { status: "CONFIRMED" } }), {
      id: orderId,
    });

  async function riderWithToken(token: string, options: Parameters<typeof createRider>[0] = {}) {
    const rider = await createRider(options);
    await prisma.user.update({ where: { id: rider.userId }, data: { pushToken: token } });
    return rider;
  }

  it("pushes nearby riders who could take it when the store confirms, with the store and fee only", async () => {
    const near = `ExponentPushToken[near-${Date.now()}]`;
    const far = `ExponentPushToken[far-${Date.now()}]`;
    const offline = `ExponentPushToken[offline-${Date.now()}]`;
    const busy = `ExponentPushToken[busy-${Date.now()}]`;
    await riderWithToken(near);
    await riderWithToken(far, { lat: -25.75, lng: 28.19 });
    await riderWithToken(offline, { online: false });
    const busyRider = await riderWithToken(busy);
    const busyJob = await waitingDelivery();
    expect((await accept(busyJob.deliveryId, busyRider)).status).toBe(200);

    const { customer, store, orderId, deliveryId } = await waitingDelivery("PENDING");
    expect((await confirm(orderId, store.merchant)).status).toBe(200);

    await eventually(() => sentPushes.some((p) => p.data?.deliveryId === deliveryId));
    const push = sentPushes.find((p) => p.data?.deliveryId === deliveryId)!;
    expect(push.title).toMatch(/New delivery near you/);
    expect(push.tokens).toContain(near);
    for (const token of [far, offline, busy]) expect(push.tokens).not.toContain(token);
    expect(push.body).not.toContain(customer.name);
    expect(push.body).not.toContain("Test Street");
  });

  it("does not push riders for an order the store has not confirmed", async () => {
    const token = `ExponentPushToken[quiet-${Date.now()}]`;
    await riderWithToken(token);
    const { store, orderId } = await waitingDelivery("PENDING");

    await call(confirmOrder, request("PATCH", `/api/orders/${orderId}/status`, { user: store.merchant, body: { status: "CANCELLED", cancelReason: "Out of stock" } }), {
      id: orderId,
    });

    expect(sentPushes.some((p) => p.tokens.includes(token))).toBe(false);
  });
});

describe("an order sent without a delivery point", () => {
  const orderAt = (user: TestUser, storeId: string, productId: string, point: Record<string, number>) =>
    call(
      placeOrder,
      request("POST", "/api/orders", {
        user,
        body: { storeId, items: [{ productId, quantity: 1 }], deliveryAddress: "3 Test Lane, Testville, Fakecity", ...point },
      })
    );

  it("treats the old app's 0,0 placeholder as no point, not as a place 6,000 km from the complex", async () => {
    const customer = await createUser();
    const { storeId } = await createStore({ complex: {} });
    const product = await createProduct(storeId);

    const res = await orderAt(customer, storeId, product.id, { deliveryLat: 0, deliveryLng: 0 });

    // No point means the address must be geocoded for the zone check, and this
    // suite has no Maps key: 503, the answer booking a ride gives. Not 400
    // "outside the delivery zone".
    expect(res.status).toBe(503);
  });

  it("still places an order at a stand-alone store, which has no zone to check", async () => {
    const customer = await createUser();
    const { storeId } = await createStore();
    const product = await createProduct(storeId);

    expect((await orderAt(customer, storeId, product.id, { deliveryLat: 0, deliveryLng: 0 })).status).toBe(201);
    expect((await orderAt(customer, storeId, product.id, {})).status).toBe(201);
  });
});
