import { randomInt } from "node:crypto";
import { hashesEqual, keyedHash } from "./crypto";
import { isSaMobile, maskPhone } from "./phone";
import type { Prisma } from "./generated/prisma/index";

/**
 * One-time sign-in codes, shared by the API (`/api/auth/*`) and the merchant
 * portal (`@ride/db/otp`).
 *
 * Both used to keep their own sign-in logic, and the portal's was a phone number
 * with no code at all (threat model PA-1). One module means one set of limits, and
 * a fix lands in both places at once.
 *
 * The limits, and the attack each one answers:
 *
 * - **One live code per phone.** A new code voids the earlier ones. Verify used to
 *   accept any unexpired code, so fifty requests made every guess fifty times
 *   likelier (AU-2).
 * - **Five guesses per code**, then it is burned. Counted in the row, so spreading
 *   guesses across addresses does not help (AU-1).
 * - **A lockout per phone**: ten wrong guesses in fifteen minutes, across codes,
 *   refuses even the right code until the window passes. Without it, requesting a
 *   fresh code after every fifth guess would reset the per-code limit.
 * - **A send cap per phone**: three codes in fifteen minutes and ten a day, against
 *   SMS bombing a victim and against pumping paid messages (AU-3).
 *
 * With all four, an attacker gets at most fifty guesses a day at a million codes.
 *
 * Takes the database client as a parameter rather than importing the singleton, so
 * the rules are tested against an in-memory fake and never need a database.
 */

const OTP_HASH_KEY = "OTP_HASH_KEY";

export const OTP_DIGITS = 6;
export const OTP_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS_PER_CODE = 5;
export const LOCKOUT_FAILURES = 10;
export const LOCKOUT_WINDOW_MS = 15 * 60_000;
export const SEND_CAP_SHORT = 3;
export const SEND_CAP_SHORT_WINDOW_MS = 15 * 60_000;
export const SEND_CAP_DAILY = 10;
const DAY_MS = 24 * 60 * 60_000;

/**
 * The slice of the Prisma client this module needs. Narrow on purpose: the fake in
 * the tests implements exactly this, so a query the rules depend on cannot be added
 * here without the tests seeing it.
 */
export interface OtpStore {
  otpCode: {
    findMany(args: {
      where: Prisma.OtpCodeWhereInput;
      select: { createdAt: true; attempts: true };
      orderBy: { createdAt: "asc" };
    }): Promise<Array<{ createdAt: Date; attempts: number }>>;
    findFirst(args: {
      where: Prisma.OtpCodeWhereInput;
      select: { id: true; codeHash: true };
      orderBy: { createdAt: "desc" };
    }): Promise<{ id: string; codeHash: string } | null>;
    create(args: {
      data: { phone: string; codeHash: string; expiresAt: Date; createdAt: Date };
      select: { id: true };
    }): Promise<{ id: string }>;
    updateMany(args: {
      where: Prisma.OtpCodeWhereInput;
      data: Prisma.OtpCodeUpdateManyMutationInput;
    }): Promise<{ count: number }>;
  };
}

// ── SMS ─────────────────────────────────────────────────────────────────────

/** Whatever delivers the text. A real provider plugs in here (`SMS_PROVIDER`). */
export interface SmsTransport {
  send(to: string, text: string): Promise<void>;
}

/**
 * Prints the message to the server console, and only in development, so a
 * developer can sign in locally without a provider.
 *
 * Silent in every other environment. It shows the code, and a code in a
 * production log is a sign-in for anyone who can read the logs.
 */
export const consoleSmsTransport: SmsTransport = {
  async send(to, text) {
    if (process.env.NODE_ENV !== "development") return;
    console.info(`[sms:console] to ${maskPhone(to)}: ${text}`);
  },
};

/**
 * The transport this environment can honestly use, or null when there is none.
 *
 * `SMS_PROVIDER` names the provider. No provider is integrated yet (it needs a
 * credential the owner has not chosen), so in production every value means "not
 * configured" and the caller must say so rather than claim a code was sent: the
 * old route answered "OTP sent" to every request while nothing could deliver it.
 * Outside production the console transport stands in, unset or `console`.
 */
export function smsTransportFromEnv(
  env: { NODE_ENV?: string; SMS_PROVIDER?: string } = process.env
): SmsTransport | null {
  const provider = env.SMS_PROVIDER?.trim() ?? "";
  if (env.NODE_ENV === "production") return null;
  if (provider === "" || provider === "console") return consoleSmsTransport;
  return null;
}

// ── Issue ───────────────────────────────────────────────────────────────────

export type IssueOtpResult =
  | { ok: true; code: string; expiresAt: Date }
  | { ok: false; reason: "send_cap"; retryAfterSeconds: number };

export interface IssueOtpOptions {
  sms: SmsTransport;
  /** Injected by tests; the database's own clock is never consulted. */
  now?: Date;
}

/** Six digits from the CSPRNG, zero-padded so all million codes are possible. */
function generateCode(): string {
  return randomInt(0, 10 ** OTP_DIGITS).toString().padStart(OTP_DIGITS, "0");
}

/**
 * Issues a code for a normalised South African mobile and sends it.
 *
 * Returns the code so the API can echo it in development; a caller must never
 * return it to a client in any other environment.
 */
