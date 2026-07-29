import { describe, it, expect, beforeEach } from "@jest/globals";
import { NextRequest } from "next/server";
import { rateLimit, __resetRateLimitStore } from "@/lib/rate-limit";
import { RateLimitError } from "@/lib/errors";

const reqFrom = (ip: string) =>
  new NextRequest("http://localhost/api/rides", { headers: { "x-forwarded-for": ip } });

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

  it("uses only the client IP from a proxy chain, not the whole header", () => {
    const check = rateLimit({ windowMs: 60_000, maxRequests: 1 });
    const viaProxyA = new NextRequest("http://localhost/api/rides", {
      headers: { "x-forwarded-for": "10.0.0.5, 172.16.0.1" },
    });
    const viaProxyB = new NextRequest("http://localhost/api/rides", {
      headers: { "x-forwarded-for": "10.0.0.5, 172.16.0.9" },
    });
    check(viaProxyA);
    // Same client, different downstream proxy — must share one bucket.
    expect(() => check(viaProxyB)).toThrow(RateLimitError);
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
});
