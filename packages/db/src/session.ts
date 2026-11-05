import { createHmac, timingSafeEqual } from "node:crypto";
import { requireSecret } from "./crypto";

/**
 * The merchant portal's session token (`@ride/db/session`).
 *
 * The cookie used to be `JSON.stringify({ userId, merchantId, name })`, unsigned,
 * so anyone could write `{"merchantId": "<someone else's>"}` into their browser
 * and become that merchant (threat model PA-2). It is now an HMAC-SHA256 signature
 * over a minimal payload, under a secret only the portal holds.
 *
 * Signed, not encrypted: the payload carries an id, a role and two timestamps,
 * nothing personal, and what matters is that it cannot be forged or altered. It
 * also carries no merchant id; the portal reads that from the database on every
 * request, so a cookie can never point at another merchant's data.
 *
 * Pure node:crypto. The cookie handling lives in the portal, which is the only
 * place `next/headers` exists.
 */

export const PORTAL_SESSION_COOKIE = "portal_session";

/** Twelve hours: a working day, after which the merchant signs in again. */
export const PORTAL_SESSION_TTL_SECONDS = 12 * 60 * 60;

export type PortalRole = "MERCHANT" | "ADMIN";

export interface PortalSessionPayload {
  userId: string;
  role: PortalRole;
  /** Copied from `User.tokenVersion`; bumping that column revokes the session. */
  tokenVersion: number;
  /** Seconds since the epoch, like a JWT. */
  iat: number;
  exp: number;
}

const VERSION = "v1";
/** Allowance for a clock that runs slightly ahead on the machine that signed. */
const CLOCK_SKEW_SECONDS = 60;
/** Far larger than any real token, small enough that parsing a hostile one is cheap. */
const MAX_TOKEN_LENGTH = 1024;

export interface SessionKeyOptions {
  /** Defaults to `PORTAL_SESSION_SECRET`, which fails closed in production. */
  secret?: string;
  /** Milliseconds since the epoch; injected by tests. */
  now?: number;
}

function secretFrom(options: SessionKeyOptions): string {
  return options.secret ?? requireSecret("PORTAL_SESSION_SECRET");
}

function mac(secret: string, signed: string): Buffer {
  return createHmac("sha256", secret).update(signed).digest();
}

export function signPortalSession(
  subject: { userId: string; role: PortalRole; tokenVersion: number },
  options: SessionKeyOptions & { ttlSeconds?: number } = {}
): string {
  const iat = Math.floor((options.now ?? Date.now()) / 1000);
  const payload: PortalSessionPayload = {
    userId: subject.userId,
    role: subject.role,
    tokenVersion: subject.tokenVersion,
    iat,
    exp: iat + (options.ttlSeconds ?? PORTAL_SESSION_TTL_SECONDS),
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signed = `${VERSION}.${body}`;
  return `${signed}.${mac(secretFrom(options), signed).toString("base64url")}`;
}

function isPayload(value: unknown): value is PortalSessionPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.userId === "string" &&
    v.userId.length > 0 &&
    (v.role === "MERCHANT" || v.role === "ADMIN") &&
    Number.isInteger(v.tokenVersion) &&
    (v.tokenVersion as number) >= 0 &&
    Number.isInteger(v.iat) &&
    Number.isInteger(v.exp)
  );
}

/**
 * Returns the payload of a genuine, unexpired token, or null.
 *
 * Verifying the signature is only the first half: the caller must still load the
 * user and compare `isActive`, `tokenVersion` and the role, because a validly
 * signed token outlives a suspension otherwise.
 */
export function verifyPortalSession(
  token: string | undefined | null,
  options: SessionKeyOptions = {}
): PortalSessionPayload | null {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [version, body, signature] = parts;

  // The secret is resolved outside any try: a missing secret in production must
  // surface as an error, not be mistaken for a bad cookie and quietly sign
  // everyone out.
  const expected = mac(secretFrom(options), `${version}.${body}`);
  const given = Buffer.from(signature, "base64url");
  // timingSafeEqual throws on unequal lengths, and the length of a MAC is public.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isPayload(payload)) return null;

  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  if (payload.exp <= nowSeconds) return null;
  if (payload.iat > nowSeconds + CLOCK_SKEW_SECONDS) return null;
  return payload;
}
