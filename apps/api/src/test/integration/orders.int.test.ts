import { afterAll, describe, expect, it } from "@jest/globals";
import { GET as listOrders, POST as placeOrder } from "@/app/api/orders/route";
import { GET as getOrder } from "@/app/api/orders/[id]/route";
import { PATCH as patchOrderStatus } from "@/app/api/orders/[id]/status/route";
import {
  auditRows,
  call,
  createOrder,
  createProduct,
  createStore,
  createUser,
  data,
  items,
  prisma,
  request,
  type TestUser,
} from "./helpers";

/**
 * Orders: who may list, read, place and move them. Each `describe` names the
 * hole in PLAN.md section 2 or the finding in docs/threat-model.md it closes.
 */

afterAll(async () => {
  await prisma.$disconnect();
});

const setStatus = (id: string, user: TestUser | undefined, body: unknown) =>
  call(patchOrderStatus, request("PATCH", `/api/orders/${id}/status`, { user, body }), { id });

const order = (user: TestUser, body: unknown) => call(placeOrder, request("POST", "/api/orders", { user, body }));

describe("hole 1: the order list", () => {
  it("answers a request without a token with 401, not with every order and address", async () => {
    const customer = await createUser();
    const { storeId } = await createStore();
    await createOrder(customer.userId, storeId);

    const res = await call(listOrders, request("GET", "/api/orders"));

    expect(res.status).toBe(401);
    expect(res.text).not.toContain("12 Test Street");
  });

  it("shows a customer their own orders and a merchant their own stores' orders only", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const shopA = await createStore();
    const shopB = await createStore();
    const aliceAtA = await createOrder(alice.userId, shopA.storeId);
    const bobAtB = await createOrder(bob.userId, shopB.storeId);

    const asAlice = items(await call(listOrders, request("GET", "/api/orders", { user: alice }))).map((o) => o.id);
    const asMerchantA = items(await call(listOrders, request("GET", "/api/orders", { user: shopA.merchant }))).map(
      (o) => o.id
    );

    expect(asAlice).toContain(aliceAtA.id);
    expect(asAlice).not.toContain(bobAtB.id);
    expect(asMerchantA).toContain(aliceAtA.id);
    expect(asMerchantA).not.toContain(bobAtB.id);
  });

  it("answers an unknown status filter with 400", async () => {
    const customer = await createUser();

    const res = await call(listOrders, request("GET", "/api/orders?status=EATEN", { user: customer }));

    expect(res.status).toBe(400);
  });
});

describe("a customer reading another customer's order", () => {
  it("gets 404, as if the order did not exist, and the attempt is audited", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const { storeId } = await createStore();
    const placed = await createOrder(owner.userId, storeId);

    const res = await call(getOrder, request("GET", `/api/orders/${placed.id}`, { user: stranger }), { id: placed.id });
    const own = await call(getOrder, request("GET", `/api/orders/${placed.id}`, { user: owner }), { id: placed.id });

    expect(res.status).toBe(404);
    expect(own.status).toBe(200);
    expect((await auditRows(placed.id)).map((a) => a.action)).toContain("order.read.refused");
  });
});

