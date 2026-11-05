import { describe, it, expect, beforeAll, beforeEach, afterEach, jest } from "@jest/globals";
import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { issueOtp, type SmsTransport } from "@ride/db/otp";
import { signAuthToken } from "@/lib/auth";
import { __resetRateLimitStore } from "@/lib/rate-limit";
import { sharedFakeDb as db } from "./fakes/fake-db";

/**
 * The sign-in routes end to end, against the in-memory database.
 *
 * `jest.doMock` before a dynamic import, not a hoisted `jest.mock`: under
 * next/jest's SWC transform a top-level `jest.mock` does not intercept (see
 * maps-cache.test.ts), and a route silently talking to the real Prisma client
 * would reach for the DATABASE_URL in a developer's .env.
 */

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<NextResponse>;
let requestOtp: Handler;
let verifyOtpRoute: Handler;
let logoutAll: Handler;

const env = process.env as Record<string, string | undefined>;
const ORIGINAL = { NODE_ENV: env.NODE_ENV, SMS_PROVIDER: env.SMS_PROVIDER, LOG_LEVEL: env.LOG_LEVEL };
const PHONE = "+27821234567";

beforeAll(async () => {
  env.LOG_LEVEL = "error";
  const realAudit = jest.requireActual<typeof import("../../../../../packages/db/src/audit")>(
    "../../../../../packages/db/src/audit"
  );
  jest.doMock("@/lib/prisma", () => ({ prisma: db }));
  jest.doMock("@ride/db", () => ({ recordAudit: realAudit.recordAudit, recordAuditStrict: realAudit.recordAuditStrict }));
  requestOtp = (await import("@/app/api/auth/request-otp/route")).POST as Handler;
  verifyOtpRoute = (await import("@/app/api/auth/verify-otp/route")).POST as Handler;
  logoutAll = (await import("@/app/api/auth/logout-all/route")).POST as Handler;
});

beforeEach(() => {
  db.reset();
  __resetRateLimitStore();
  env.NODE_ENV = "test";
  delete env.SMS_PROVIDER;
});

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  env.LOG_LEVEL = "error";
});

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7", ...headers },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({}) };
const send = (body: unknown, headers?: Record<string, string>) => requestOtp(post("/api/auth/request-otp", body, headers), ctx);
const verify = (body: unknown) => verifyOtpRoute(post("/api/auth/verify-otp", body), ctx);

/** Issues a code straight through the module, capturing it as the SMS would. */
async function codeFor(phone = PHONE): Promise<string> {
  const sms: SmsTransport = { async send() {} };
  const result = await issueOtp(db, phone, { sms });
  if (!result.ok) throw new Error("send cap reached in a test");
  return result.code;
}

const wrong = (code: string) => (code === "000000" ? "111111" : "000000");

