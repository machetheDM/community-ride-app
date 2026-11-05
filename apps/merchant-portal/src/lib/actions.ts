"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { recordAuditStrict } from "@ride/db";
import { issueOtp, maskPhone, normaliseSaMobile, smsTransportFromEnv, verifyOtp } from "@ride/db/otp";
import { prisma } from "./prisma";
import { endSession, sessionFor, startSession } from "./session";
import { auditPortal, requestIp } from "./audit";
import { isMerchantSettableOrderStatus } from "./access";
import { sendPushToUser } from "./notifications";

/**
 * Every export here is a public HTTP endpoint: Next.js turns each into a POST
 * handler anyone can call with any arguments, whatever the UI shows. So each one
 * re-checks the session, the role and ownership itself, and treats its arguments
 * as untrusted input.
 */

const STATUS_MESSAGES: Record<string, { title: string; body: string }> = {
  CONFIRMED:        { title: "Order Confirmed ✅", body: "Your order has been confirmed by the store." },
  PREPARING:        { title: "Being Prepared 👨‍🍳", body: "The store is preparing your order." },
  READY_FOR_PICKUP: { title: "Ready for Pickup 📦", body: "Your order is ready and waiting for a rider." },
  CANCELLED:        { title: "Order Cancelled", body: "Sorry, the store was unable to accept your order." },
};

// ── Sign-in ─────────────────────────────────────────────────────────────────

export interface SignInState {
  step: "phone" | "code";
  /** Normalised, echoed into the second step's hidden field. */
  phone?: string;
  error?: string;
  notice?: string;
}

const INVALID_PHONE = "Enter a South African mobile number, such as 082 123 4567.";
const SMS_UNAVAILABLE = "SMS is not configured, so sign-in codes cannot be sent. Contact the platform administrator.";
/**
 * Said whether or not the number has portal access, and whether or not a code was
 * actually sent. The old message ("No merchant account is registered for this
 * number") confirmed which numbers were merchants (threat model PA-1).
 */
const CODE_NOTICE =
  "If this number can sign in to the portal, a 6-digit code is on its way. It lasts 10 minutes, and at most 3 codes can be sent every 15 minutes.";
/** One message for a wrong, expired or burned code, a locked phone, and an account that may not sign in. */
const SIGN_IN_FAILED = "That code is not valid. Check it, or request a new one.";

/** Who may sign in to the portal at all. A MERCHANT needs a merchant profile to have anything to see. */
async function findPortalUser(phone: string) {
  const user = await prisma.user.findUnique({
    where: { phone },
    select: { id: true, role: true, isActive: true, tokenVersion: true, merchantProfile: { select: { id: true } } },
  });
  if (!user) return { user: null, eligible: false } as const;
  const eligible = user.isActive && (user.role === "ADMIN" || (user.role === "MERCHANT" && user.merchantProfile !== null));
  return { user, eligible } as const;
}

async function sendCode(phone: string): Promise<SignInState> {
  const sms = smsTransportFromEnv();
  if (!sms) return { step: "phone", error: SMS_UNAVAILABLE };

  // A code is only issued, and an SMS only paid for, when the number has portal
  // access. Everyone else sees the same notice and the same next step.
  const { eligible } = await findPortalUser(phone);
  if (eligible) {
    const result = await issueOtp(prisma, phone, { sms });
    if (!result.ok) {
      // Not surfaced as its own message: it would differ between numbers with
      // access and numbers without (which are never capped), and so reveal them.
      console.warn(`[portal] OTP send cap reached for ${maskPhone(phone)}`);
    }
  }
  return { step: "code", phone, notice: CODE_NOTICE };
}

async function checkCode(phone: string, code: string): Promise<SignInState> {
  const result = await verifyOtp(prisma, phone, code);
  const { user, eligible } = await findPortalUser(phone);

  if (!result.ok || !user || !eligible || (user.role !== "MERCHANT" && user.role !== "ADMIN")) {
    const reason = !result.ok ? result.reason : !user ? "no_account" : !user.isActive ? "inactive" : "not_eligible";
    // Never the code itself.
    await auditPortal({
      actorUserId: user?.id ?? null,
      actorRole: user?.role ?? null,
      action: "portal.signin.fail",
      entityType: "User",
      entityId: user?.id ?? null,
      detail: { reason, phone: maskPhone(phone) },
    });
    return { step: "code", phone, error: SIGN_IN_FAILED };
  }

  await startSession({ id: user.id, role: user.role, tokenVersion: user.tokenVersion });
  await auditPortal({
    actorUserId: user.id,
    actorRole: user.role,
    action: "portal.signin.ok",
    entityType: "User",
    entityId: user.id,
  });
  redirect("/dashboard");
}

