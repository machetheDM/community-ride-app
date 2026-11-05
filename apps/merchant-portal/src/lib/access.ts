/**
 * Who may open which portal page: the one table both the pages and the sidebar
 * read, so the menu can never offer a page the guard refuses, or the reverse.
 *
 * Every page used to check only that some session existed, and the sidebar showed
 * the Administration menu to everyone, so any merchant could read every user's
 * phone number, every driver's licence and every payment (threat model PA-4).
 *
 * - **admin** pages show platform-wide data (people, money, configuration): ADMIN only.
 * - **merchant** pages show one merchant's orders and stores, scoped to the merchant
 *   id loaded from the database: a MERCHANT, or an ADMIN who also runs a store.
 * - **any** is the overview, which shows an admin overview to an ADMIN without a
 *   store.
 *
 * Pure: no Next.js or React import, so the API's test suite checks it directly
 * (the portal has no test runner of its own).
 */

export type PortalRole = "MERCHANT" | "ADMIN";
export type PageAccess = "any" | "merchant" | "admin";

/** What an authorisation decision needs, and nothing a cookie could supply. */
export interface PortalPrincipal {
  role: PortalRole;
  /** From the database on every request; null for an ADMIN who runs no store. */
  merchantId: string | null;
}

export type NavIcon =
  | "overview"
  | "orders"
  | "store"
  | "analytics"
  | "stores"
  | "drivers"
  | "riders"
  | "users"
  | "payments"
  | "settings";

export interface PortalPage {
  href: string;
  label: string;
  icon: NavIcon;
  access: PageAccess;
}

export const PORTAL_PAGES: readonly PortalPage[] = [
  { href: "/dashboard", label: "Overview", icon: "overview", access: "any" },
  { href: "/dashboard/orders", label: "Orders", icon: "orders", access: "merchant" },
  { href: "/dashboard/store", label: "My Store", icon: "store", access: "merchant" },
  { href: "/dashboard/analytics", label: "Analytics", icon: "analytics", access: "admin" },
  { href: "/dashboard/stores", label: "Stores", icon: "stores", access: "admin" },
  { href: "/dashboard/drivers", label: "Drivers", icon: "drivers", access: "admin" },
  { href: "/dashboard/riders", label: "Riders", icon: "riders", access: "admin" },
  { href: "/dashboard/users", label: "Users", icon: "users", access: "admin" },
  { href: "/dashboard/payments", label: "Payments", icon: "payments", access: "admin" },
  { href: "/dashboard/settings", label: "Settings", icon: "settings", access: "admin" },
];

export function mayOpen(principal: PortalPrincipal, access: PageAccess): boolean {
  switch (access) {
    case "any":
      return principal.role === "ADMIN" || principal.merchantId !== null;
    case "merchant":
      return principal.merchantId !== null && (principal.role === "MERCHANT" || principal.role === "ADMIN");
    case "admin":
      return principal.role === "ADMIN";
  }
}

/**
 * The access a path needs, by its longest matching page prefix. A dashboard path
 * no page claims needs admin: a page added later without a row here is closed
 * until someone decides otherwise, rather than open to every merchant.
 */
export function accessForPath(pathname: string): PageAccess | null {
  if (pathname !== "/dashboard" && !pathname.startsWith("/dashboard/")) return null;
  let best: PortalPage | undefined;
  for (const page of PORTAL_PAGES) {
    const matches = pathname === page.href || pathname.startsWith(`${page.href}/`);
    if (matches && (!best || page.href.length > best.href.length)) best = page;
  }
  if (!best || (best.href === "/dashboard" && pathname !== "/dashboard")) return "admin";
  return best.access;
}

export interface NavSections {
  main: PortalPage[];
  admin: PortalPage[];
}

/** The links this principal may open, split the way the sidebar draws them. */
export function navFor(principal: PortalPrincipal): NavSections {
  const visible = PORTAL_PAGES.filter((page) => mayOpen(principal, page.access));
  return {
    main: visible.filter((page) => page.access !== "admin"),
    admin: visible.filter((page) => page.access === "admin"),
  };
}

/**
 * Statuses a merchant may set on their own order. Never DELIVERED or
 * OUT_FOR_DELIVERY: those belong to the rider and the customer's handover code,
 * and a store marking its own order delivered is how a dispute gets lost.
 */
export const MERCHANT_SETTABLE_ORDER_STATUSES = ["CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "CANCELLED"] as const;
export type MerchantSettableOrderStatus = (typeof MERCHANT_SETTABLE_ORDER_STATUSES)[number];

export function isMerchantSettableOrderStatus(value: unknown): value is MerchantSettableOrderStatus {
  return typeof value === "string" && (MERCHANT_SETTABLE_ORDER_STATUSES as readonly string[]).includes(value);
}