describe("POST /api/auth/request-otp", () => {
  it("answers 503 'SMS is not configured' in production with no provider, and issues nothing", async () => {
    env.NODE_ENV = "production";
    const quiet = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await send({ phone: PHONE });
    quiet.mockRestore();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("SMS is not configured");
    expect(db.state.otps).toHaveLength(0);
  });

  it("returns the code in the response in development only", async () => {
    env.NODE_ENV = "development";
    const quiet = jest.spyOn(console, "info").mockImplementation(() => undefined);
    const dev = await (await send({ phone: PHONE })).json();
    quiet.mockRestore();
    expect(dev.data.code).toMatch(/^\d{6}$/);

    env.NODE_ENV = "test";
    const other = await send({ phone: "+27831234567" });
    expect(other.status).toBe(200);
    expect((await other.json()).data).not.toHaveProperty("code");
  });

  it("refuses a number outside South Africa", async () => {
    const res = await send({ phone: "+447700900123" });
    expect(res.status).toBe(400);
    expect(db.state.otps).toHaveLength(0);
  });

  it("refuses a fourth code for one phone within fifteen minutes, from any address", async () => {
    for (const ip of ["198.51.100.1", "198.51.100.2", "198.51.100.3"]) {
      expect((await send({ phone: PHONE }, { "x-forwarded-for": ip })).status).toBe(200);
    }
    const fourth = await send({ phone: PHONE }, { "x-forwarded-for": "198.51.100.4" });
    expect(fourth.status).toBe(429);
    expect(Number(fourth.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("supersedes the earlier code when a new one is requested", async () => {
    env.NODE_ENV = "development";
    const quiet = jest.spyOn(console, "info").mockImplementation(() => undefined);
    const first = (await (await send({ phone: PHONE })).json()).data.code as string;
    const second = (await (await send({ phone: PHONE })).json()).data.code as string;
    quiet.mockRestore();
    expect((await verify({ phone: PHONE, code: first })).status).toBe(401);
    expect((await verify({ phone: PHONE, code: second })).status).toBe(200);
  });
});

describe("POST /api/auth/verify-otp", () => {
  it("signs in with the right code, in an HS256 token for these apps carrying the user's token version", async () => {
    db.addUser({ phone: PHONE, tokenVersion: 2 });
    const res = await verify({ phone: PHONE, code: await codeFor() });
    expect(res.status).toBe(200);
    const { token } = (await res.json()).data;
    const claims = jwt.verify(token, env.JWT_SECRET!, {
      algorithms: ["HS256"],
      issuer: "community-ride-api",
      audience: "community-ride-apps",
    });
    expect(claims).toMatchObject({ tokenVersion: 2 });
  });

  it("makes six guesses and is locked out: after five wrong ones, the right code is refused", async () => {
    db.addUser({ phone: PHONE });
    const code = await codeFor();
    for (let i = 0; i < 5; i++) expect((await verify({ phone: PHONE, code: wrong(code) })).status).toBe(401);
    const sixth = await verify({ phone: PHONE, code });
    expect(sixth.status).toBe(401);
    expect((await sixth.json()).data).toBeUndefined();
  });

  it("gives one message for a wrong code, a missing code and a locked phone", async () => {
    const messages = new Set<string>();
    const code = await codeFor();
    messages.add((await (await verify({ phone: PHONE, code: wrong(code) })).json()).error);
    messages.add((await (await verify({ phone: "+27831234567", code: "123456" })).json()).error);
    for (let i = 0; i < 4; i++) await verify({ phone: PHONE, code: wrong(code) });
    const next = await codeFor();
    for (let i = 0; i < 5; i++) await verify({ phone: PHONE, code: wrong(next) });
    const locked = await verify({ phone: PHONE, code: await codeFor() });
    expect(locked.status).toBe(401);
    messages.add((await locked.json()).error);
    expect([...messages]).toEqual(["Invalid or expired code"]);
  });

  it("refuses a suspended account and issues no token", async () => {
    db.addUser({ phone: PHONE, isActive: false });
    const res = await verify({ phone: PHONE, code: await codeFor() });
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toMatch(/token/);
  });

  it("records a failed guess in the audit trail without the code or the guess", async () => {
    const code = await codeFor();
    const guess = wrong(code);
    await verify({ phone: PHONE, code: guess });
    expect(db.state.audits).toHaveLength(1);
    expect(db.state.audits[0]).toMatchObject({ action: "auth.otp.verify.fail", ip: "203.0.113.7" });
    const written = JSON.stringify(db.state.audits);
    expect(written).not.toContain(code);
    expect(written).not.toContain(guess);
    expect(written).not.toContain(PHONE);
  });

  it("still creates a customer account for a number it has not seen", async () => {
    const res = await verify({ phone: PHONE, code: await codeFor() });
    expect(res.status).toBe(200);
    expect(db.state.users).toHaveLength(1);
    expect(db.state.users[0]).toMatchObject({ phone: PHONE, role: "CUSTOMER" });
  });
});

describe("POST /api/auth/logout-all", () => {
  const callWith = (token?: string) =>
    logoutAll(post("/api/auth/logout-all", {}, token ? { authorization: `Bearer ${token}` } : {}), ctx);

  it("bumps the token version, so every token issued before stops working", async () => {
    const user = db.addUser({ phone: PHONE, tokenVersion: 0 });
    const token = signAuthToken({ userId: user.id, phone: PHONE, role: user.role, tokenVersion: 0 });
    expect((await callWith(token)).status).toBe(200);
    expect(db.state.users[0].tokenVersion).toBe(1);
    expect((await callWith(token)).status).toBe(401);
    expect(db.state.audits.map((a) => a.action)).toContain("auth.logout_all");
  });

  it("refuses a caller with no token", async () => {
    expect((await callWith()).status).toBe(401);
  });
});