/**
 * The two-step sign-in form's single action: `intent` is `send` (phone, or resend),
 * `verify` (phone and code) or `restart` (use a different number).
 */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const intent = String(formData.get("intent") ?? "");
  if (intent === "restart") return { step: "phone" };

  const phone = normaliseSaMobile(String(formData.get("phone") ?? "").slice(0, 32));
  if (!phone) return { step: "phone", error: INVALID_PHONE };

  if (intent === "send") return sendCode(phone);
  if (intent === "verify") {
    const code = String(formData.get("code") ?? "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) return { step: "code", phone, error: "Enter the 6-digit code from the SMS." };
    return checkCode(phone, code);
  }
  return { step: "phone" };
}

export async function signOut() {
  await endSession();
  redirect("/login");
}

/**
 * Ends every session this user has: the portal's on every browser, and the
 * mobile apps' tokens too, which carry the same `tokenVersion`.
 */
export async function signOutEverywhere() {
  const session = await sessionFor("any");
  if (session) {
    await prisma.user.update({ where: { id: session.userId }, data: { tokenVersion: { increment: 1 } } });
    await auditPortal({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "auth.logout_all",
      entityType: "User",
      entityId: session.userId,
    });
  }
  await endSession();
  redirect("/login");
}

// ── Orders and stores ───────────────────────────────────────────────────────

export type ActionResult = { ok: true } | { error: string };

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

export async function updateOrderStatus(orderId: unknown, status: unknown): Promise<ActionResult> {
  const session = await sessionFor("merchant");
  if (!session || session.merchantId === null) return { error: "Not authenticated" };
  if (!isId(orderId)) return { error: "Order not found" };
  // DELIVERED and OUT_FOR_DELIVERY are not a store's to set; the rider and the
  // customer's handover are.
  if (!isMerchantSettableOrderStatus(status)) return { error: "A store cannot set that status" };

  // Ownership: the order must belong to one of this merchant's stores, with the
  // merchant id taken from the database, never from the request.
  const order = await prisma.order.findFirst({
    where: { id: orderId, store: { merchantId: session.merchantId } },
    select: { id: true, status: true, customer: { select: { pushToken: true } } },
  });
  if (!order) return { error: "Order not found" };

  // LIFECYCLE: wire canTransitionOrder from @ride/db/lifecycle after merge

  const now = new Date();
  const ip = await requestIp();
  const changed = await prisma.$transaction(async (tx) => {
    // Conditional on the status just read (AGENTS.md rule 7): if a rider or a
    // second tab moved the order in between, this changes nothing rather than
    // overwriting their change with a decision made on stale data.
    const { count } = await tx.order.updateMany({
      where: { id: order.id, status: order.status },
      data: {
        status,
        ...(status === "CONFIRMED" ? { confirmedAt: now } : {}),
        ...(status === "PREPARING" ? { preparedAt: now } : {}),
        ...(status === "READY_FOR_PICKUP" ? { readyAt: now } : {}),
        ...(status === "CANCELLED" ? { cancelledAt: now, cancelledBy: "MERCHANT" } : {}),
      },
    });
    if (count === 0) return false;
    // In the same transaction: a status change with no record of who made it
    // does not commit.
    await recordAuditStrict(tx, {
      actorUserId: session.userId,
      actorRole: session.role,
      action: "order.status",
      entityType: "Order",
      entityId: order.id,
      ip,
      detail: { channel: "portal", from: order.status, to: status },
    });
    return true;
  });
  if (!changed) return { error: "This order changed while you were looking at it. Refresh and try again." };

  const msg = STATUS_MESSAGES[status];
  if (msg && order.customer.pushToken) {
    await sendPushToUser(order.customer.pushToken, msg.title, msg.body, { orderId: order.id, screen: "orders" });
  }

  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function toggleStoreOpen(storeId: unknown, isOpen: unknown): Promise<ActionResult> {
  const session = await sessionFor("merchant");
  if (!session || session.merchantId === null) return { error: "Not authenticated" };
  if (!isId(storeId) || typeof isOpen !== "boolean") return { error: "Store not found" };
  const merchantId = session.merchantId;

  const ip = await requestIp();
  const changed = await prisma.$transaction(async (tx) => {
    // Scoped by merchant in the write itself, so another merchant's store id
    // changes nothing.
    const { count } = await tx.store.updateMany({ where: { id: storeId, merchantId }, data: { isOpen } });
    if (count === 0) return false;
    await recordAuditStrict(tx, {
      actorUserId: session.userId,
      actorRole: session.role,
      action: isOpen ? "store.open" : "store.close",
      entityType: "Store",
      entityId: storeId,
      ip,
      detail: { channel: "portal" },
    });
    return true;
  });
  if (!changed) return { error: "Store not found" };

  revalidatePath("/dashboard/store");
  revalidatePath("/dashboard");
  return { ok: true };
}
