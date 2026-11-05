import { describe, it, expect, afterEach } from "@jest/globals";
import { createHmac } from "node:crypto";
import {
  PORTAL_SESSION_TTL_SECONDS,
  signPortalSession,
  verifyPortalSession,
} from "@ride/db/session";

const SECRET = "portal-session-secret-for-tests-0123456789";
const NOW = Date.UTC(2026, 10, 4, 8, 0, 0);
const subject = { userId: "user_1", role: "MERCHANT" as const, tokenVersion: 3 };
const env = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = env.NODE_ENV;
const ORIGINAL_SECRET = env.PORTAL_SESSION_SECRET;

afterEach(() => {
  env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_SECRET === undefined) delete env.PORTAL_SESSION_SECRET;
  else env.PORTAL_SESSION_SECRET = ORIGINAL_SECRET;
});

const sign = (overrides: { now?: number; secret?: string } = {}) =>
  signPortalSession(subject, { secret: SECRET, now: NOW, ...overrides });

/** Re-signs an arbitrary body with the real secret: a forgery by someone who has it. */
function signBody(body: unknown, secret = SECRET): string {
  const encoded = Buffer.from(JSON.stringify(body)).toString("base64url");
  const mac = createHmac("sha256", secret).update(`v1.${encoded}`).digest("base64url");
  return `v1.${encoded}.${mac}`;
}

describe("portal session tokens", () => {
  it("sign and verify, carrying the id, role, token version and a twelve-hour expiry", () => {
    const payload = verifyPortalSession(sign(), { secret: SECRET, now: NOW + 1000 });
    expect(payload).toEqual({
      userId: "user_1",
      role: "MERCHANT",
      tokenVersion: 3,
      iat: NOW / 1000,
      exp: NOW / 1000 + PORTAL_SESSION_TTL_SECONDS,
    });
    expect(PORTAL_SESSION_TTL_SECONDS).toBe(12 * 60 * 60);
  });

  it("carry no merchant id, so a cookie can never name whose data to show", () => {
    const [, body] = sign().split(".");
    expect(JSON.parse(Buffer.from(body, "base64url").toString())).not.toHaveProperty("merchantId");
  });

  it("refuse a tampered payload", () => {
    const [version, , signature] = sign().split(".");
    const forged = Buffer.from(JSON.stringify({ ...subject, role: "ADMIN", iat: NOW / 1000, exp: NOW / 1000 + 60 })).toString(
      "base64url"
    );
    expect(verifyPortalSession(`${version}.${forged}.${signature}`, { secret: SECRET, now: NOW })).toBeNull();
  });

  it("refuse a tampered signature", () => {
    const token = sign();
    const last = token.at(-1) === "A" ? "B" : "A";
    expect(verifyPortalSession(`${token.slice(0, -1)}${last}`, { secret: SECRET, now: NOW })).toBeNull();
    expect(verifyPortalSession(`${token.split(".").slice(0, 2).join(".")}.`, { secret: SECRET, now: NOW })).toBeNull();
  });

  it("refuse an expired session", () => {
    const expiry = NOW + PORTAL_SESSION_TTL_SECONDS * 1000;
    expect(verifyPortalSession(sign(), { secret: SECRET, now: expiry - 1000 })).not.toBeNull();
    expect(verifyPortalSession(sign(), { secret: SECRET, now: expiry })).toBeNull();
  });

  it("refuse a token signed with another secret", () => {
    expect(verifyPortalSession(sign({ secret: "another-secret-entirely-0123456789" }), { secret: SECRET, now: NOW })).toBeNull();
  });

  it("refuse the old unsigned JSON cookie", () => {
    const old = JSON.stringify({ userId: "user_1", merchantId: "merchant_2", name: "Mallory" });
    expect(verifyPortalSession(old, { secret: SECRET, now: NOW })).toBeNull();
    expect(verifyPortalSession(encodeURIComponent(old), { secret: SECRET, now: NOW })).toBeNull();
  });

  it("refuse a validly signed payload of the wrong shape, such as a customer role", () => {
    const exp = NOW / 1000 + 60;
    expect(verifyPortalSession(signBody({ ...subject, role: "CUSTOMER", iat: NOW / 1000, exp }), { secret: SECRET, now: NOW })).toBeNull();
    expect(verifyPortalSession(signBody({ ...subject, tokenVersion: "3", iat: NOW / 1000, exp }), { secret: SECRET, now: NOW })).toBeNull();
    expect(verifyPortalSession(signBody({ ...subject, iat: NOW / 1000 + 3600, exp: exp + 3600 }), { secret: SECRET, now: NOW })).toBeNull();
  });

  it("refuse empty, oversized and malformed tokens without throwing", () => {
    for (const token of [undefined, null, "", "v1", "v1.a", "v2.a.b", "v1.a.b.c", "x".repeat(5000)]) {
      expect(verifyPortalSession(token, { secret: SECRET, now: NOW })).toBeNull();
    }
  });

  it("fail closed in production when PORTAL_SESSION_SECRET is not set", () => {
    env.NODE_ENV = "production";
    delete env.PORTAL_SESSION_SECRET;
    expect(() => signPortalSession(subject)).toThrow(/PORTAL_SESSION_SECRET is not set/);
    expect(() => verifyPortalSession("v1.a.b")).toThrow(/PORTAL_SESSION_SECRET is not set/);
  });
});
