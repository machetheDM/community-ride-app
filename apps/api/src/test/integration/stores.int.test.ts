import { afterAll, describe, expect, it } from "@jest/globals";
import { GET as listStores } from "@/app/api/stores/route";
import { GET as getStore } from "@/app/api/stores/[id]/route";
import { call, createProduct, createStore, data, prisma, request } from "./helpers";

/**
 * The public store list and page. Public on purpose, so these call without a
 * token, as a customer browsing before sign-in would.
 */

afterAll(async () => {
  await prisma.$disconnect();
});

describe("threat model finding 13: store responses", () => {
  it("do not carry the merchant id in the list, the value that forged the old portal cookie", async () => {
    const { storeId, merchant } = await createStore();

    const res = await call(listStores, request("GET", "/api/stores"));

    expect(res.status).toBe(200);
    expect((res.body.data as { id: string }[]).some((s) => s.id === storeId)).toBe(true);
    expect(res.text).not.toContain("merchantId");
    expect(res.text).not.toContain(merchant.merchantId);
  });

  it("do not carry the merchant id, the store's phone or stock counts on the store page", async () => {
    const { storeId, merchant } = await createStore();
    await createProduct(storeId, { stock: 7 });
    const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });

    const res = await call(getStore, request("GET", `/api/stores/${storeId}`), { id: storeId });

    expect(res.status).toBe(200);
    expect(data(res).name).toBe(store.name);
    expect(res.text).not.toContain("merchantId");
    expect(res.text).not.toContain(merchant.merchantId);
    expect(res.text).not.toContain(store.phone);
    expect(res.text).not.toContain('"stock"');
  });

  it("answer 404 for a store that is not approved", async () => {
    const { storeId } = await createStore({ approved: false });

    const res = await call(getStore, request("GET", `/api/stores/${storeId}`), { id: storeId });

    expect(res.status).toBe(404);
  });
});
