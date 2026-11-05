import { describe, it, expect } from "@jest/globals";
import {
  accessForPath,
  isMerchantSettableOrderStatus,
  mayOpen,
  navFor,
  PORTAL_PAGES,
  type PortalPrincipal,
} from "../../../../merchant-portal/src/lib/access";

/**
 * The merchant portal's role guard, tested from the API suite because the portal
 * has no test runner. Pure functions only; the pages and actions call them.
 */

const merchant: PortalPrincipal = { role: "MERCHANT", merchantId: "merchant_1" };
const adminWithoutStore: PortalPrincipal = { role: "ADMIN", merchantId: null };
const adminWithStore: PortalPrincipal = { role: "ADMIN", merchantId: "merchant_9" };

const ADMIN_PAGES = ["users", "drivers", "riders", "stores", "payments", "settings", "analytics"];

describe("mayOpen", () => {
  it.each(ADMIN_PAGES)("refuses a merchant the %s page", (page) => {
    expect(mayOpen(merchant, accessForPath(`/dashboard/${page}`)!)).toBe(false);
  });

  it.each(ADMIN_PAGES)("lets an admin open the %s page", (page) => {
    expect(mayOpen(adminWithoutStore, accessForPath(`/dashboard/${page}`)!)).toBe(true);
  });

  it("lets a merchant open the overview, orders and store pages", () => {
    for (const path of ["/dashboard", "/dashboard/orders", "/dashboard/store"]) {
      expect(mayOpen(merchant, accessForPath(path)!)).toBe(true);
    }
  });

  it("sends an admin without a store nowhere near the merchant pages", () => {
    expect(mayOpen(adminWithoutStore, "merchant")).toBe(false);
    expect(mayOpen(adminWithoutStore, "any")).toBe(true);
  });

  it("lets an admin who runs a store open its merchant pages", () => {
    expect(mayOpen(adminWithStore, "merchant")).toBe(true);
  });

  it("refuses a merchant role with no merchant profile everything", () => {
    const orphan: PortalPrincipal = { role: "MERCHANT", merchantId: null };
    expect(mayOpen(orphan, "any")).toBe(false);
    expect(mayOpen(orphan, "merchant")).toBe(false);
  });
});

describe("accessForPath", () => {
  it("matches nested paths by their page", () => {
    expect(accessForPath("/dashboard/users/user_1")).toBe("admin");
    expect(accessForPath("/dashboard/orders/order_1")).toBe("merchant");
  });

  it("does not mistake a lookalike prefix for a page", () => {
    expect(accessForPath("/dashboard/storefront")).toBe("admin");
    expect(accessForPath("/dashboard/store")).toBe("merchant");
  });

  it("closes a dashboard path no page claims to everyone but an admin", () => {
    expect(accessForPath("/dashboard/new-feature")).toBe("admin");
  });

  it("has no opinion outside the dashboard", () => {
    expect(accessForPath("/login")).toBeNull();
  });
});

describe("navFor", () => {
  it("shows a merchant no administration links", () => {
    const nav = navFor(merchant);
    expect(nav.admin).toEqual([]);
    expect(nav.main.map((p) => p.href)).toEqual(["/dashboard", "/dashboard/orders", "/dashboard/store"]);
  });

  it("shows an admin without a store the overview and every administration link", () => {
    const nav = navFor(adminWithoutStore);
    expect(nav.main.map((p) => p.href)).toEqual(["/dashboard"]);
    expect(nav.admin).toHaveLength(ADMIN_PAGES.length);
  });

  it("never offers a link the guard would refuse", () => {
    for (const principal of [merchant, adminWithoutStore, adminWithStore]) {
      const { main, admin } = navFor(principal);
      for (const page of [...main, ...admin]) expect(mayOpen(principal, accessForPath(page.href)!)).toBe(true);
    }
  });

  it("covers every page in the table", () => {
    expect(PORTAL_PAGES.map((p) => p.href.split("/")[2] ?? "overview").sort()).toEqual(
      ["overview", "orders", "store", ...ADMIN_PAGES].sort()
    );
  });
});

describe("statuses a merchant may set", () => {
  it.each(["CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "CANCELLED"])("include %s", (status) => {
    expect(isMerchantSettableOrderStatus(status)).toBe(true);
  });

  it.each(["DELIVERED", "OUT_FOR_DELIVERY", "PENDING", "confirmed", 42, null])("exclude %p", (status) => {
    expect(isMerchantSettableOrderStatus(status)).toBe(false);
  });
});