describe("hole 5: changing an order's status", () => {
  it("refuses another customer who tries to mark someone's order delivered, and leaves it alone", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const { storeId } = await createStore();
    const placed = await createOrder(owner.userId, storeId);

    const res = await setStatus(placed.id, stranger, { status: "DELIVERED" });

    expect(res.status).toBe(404);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: placed.id } })).status).toBe("PENDING");
  });

  it("refuses the merchant of a different store", async () => {
    const owner = await createUser();
    const mine = await createStore();
    const rival = await createStore();
    const placed = await createOrder(owner.userId, mine.storeId);

    const res = await setStatus(placed.id, rival.merchant, { status: "CANCELLED" });

    expect(res.status).toBe(404);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: placed.id } })).status).toBe("PENDING");
  });

  it("refuses the store's own merchant who tries to send the order out or mark it delivered without a rider", async () => {
    const owner = await createUser();
    const { storeId, merchant } = await createStore();
    const ready = await createOrder(owner.userId, storeId, { status: "READY_FOR_PICKUP" });
    const out = await createOrder(owner.userId, storeId, { status: "OUT_FOR_DELIVERY" });

    const sendOut = await setStatus(ready.id, merchant, { status: "OUT_FOR_DELIVERY" });
    const deliver = await setStatus(out.id, merchant, { status: "DELIVERED" });

    expect([sendOut.status, deliver.status]).toEqual([403, 403]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: ready.id } })).status).toBe("READY_FOR_PICKUP");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: out.id } })).status).toBe("OUT_FOR_DELIVERY");
  });

  it("lets the merchant confirm a pending order, stamps it, and audits it with from and to", async () => {
    const owner = await createUser();
    const { storeId, merchant } = await createStore();
    const placed = await createOrder(owner.userId, storeId);

    const res = await setStatus(placed.id, merchant, { status: "CONFIRMED" });

    expect(res.status).toBe(200);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(after.status).toBe("CONFIRMED");
    expect(after.confirmedAt).not.toBeNull();
    const audit = (await auditRows(placed.id)).find((a) => a.action === "order.confirm");
    expect(audit?.detail).toMatchObject({ from: "PENDING", to: "CONFIRMED" });
  });

  it("lets the customer cancel while the order is pending and not once the store has confirmed it", async () => {
    const owner = await createUser();
    const { storeId } = await createStore();
    const pending = await createOrder(owner.userId, storeId);
    const confirmed = await createOrder(owner.userId, storeId, { status: "CONFIRMED" });

    expect((await setStatus(pending.id, owner, { status: "CANCELLED" })).status).toBe(200);
    expect((await setStatus(confirmed.id, owner, { status: "CANCELLED" })).status).toBe(403);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: pending.id } })).cancelledBy).toBe("CUSTOMER");
  });

  it("refuses to confirm an order the customer has already cancelled", async () => {
    const owner = await createUser();
    const { storeId, merchant } = await createStore();
    const placed = await createOrder(owner.userId, storeId, { status: "CANCELLED" });

    const res = await setStatus(placed.id, merchant, { status: "CONFIRMED" });

    expect(res.status).toBe(409);
  });

  it("answers a status it does not know with 400", async () => {
    const owner = await createUser();
    const { storeId, merchant } = await createStore();
    const placed = await createOrder(owner.userId, storeId);

    expect((await setStatus(placed.id, merchant, { status: "EATEN" })).status).toBe(400);
  });
});

describe("threat model finding 11: placing an order", () => {
  it("refuses a product from another store and creates nothing", async () => {
    const customer = await createUser();
    const cheap = await createStore();
    const other = await createStore();
    const foreign = await createProduct(other.storeId, { price: "99.00", stock: 5 });

    const res = await order(customer, {
      storeId: cheap.storeId,
      deliveryAddress: "12 Test Street, Testville",
      items: [{ productId: foreign.id, quantity: 1 }],
    });

    expect(res.status).toBe(400);
    expect(await prisma.order.count({ where: { customerId: customer.userId } })).toBe(0);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: foreign.id } })).stock).toBe(5);
  });

  it("refuses an order from a closed store", async () => {
    const customer = await createUser();
    const closed = await createStore({ open: false });
    const product = await createProduct(closed.storeId);

    const res = await order(customer, {
      storeId: closed.storeId,
      deliveryAddress: "12 Test Street, Testville",
      items: [{ productId: product.id, quantity: 1 }],
    });

    expect(res.status).toBe(409);
    expect(await prisma.order.count({ where: { customerId: customer.userId } })).toBe(0);
  });

  it("refuses more than the stock and takes the stock when it fits", async () => {
    const customer = await createUser();
    const { storeId } = await createStore();
    const product = await createProduct(storeId, { stock: 2 });
    const body = (quantity: number) => ({
      storeId,
      deliveryAddress: "12 Test Street, Testville",
      items: [{ productId: product.id, quantity }],
    });

    expect((await order(customer, body(3))).status).toBe(409);
    expect((await order(customer, body(2))).status).toBe(201);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(0);
  });

  it("sums money exactly, as decimals, and prices from the server", async () => {
    const customer = await createUser();
    const { storeId } = await createStore();
    const dime = await createProduct(storeId, { price: "0.10" });
    const twenty = await createProduct(storeId, { price: "0.20" });

    const res = await order(customer, {
      storeId,
      deliveryAddress: "12 Test Street, Testville",
      items: [
        { productId: dime.id, quantity: 1 },
        { productId: twenty.id, quantity: 1 },
      ],
    });

    expect(res.status).toBe(201);
    expect(data(res)).toMatchObject({ subtotal: "0.3", deliveryFee: "15", total: "15.3" });
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: data(res).id as string } });
    expect(saved.total.toFixed(2)).toBe("15.30");
  });

  it("gives the stock back when the order is cancelled", async () => {
    const customer = await createUser();
    const { storeId } = await createStore();
    const product = await createProduct(storeId, { stock: 4 });

    const res = await order(customer, {
      storeId,
      deliveryAddress: "12 Test Street, Testville",
      items: [{ productId: product.id, quantity: 3 }],
    });
    await setStatus(data(res).id as string, customer, { status: "CANCELLED" });

    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(4);
  });
});
