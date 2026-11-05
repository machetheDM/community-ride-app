import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { keyedHash } from "@ride/db/crypto";
import {
  issueOtp,
  verifyOtp,
  smsTransportFromEnv,
  consoleSmsTransport,
  MAX_ATTEMPTS_PER_CODE,
  type SmsTransport,
} from "@ride/db/otp";
import { createFakeDb, type FakeDb } from "./fakes/fake-db";

const PHONE = "+27821234567";
const MINUTE = 60_000;
const env = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = env.NODE_ENV;
const ORIGINAL_PROVIDER = env.SMS_PROVIDER;

/** Records what would have been texted, so a test can read the code. */
function captureSms() {
  const sent: Array<{ to: string; text: string }> = [];
  const sms: SmsTransport = {
    async send(to, text) {
      sent.push({ to, text });
    },
  };
  return { sms, sent };
}

/** A wrong code that is never the right one. */
function wrong(code: string): string {
  return code === "000000" ? "111111" : "000000";
}

let db: FakeDb;
let clock: number;
const at = (offsetMs = 0) => new Date(clock + offsetMs);

async function issue(offsetMs = 0) {
  const { sms } = captureSms();
  const result = await issueOtp(db, PHONE, { sms, now: at(offsetMs) });
  if (!result.ok) throw new Error(`expected a code, got ${result.reason}`);
  return result.code;
}

/**
 * A fresh copy of the OTP module whose `./crypto` has a spy on `hashesEqual`.
 *
 * `jest.doMock` inside `isolateModulesAsync` rather than a hoisted `jest.mock`:
 * under next/jest's SWC transform a top-level `jest.mock` does not intercept
 * (see maps-cache.test.ts), and a spy that silently is not one would pass a test
 * it should fail.
 */
async function otpWithComparisonSpy() {
  const realCrypto = jest.requireActual<typeof import("@ride/db/crypto")>("@ride/db/crypto");
  const hashesEqual = jest.fn(realCrypto.hashesEqual);
  let otp!: typeof import("@ride/db/otp");
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@ride/db/crypto", () => ({ ...realCrypto, hashesEqual }));
    otp = await import("@ride/db/otp");
  });
  return { otp, hashesEqual };
}

beforeEach(() => {
  db = createFakeDb();
  clock = Date.UTC(2026, 10, 4, 8, 0, 0);
});

afterEach(() => {
  env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_PROVIDER === undefined) delete env.SMS_PROVIDER;
  else env.SMS_PROVIDER = ORIGINAL_PROVIDER;
});

