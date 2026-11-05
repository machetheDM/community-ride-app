import { describe, it, expect, beforeAll, beforeEach, afterAll } from "@jest/globals";
import { NextRequest } from "next/server";
import { __resetRateLimitStore } from "@/lib/rate-limit";

/**
 * The API's request hook (`src/proxy.ts`, Next 16's renamed middleware). It reads
 * CORS_ALLOWED_ORIGINS once at load, so the variable is set before the import.
 */

let proxy: (req: NextRequest) => Response;

beforeAll(async () => {
  process.env.CORS_ALLOWED_ORIGINS = "https://portal.example.co.za";
  proxy = (await import("@/proxy")).proxy;
});

beforeEach(() => __resetRateLimitStore());
afterAll(() => {
  delete process.env.CORS_ALLOWED_ORIGINS;
});

const request = (path: string, init: { method?: string; origin?: string; forwardedFor?: string } = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers: {
      "x-forwarded-for": init.forwardedFor ?? "203.0.113.7",
      ...(init.origin ? { origin: init.origin } : {}),
    },
  });

describe("proxy", () => {
  it("allows the listed origin and no other, and never answers with a wildcard", () => {
    const listed = proxy(request("/api/stores", { origin: "https://portal.example.co.za" }));
    const other = proxy(request("/api/stores", { origin: "https://evil.example" }));
    expect(listed.headers.get("access-control-allow-origin")).toBe("https://portal.example.co.za");
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers a preflight itself, without spending the caller's allowance", () => {
    for (let i = 0; i < 20; i++) {
      const res = proxy(request("/api/auth/verify-otp", { method: "OPTIONS", origin: "https://portal.example.co.za" }));
      expect(res.status).toBe(204);
    }
    expect(proxy(request("/api/auth/verify-otp", { method: "POST" })).status).not.toBe(429);
  });

  it("keeps the security headers on every response", () => {
    const res = proxy(request("/api/stores"));
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
  });

  it("holds a caller to the sign-in limit however they rewrite X-Forwarded-For", () => {
    const statuses = Array.from({ length: 11 }, (_, i) =>
      proxy(request("/api/auth/verify-otp", { method: "POST", forwardedFor: `10.0.0.${i}, 203.0.113.7` })).status
    );
    expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