export async function issueOtp(db: OtpStore, phone: string, options: IssueOtpOptions): Promise<IssueOtpResult> {
  // A guard, not validation: callers normalise first. It stops a future caller
  // from sending paid messages to a number the platform does not serve.
  if (!isSaMobile(phone)) {
    throw new Error("issueOtp expects a normalised South African mobile number");
  }
  const now = options.now ?? new Date();
  const nowMs = now.getTime();

  const today = await db.otpCode.findMany({
    where: { phone, createdAt: { gt: new Date(nowMs - DAY_MS) } },
    select: { createdAt: true, attempts: true },
    orderBy: { createdAt: "asc" },
  });
  const recent = today.filter((row) => row.createdAt.getTime() > nowMs - SEND_CAP_SHORT_WINDOW_MS);

  if (recent.length >= SEND_CAP_SHORT || today.length >= SEND_CAP_DAILY) {
    // The earliest send that has to age out of its window before another fits.
    const freesAt =
      today.length >= SEND_CAP_DAILY
        ? today[today.length - SEND_CAP_DAILY].createdAt.getTime() + DAY_MS
        : recent[recent.length - SEND_CAP_SHORT].createdAt.getTime() + SEND_CAP_SHORT_WINDOW_MS;
    return { ok: false, reason: "send_cap", retryAfterSeconds: Math.max(1, Math.ceil((freesAt - nowMs) / 1000)) };
  }

  // Void every earlier live code before the new one exists, so a phone never
  // holds more than one guessable code.
  await db.otpCode.updateMany({ where: { phone, used: false }, data: { used: true } });

  const code = generateCode();
  const expiresAt = new Date(nowMs + OTP_TTL_MS);
  const row = await db.otpCode.create({
    data: { phone, codeHash: keyedHash(code, OTP_HASH_KEY), expiresAt, createdAt: now },
    select: { id: true },
  });

  try {
    await options.sms.send(
      phone,
      `Your Community Ride code is ${code}. It expires in 10 minutes. Never share it with anyone.`
    );
  } catch (error) {
    // Nobody received this code, so nobody should be able to guess it either.
    // The row still counts towards the send cap: a failing provider is not a
    // reason to let one phone trigger unlimited attempts at sending.
    await db.otpCode.updateMany({ where: { id: row.id }, data: { used: true } });
    throw error;
  }

  return { ok: true, code, expiresAt };
}

// ── Verify ──────────────────────────────────────────────────────────────────

/**
 * The reasons are for logs and the audit trail. The HTTP layer shows one message
 * for all three, so a response never tells an attacker whether the code was
 * wrong, gone, or the phone is locked.
 */
export type VerifyOtpResult =
  | { ok: true }
  | { ok: false; reason: "wrong_code" | "no_live_code" | "locked" };

export async function verifyOtp(
  db: OtpStore,
  phone: string,
  code: string,
  options: { now?: Date } = {}
): Promise<VerifyOtpResult> {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();

  // Not a guess at all, so it neither matches nor counts.
  if (!/^\d+$/.test(code) || code.length !== OTP_DIGITS) return { ok: false, reason: "wrong_code" };

  // Lockout first: while locked, even the right code is refused.
  //
  // There is no timestamp per guess, only a counter per code. A guess can only be
  // made while its code is live, so every guess in the last fifteen minutes was
  // made against a code that expired less than fifteen minutes ago. Counting those
  // codes is conservative: a guess can be counted for up to one code lifetime
  // longer than the window, and never for less.
  const window = await db.otpCode.findMany({
    where: { phone, expiresAt: { gt: new Date(nowMs - LOCKOUT_WINDOW_MS) } },
    select: { createdAt: true, attempts: true },
    orderBy: { createdAt: "asc" },
  });
  const failures = window.reduce((sum, row) => sum + row.attempts, 0);
  if (failures >= LOCKOUT_FAILURES) return { ok: false, reason: "locked" };

  // Only the latest live code. Looked up by phone, never by hash: a lookup by
  // `codeHash` is what let any of several live codes match, and it compares in
  // the database rather than in constant time.
  const live = await db.otpCode.findFirst({
    where: { phone, used: false, expiresAt: { gt: now } },
    select: { id: true, codeHash: true },
    orderBy: { createdAt: "desc" },
  });
  if (!live) return { ok: false, reason: "no_live_code" };

  // Claim the attempt before comparing. Read-then-compare-then-increment lets a
  // burst of parallel guesses all compare against the same count of zero; one
  // conditional update means at most five comparisons per code however many
  // requests arrive at once.
  const claimed = await db.otpCode.updateMany({
    where: { id: live.id, used: false, attempts: { lt: MAX_ATTEMPTS_PER_CODE } },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return { ok: false, reason: "no_live_code" };

  if (hashesEqual(keyedHash(code, OTP_HASH_KEY), live.codeHash)) {
    // Conditional on `used: false`, so two parallel requests with the right code
    // cannot both sign in with it. The claimed attempt is handed back: `attempts`
    // counts wrong guesses, and the lockout sums it.
    const consumed = await db.otpCode.updateMany({
      where: { id: live.id, used: false },
      data: { used: true, attempts: { decrement: 1 } },
    });
    return consumed.count === 1 ? { ok: true } : { ok: false, reason: "no_live_code" };
  }

  // Burn at the limit. Conditional on the stored count, not on the value read
  // above, which a parallel request may already have moved.
  await db.otpCode.updateMany({
    where: { id: live.id, attempts: { gte: MAX_ATTEMPTS_PER_CODE } },
    data: { used: true },
  });
  return { ok: false, reason: "wrong_code" };
}

export { normaliseSaMobile, isSaMobile, maskPhone } from "./phone";