describe("issueOtp", () => {
  it("issues a six-digit code, stores only its keyed hash, and expires it in ten minutes", async () => {
    const code = await issue();
    expect(code).toMatch(/^\d{6}$/);
    const [row] = db.state.otps;
    expect(row.codeHash).toBe(keyedHash(code, "OTP_HASH_KEY"));
    expect(row.codeHash).not.toContain(code);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(10 * MINUTE);
  });

  it("texts the code to the phone it was issued for", async () => {
    const { sms, sent } = captureSms();
    const result = await issueOtp(db, PHONE, { sms, now: at() });
    expect(result.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(PHONE);
    expect(sent[0].text).toContain(result.ok ? result.code : "never");
  });

  it("voids the earlier live codes, so a phone never holds more than one", async () => {
    await issue();
    await issue(MINUTE);
    const live = db.state.otps.filter((row) => !row.used);
    expect(live).toHaveLength(1);
  });

  it("refuses a fourth code within fifteen minutes and says when the next is possible", async () => {
    await issue(0);
    await issue(1 * MINUTE);
    await issue(2 * MINUTE);
    const { sms, sent } = captureSms();
    const refused = await issueOtp(db, PHONE, { sms, now: at(3 * MINUTE) });
    expect(refused).toEqual({ ok: false, reason: "send_cap", retryAfterSeconds: 12 * 60 });
    expect(sent).toHaveLength(0);
    expect(db.state.otps).toHaveLength(3);
  });

  it("allows another code once the fifteen-minute window has passed", async () => {
    await issue(0);
    await issue(1 * MINUTE);
    await issue(2 * MINUTE);
    await expect(issue(15 * MINUTE + 1)).resolves.toMatch(/^\d{6}$/);
  });

  it("refuses an eleventh code in a day even when spread out", async () => {
    for (let i = 0; i < 10; i++) await issue(i * 20 * MINUTE);
    const { sms } = captureSms();
    const refused = await issueOtp(db, PHONE, { sms, now: at(10 * 20 * MINUTE) });
    expect(refused.ok).toBe(false);
  });

  it("refuses a number that is not a normalised South African mobile", async () => {
    const { sms, sent } = captureSms();
    await expect(issueOtp(db, "+447700900123", { sms })).rejects.toThrow(/South African mobile/);
    await expect(issueOtp(db, "0821234567", { sms })).rejects.toThrow(/South African mobile/);
    expect(sent).toHaveLength(0);
  });

  it("burns the code when the SMS cannot be sent, since nobody received it", async () => {
    const failing: SmsTransport = {
      async send() {
        throw new Error("provider down");
      },
    };
    await expect(issueOtp(db, PHONE, { sms: failing, now: at() })).rejects.toThrow("provider down");
    expect(db.state.otps).toHaveLength(1);
    expect(db.state.otps[0].used).toBe(true);
  });
});

describe("verifyOtp", () => {
  it("accepts the right code once", async () => {
    const code = await issue();
    await expect(verifyOtp(db, PHONE, code, { now: at(MINUTE) })).resolves.toEqual({ ok: true });
  });

  it("refuses a code that was already used", async () => {
    const code = await issue();
    await verifyOtp(db, PHONE, code, { now: at(MINUTE) });
    await expect(verifyOtp(db, PHONE, code, { now: at(2 * MINUTE) })).resolves.toEqual({
      ok: false,
      reason: "no_live_code",
    });
  });

  it("refuses a code superseded by a newer one, even though it has not expired", async () => {
    const first = await issue();
    const second = await issue(MINUTE);
    expect((await verifyOtp(db, PHONE, first, { now: at(2 * MINUTE) })).ok).toBe(false);
    await expect(verifyOtp(db, PHONE, second, { now: at(3 * MINUTE) })).resolves.toEqual({ ok: true });
  });

  it("refuses an expired code", async () => {
    const code = await issue();
    await expect(verifyOtp(db, PHONE, code, { now: at(10 * MINUTE + 1) })).resolves.toEqual({
      ok: false,
      reason: "no_live_code",
    });
  });

  it("burns a code after five wrong guesses, so the right code then fails too", async () => {
    const code = await issue();
    for (let i = 0; i < MAX_ATTEMPTS_PER_CODE; i++) {
      expect(await verifyOtp(db, PHONE, wrong(code), { now: at(MINUTE) })).toEqual({ ok: false, reason: "wrong_code" });
    }
    expect(db.state.otps[0].used).toBe(true);
    expect((await verifyOtp(db, PHONE, code, { now: at(MINUTE) })).ok).toBe(false);
  });

  it("still accepts the right code after four wrong guesses, and counts only the wrong ones", async () => {
    const code = await issue();
    for (let i = 0; i < MAX_ATTEMPTS_PER_CODE - 1; i++) await verifyOtp(db, PHONE, wrong(code), { now: at(MINUTE) });
    await expect(verifyOtp(db, PHONE, code, { now: at(MINUTE) })).resolves.toEqual({ ok: true });
    expect(db.state.otps[0].attempts).toBe(MAX_ATTEMPTS_PER_CODE - 1);
  });

  it("locks the phone after ten wrong guesses across codes, refusing even a fresh right code", async () => {
    const first = await issue(0);
    for (let i = 0; i < 5; i++) await verifyOtp(db, PHONE, wrong(first), { now: at(MINUTE) });
    const second = await issue(2 * MINUTE);
    for (let i = 0; i < 5; i++) await verifyOtp(db, PHONE, wrong(second), { now: at(3 * MINUTE) });

    const third = await issue(4 * MINUTE);
    await expect(verifyOtp(db, PHONE, third, { now: at(5 * MINUTE) })).resolves.toEqual({ ok: false, reason: "locked" });
  });

  it("lifts the lockout once the guesses fall out of the fifteen-minute window", async () => {
    const first = await issue(0);
    for (let i = 0; i < 5; i++) await verifyOtp(db, PHONE, wrong(first), { now: at(MINUTE) });
    const second = await issue(2 * MINUTE);
    for (let i = 0; i < 5; i++) await verifyOtp(db, PHONE, wrong(second), { now: at(3 * MINUTE) });

    // The second code expired at 12 minutes, so its guesses leave the window at 27.
    const later = await issue(28 * MINUTE);
    await expect(verifyOtp(db, PHONE, later, { now: at(29 * MINUTE) })).resolves.toEqual({ ok: true });
  });

  it("compares through the constant-time hashesEqual, and never looks a code up by its hash", async () => {
    const { otp, hashesEqual } = await otpWithComparisonSpy();
    const code = await issue();
    await expect(otp.verifyOtp(db, PHONE, code, { now: at(MINUTE) })).resolves.toEqual({ ok: true });
    expect(hashesEqual).toHaveBeenCalledWith(keyedHash(code, "OTP_HASH_KEY"), db.state.otps[0].codeHash);
    expect(db.state.otpLookups.length).toBeGreaterThan(0);
    for (const where of db.state.otpLookups) expect(where).not.toHaveProperty("codeHash");
  });

  it("allows at most five comparisons per code however many guesses arrive at once", async () => {
    const { otp, hashesEqual } = await otpWithComparisonSpy();
    const code = await issue();
    const guesses = Array.from({ length: 25 }, () => otp.verifyOtp(db, PHONE, wrong(code), { now: at(MINUTE) }));
    const results = await Promise.all(guesses);
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(hashesEqual).toHaveBeenCalledTimes(MAX_ATTEMPTS_PER_CODE);
    expect(db.state.otps[0].attempts).toBe(MAX_ATTEMPTS_PER_CODE);
  });

  it("lets only one of two simultaneous right guesses sign in", async () => {
    const code = await issue();
    const results = await Promise.all([
      verifyOtp(db, PHONE, code, { now: at(MINUTE) }),
      verifyOtp(db, PHONE, code, { now: at(MINUTE) }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("does not count a malformed code as a guess", async () => {
    await issue();
    await expect(verifyOtp(db, PHONE, "12ab56", { now: at(MINUTE) })).resolves.toEqual({ ok: false, reason: "wrong_code" });
    expect(db.state.otps[0].attempts).toBe(0);
  });
});

describe("smsTransportFromEnv", () => {
  it("has nothing to offer in production while no provider is integrated", () => {
    expect(smsTransportFromEnv({ NODE_ENV: "production" })).toBeNull();
    expect(smsTransportFromEnv({ NODE_ENV: "production", SMS_PROVIDER: "console" })).toBeNull();
    expect(smsTransportFromEnv({ NODE_ENV: "production", SMS_PROVIDER: "twilio" })).toBeNull();
  });

  it("uses the console transport outside production", () => {
    expect(smsTransportFromEnv({ NODE_ENV: "development" })).toBe(consoleSmsTransport);
    expect(smsTransportFromEnv({ NODE_ENV: "test", SMS_PROVIDER: "console" })).toBe(consoleSmsTransport);
  });

  it("does not pretend an unknown provider works", () => {
    expect(smsTransportFromEnv({ NODE_ENV: "development", SMS_PROVIDER: "unknown" })).toBeNull();
  });
});

describe("consoleSmsTransport", () => {
  it("prints the message with a masked number in development", async () => {
    env.NODE_ENV = "development";
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    await consoleSmsTransport.send(PHONE, "Your code is 123456");
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0][0]);
    expect(line).toContain("123456");
    expect(line).not.toContain(PHONE);
    info.mockRestore();
  });

  it("prints nothing in any other environment, since a logged code is a sign-in", async () => {
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    for (const mode of ["production", "test"]) {
      env.NODE_ENV = mode;
      await consoleSmsTransport.send(PHONE, "Your code is 123456");
    }
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });
});
