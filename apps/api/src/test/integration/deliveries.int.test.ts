import { afterAll, describe, expect, it } from "@jest/globals";
import { PATCH as patchDelivery } from "@/app/api/deliveries/[id]/status/route";
import {
  auditRows,
  call,
  createOrder,
  createRider,
  createStore,
  createUser,
  prisma,
  request,
  type TestUser,
} from "./helpers";

/**
 * The rider's leg. Riders are assigned directly in these fixtures because
 * dispatch is Phase 2; what is under test is that only the assigned rider can
 * move a delivery, one step at a time, with the order kept in step.
 */

afterAll(async () => {
  await prisma.$disconnect();
});

const move = (id: string, user: TestUser | undefined, body: unknown) =>
  call(patchDelivery, request("PATCH", `/api/deliveries/${id}/status`, { user, body }), { id });

async function readyOrderFor(riderId: string, status: "READY_FOR_PICKUP" | "PREPARING" = "READY_FOR_PICKUP") {
  const customer = await createUser();
  const { storeId } = await createStore();
  const placed = await createOrder(customer.userId, storeId, { status, riderId });
  if (!placed.delivery) throw new Error("fixture order has no delivery");
  return { orderId: placed.id, deliveryId: placed.delivery.id };
}

describe("a delivery", () => {
  it("goes from assigned to delivered by its rider, with the order following in the same transactions", async () => {
    const rider = await createRider();
    const { orderId, deliveryId } = await readyOrderFor(rider.riderId);

    expect((await move(deliveryId, rider, { status: "PICKED_UP" })).status).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("OUT_FOR_DELIVERY");
    expect((await move(deliveryId, rider, { status: "EN_ROUTE" })).status).toBe(200);
    expect((await move(deliveryId, rider, { status: "DELIVERED" })).status).toBe(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("DELIVERED");
    expect(order.deliveredAt).not.toBeNull();
    const actions = [...(await auditRows(deliveryId)), ...(await auditRows(orderId))].map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(["delivery.pick_up", "delivery.en_route", "delivery.deliver", "order.out_for_delivery", "order.delivered"])
    );
  });

  it("cannot skip a step: an assigned delivery cannot be marked delivered", async () => {
    const rider = await createRider();
    const { deliveryId, orderId } = await readyOrderFor(rider.riderId);

    const res = await move(deliveryId, rider, { status: "DELIVERED" });

    expect(res.status).toBe(409);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("READY_FOR_PICKUP");
  });

  it("answers another rider with 404 and changes nothing", async () => {
    const rider = await createRider();
    const other = await createRider();
    const { deliveryId } = await readyOrderFor(rider.riderId);

    const res = await move(deliveryId, other, { status: "PICKED_UP" });

    expect(res.status).toBe(404);
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).status).toBe("ASSIGNED");
  });

  it("cannot be picked up before the store has marked the order ready", async () => {
    const rider = await createRider();
    const { deliveryId } = await readyOrderFor(rider.riderId, "PREPARING");

    const res = await move(deliveryId, rider, { status: "PICKED_UP" });

    expect(res.status).toBe(409);
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).status).toBe("ASSIGNED");
  });

  it("can fail on the way, leaving the order out for delivery for an admin to resolve", async () => {
    const rider = await createRider();
    const { deliveryId, orderId } = await readyOrderFor(rider.riderId);
    await move(deliveryId, rider, { status: "PICKED_UP" });

    const res = await move(deliveryId, rider, { status: "FAILED", failReason: "Nobody home" });

    expect(res.status).toBe(200);
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).failReason).toBe("Nobody home");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("OUT_FOR_DELIVERY");
  });

  it("answers a request without a token with 401", async () => {
    const rider = await createRider();
    const { deliveryId } = await readyOrderFor(rider.riderId);

    expect((await move(deliveryId, undefined, { status: "PICKED_UP" })).status).toBe(401);
  });
});
