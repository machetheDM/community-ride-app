import { describe, it, expect, beforeEach } from "@jest/globals";
import { NextRequest } from "next/server";
import { rateLimit, __resetRateLimitStore } from "@/lib/rate-limit";
import { RateLimitError } from "@/lib/errors";

const reqFrom = (forwardedFor: string) =>
  new NextRequest("http://localhost/api/rides", { headers: { "x-forwarded-for": forwardedFor } });

describe("rateLimit", () => {
  beforeEach(() => __resetRateLimitStore());

  it("allows requests up to the limit", () => {
    const check = rateLimit({ windowMs: 60_000, maxRequests: 3 });
    const req = reqFrom("10.0.0.1");
    expect(() => {
      check(req);
      check(req);
      check(req);
    }).not.toThrow();
  });

  it("throws RateLimitError once the limit is exceeded", () => {
    const check = rateLimit({ windowMs: 60_000, maxRequests: 2 });
    const req = reqFrom("10.0.0.2");
    check(req);
    check(req);
    expect(() => check(req)).toThrow(RateLimitError);
  });

  it("tracks callers independently", () => {
    const check = rateLimit({ windowMs: 60_000, maxRequests: 1 });
    check(reqFrom("10.0.0.3"));
    expect(() => check(reqFrom("10.0.0.4"))).not.toThrow();
    expect(() => check(reqFrom("10.0.0.3"))).toThrow(RateLimitError);
  });

  // The hole behind threat model AU-1: the old limiter keyed on the left-most
  // entry, which the caller writes, so a new value bought a new bucket.
  it("ignores a spoofed left-most X-Forwarded-For entry and keys on the one the front end appended", () => {
    const check = rateLimit({ windowMs: 60_000, maxRequests: 1 });
    check(reqFrom("1.1.1.1, 203.0.113.7"));
    expect(() => check(reqFrom("2.2.2.2, 203.0.113.7"))).toThrow(RateLimitError);
    expect(() => check(reqFrom("203.0.113.7"))).toThrow(RateLimitError);
  });

  it("keeps two real clients apart even when both send the same spoofed entry", () => {
    const check = rateLimit({ windowMs: 60_000, maxRequests: 1 });
    check(reqFrom("9.9.9.9, 203.0.113.7"));
    expect(() => check(reqFrom("9.9.9.9, 203.0.113.8"))).not.toThrow();
  });

  it("resets after the window elapses", () => {
    const check = rateLimit({ windowMs: 10, maxRequests: 1 });
    const req = reqFrom("10.0.0.6");
    check(req);
    expect(() => check(req)).toThrow(RateLimitError);
    const until = Date.now() + 20;
    while (Date.now() < until) {
      /* wait out the window */
    }
    expect(() => check(req)).not.toThrow();
  });

  it("reports a retry-after hint in the message", () => {
    const check = rateLimit({ windowMs: 60_000, maxRequests: 1 });
    const req = reqFrom("10.0.0.7");
    check(req);
    expect(() => check(req)).toThrow(/Retry after \d+s/);
  });

  it("counts an explicit key, such as a phone number, with hit()", () => {
    const perPhone = rateLimit({ windowMs: 60_000, maxRequests: 2 });
    perPhone.hit("+27821234567");
    perPhone.hit("+27821234567");
    expect(() => perPhone.hit("+27821234567")).toThrow(RateLimitError);
    expect(() => perPhone.hit("+27831234567")).not.toThrow();
  });

  it("keeps each limiter's counts to itself", () => {
    const generous = rateLimit({ windowMs: 60_000, maxRequests: 100 });
    const strict = rateLimit({ windowMs: 60_000, maxRequests: 2 });
    const req = reqFrom("10.0.0.8");
    for (let i = 0; i < 5; i++) generous(req);
    // Five requests through another limiter must not have used this one up.
    expect(() => {
      strict(req);
      strict(req);
    }).not.toThrow();
  });
});

describe("rateLimit's bound on tracked keys", () => {
  beforeEach(() => __resetRateLimitStore());

  it("never tracks more keys than its bound", () => {
    const check = rateLimit({ windowMs: 60_000, maxRequests: 1, maxKeys: 3 });
    for (const key of ["a", "b", "c", "d", "e"]) check.hit(key);
    expect(check.size()).toBe(3);
  });

  it("evicts the oldest live key when full, not only the expired ones", () => {
    const check = rateLimit({ windowMs: 60_000, maxRequests: 1, maxKeys: 3 });
    for (const key of ["a", "b", "c", "d"]) check.hit(key);
    // "a" was the oldest window and made room for "d", so it starts afresh...
    expect(() => check.hit("a")).not.toThrow();
    // ...while "d", the newest, is still remembered.
    expect(() => check.hit("d")).toThrow(RateLimitError);
  });

  // The behaviour the old code got wrong, at the real default bound: a flood of
  // fresh, unexpired keys grew its map past MAX_TRACKED_KEYS for a whole window.
  it("stays bounded under a flood of fresh addresses at the default size", () => {
    const check = rateLimit({ windowMs: 60_000, maxRequests: 1 });
    check(reqFrom("198.51.100.1"));
    // The default bound as a literal, so the test means the same against the old
    // file, which did not export it.
    for (let i = 0; i < 10_000; i++) {
      check(reqFrom(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`));
    }
    // The first caller was the oldest window, so the flood pushed it out.
    expect(() => check(reqFrom("198.51.100.1"))).not.toThrow();
  });
});
