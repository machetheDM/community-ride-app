import { describe, it, expect, beforeAll, beforeEach, jest } from "@jest/globals";
import { signPortalSession } from "@ride/db/session";
import { createFakeDb } from "./fakes/fake-db";

/**
 * The merchant portal's `getSession()`, run from the API suite (the portal has no
 * test runner) with the cookie jar and the database replaced. The signature is
 * tested in session.test.ts; this is the other half, the database checks that end
 * a session a valid signature would keep alive.
 */

const db = createFakeDb();
let cookieValue: string | undefined;
let getSession: () => Promise<{ userId: string; role: string; merchantId: string | null } | null>;

beforeAll(async () => {
  jest.doMock("next/headers", () => ({
    cookies: async () => ({ get: () => (cookieValue === undefined ? undefined : { value: cookieValue }) }),
  }));
  jest.doMock("@ride/db", () => ({ prisma: db }));
  getSession = (await import("../../../../merchant-portal/src/lib/session")).getSession;
});

beforeEach(() => {
  db.reset();
  cookieValue = undefined;
});

const cookieFor = (user: { id: string; role: "MERCHANT" | "ADMIN"; tokenVersion: number }) =>
  signPortalSession({ userId: user.id, role: user.role, tokenVersion: user.tokenVersion });

describe("the portal's getSession", () => {
  it("returns the merchant id from the database, not from the cookie", async () => {
    const user = db.addUser({ phone: "+27810000001", role: "MERCHANT", merchantProfile: { id: "merchant_1" } });
    cookieValue = cookieFor({ id: user.id, role: "MERCHANT", tokenVersion: 0 });
    await expect(getSession()).resolves.toMatchObject({ userId: user.id, role: "MERCHANT", merchantId: "merchant_1" });
  });

  it("refuses a forged cookie naming another merchant", async () => {
    const victim = db.addUser({ phone: "+27810000002", role: "MERCHANT", merchantProfile: { id: "merchant_2" } });
    cookieValue = JSON.stringify({ userId: victim.id, merchantId: "merchant_2", name: "Victim" });
    await expect(getSession()).resolves.toBeNull();
  });

  it("ends the session once the account is suspended", async () => {
    const user = db.addUser({ phone: "+27810000001", role: "MERCHANT", merchantProfile: { id: "merchant_1" } });
    cookieValue = cookieFor({ id: user.id, role: "MERCHANT", tokenVersion: 0 });
    user.isActive = false;
    await expect(getSession()).resolves.toBeNull();
  });

  it("ends every session issued before 'sign out everywhere'", async () => {
    const user = db.addUser({ phone: "+27810000001", role: "MERCHANT", merchantProfile: { id: "merchant_1" } });
    cookieValue = cookieFor({ id: user.id, role: "MERCHANT", tokenVersion: 0 });
    user.tokenVersion = 1;
    await expect(getSession()).resolves.toBeNull();
  });

  it("ends an admin session once the account is no longer an admin", async () => {
    const user = db.addUser({ phone: "+27810000000", role: "ADMIN" });
    cookieValue = cookieFor({ id: user.id, role: "ADMIN", tokenVersion: 0 });
    user.role = "MERCHANT";
    user.merchantProfile = { id: "merchant_3" };
    await expect(getSession()).resolves.toBeNull();
  });

  it("gives an admin without a store a session with no merchant id", async () => {
    const user = db.addUser({ phone: "+27810000000", role: "ADMIN" });
    cookieValue = cookieFor({ id: user.id, role: "ADMIN", tokenVersion: 0 });
    await expect(getSession()).resolves.toMatchObject({ role: "ADMIN", merchantId: null });
  });

  it("refuses a merchant with no merchant profile, and anyone with no cookie", async () => {
    const user = db.addUser({ phone: "+27810000001", role: "MERCHANT" });
    cookieValue = cookieFor({ id: user.id, role: "MERCHANT", tokenVersion: 0 });
    await expect(getSession()).resolves.toBeNull();
    cookieValue = undefined;
    await expect(getSession()).resolves.toBeNull();
  });
});
