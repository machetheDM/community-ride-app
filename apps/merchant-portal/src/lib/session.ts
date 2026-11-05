import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  PORTAL_SESSION_COOKIE,
  PORTAL_SESSION_TTL_SECONDS,
  signPortalSession,
  verifyPortalSession,
  type PortalRole,
} from "@ride/db/session";
import { prisma } from "./prisma";
import { mayOpen, type PageAccess } from "./access";

/**
 * The signed-in portal user, as the database knows them on this request.
 *
 * The cookie says only who signed in, with which role and token version, and is
 * HMAC-signed (`@ride/db/session`). Everything an authorisation decision uses
 * (whether the account is active, its role, and above all its merchant id) is
 * read from the database here, so a forged or stale cookie cannot point at
 * another merchant's data (threat model PA-2).
 */
export interface PortalSession {
  userId: string;
  name: string;
  role: PortalRole;
  tokenVersion: number;
  merchantId: string | null;
}

async function loadSession(): Promise<PortalSession | null> {
  const store = await cookies();
  const payload = verifyPortalSession(store.get(PORTAL_SESSION_COOKIE)?.value);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      name: true,
      role: true,
      isActive: true,
      tokenVersion: true,
      merchantProfile: { select: { id: true } },
    },
  });

  // Each of these ends a session the signature alone would keep alive: a
  // suspension, "sign out everywhere", and a role change (a demoted admin keeps
  // nothing; they sign in again under the new role).
  if (!user || !user.isActive) return null;
  if (user.tokenVersion !== payload.tokenVersion) return null;
  if (user.role !== payload.role) return null;
  if (user.role !== "MERCHANT" && user.role !== "ADMIN") return null;

  const merchantId = user.merchantProfile?.id ?? null;
  if (user.role === "MERCHANT" && !merchantId) return null;

  return { userId: user.id, name: user.name, role: user.role, tokenVersion: user.tokenVersion, merchantId };
}

/**
 * Memoised per render, so the layout and the page share one database read.
 * Server Actions are not a render pass, so each action reads afresh, which is
 * what an action should do anyway.
 */
export const getSession = cache(loadSession);

/** The cookie the portal sets: never readable by script, HTTPS-only in production. */
function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
}

/** Call only from a Server Action: cookies cannot be set while a page renders. */
export async function startSession(user: { id: string; role: PortalRole; tokenVersion: number }): Promise<void> {
  const store = await cookies();
  store.set(
    PORTAL_SESSION_COOKIE,
    signPortalSession({ userId: user.id, role: user.role, tokenVersion: user.tokenVersion }),
    { ...cookieOptions(), maxAge: PORTAL_SESSION_TTL_SECONDS }
  );
}

/** Call only from a Server Action. Expires the cookie with the attributes it was set with. */
export async function endSession(): Promise<void> {
  const store = await cookies();
  store.set(PORTAL_SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}

// ── Page guards ─────────────────────────────────────────────────────────────
//
// Each page calls one of these itself. The dashboard layout's check is not
// enough: a layout does not re-render on navigation and does not stop its child
// segments from rendering, so a page without its own guard is an open page.

export async function requireSession(): Promise<PortalSession> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** Platform-wide pages. A merchant gets a 404, which does not even confirm the page exists. */
export async function requireAdmin(): Promise<PortalSession> {
  const session = await requireSession();
  if (!mayOpen(session, "admin")) notFound();
  return session;
}

/** One merchant's pages. An admin without a store is sent to the admin overview. */
export async function requireMerchant(): Promise<PortalSession & { merchantId: string }> {
  const session = await requireSession();
  if (!mayOpen(session, "merchant") || session.merchantId === null) redirect("/dashboard");
  return { ...session, merchantId: session.merchantId };
}

/**
 * The same checks for a Server Action, which must answer with a value rather than
 * a redirect. Server Actions are public endpoints: anyone can POST to one, so
 * every action calls this before it reads or writes anything.
 */
export async function sessionFor(access: PageAccess): Promise<PortalSession | null> {
  const session = await getSession();
  if (!session || !mayOpen(session, access)) return null;
  return session;
}
