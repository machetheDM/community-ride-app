import { describe, it, expect } from "@jest/globals";
import { NextResponse } from "next/server";
import { addSecurityHeaders, applyCors, parseAllowedOrigins, sanitizeInput, sanitizeObject } from "@/lib/security";

describe("parseAllowedOrigins", () => {
  it("reads exact origins from a comma-separated list, normalising each", () => {
    const origins = parseAllowedOrigins(" https://portal.example.co.za , http://localhost:3001/ ");
    expect([...origins]).toEqual(["https://portal.example.co.za", "http://localhost:3001"]);
  });

  it("refuses a wildcard, which would undo the allow-list", () => {
    expect(parseAllowedOrigins("*").size).toBe(0);
    expect([...parseAllowedOrigins("*, https://ok.example")]).toEqual(["https://ok.example"]);
  });

  it("ignores values that are not http or https origins", () => {
    expect(parseAllowedOrigins("not a url, ftp://files.example, javascript:alert(1)").size).toBe(0);
  });

  it("allows nothing when unset", () => {
    expect(parseAllowedOrigins(undefined).size).toBe(0);
  });
});

describe("applyCors", () => {
  const allowed = parseAllowedOrigins("https://portal.example.co.za");

  it("echoes an allowed origin, never a wildcard", () => {
    const res = applyCors(NextResponse.next(), "https://portal.example.co.za", allowed);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://portal.example.co.za");
    expect(res.headers.get("Vary")).toContain("Origin");
  });

  it("gives any other origin no allow header, so the browser withholds the response", () => {
    const res = applyCors(NextResponse.next(), "https://evil.example", allowed);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Vary")).toContain("Origin");
  });

  it("leaves a request with no Origin, like the mobile apps', untouched", () => {
    const res = applyCors(NextResponse.next(), null, allowed);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("addSecurityHeaders", () => {
  it("sets the expected hardening headers", () => {
    const res = addSecurityHeaders(NextResponse.next());
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=");
  });

  it("disables camera, microphone and geolocation by default", () => {
    const res = addSecurityHeaders(NextResponse.next());
    expect(res.headers.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
  });
});

describe("sanitizeInput", () => {
  it("strips HTML tags", () => {
    expect(sanitizeInput("<script>alert(1)</script>hello")).toBe("alert(1)hello");
  });

  it("strips stray angle brackets", () => {
    expect(sanitizeInput("unclosed < bracket")).toBe("unclosed  bracket");
  });

  // Documented tradeoff: the tag regex is greedy about anything that looks like
  // a tag, so prose containing a matched pair of angle brackets loses the text
  // between them. Accepted deliberately — over-stripping is the safe direction
  // for a sanitizer, and this is defence in depth behind React's escaping.
  it("also removes text framed by angle brackets", () => {
    expect(sanitizeInput("5 < 10 > 2")).toBe("5  2");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeInput("   spaced   ")).toBe("spaced");
  });

  it("leaves ordinary text untouched", () => {
    expect(sanitizeInput("Mama African Kitchen")).toBe("Mama African Kitchen");
  });
});

describe("sanitizeObject", () => {
  it("sanitizes string values and leaves others alone", () => {
    const result = sanitizeObject({ name: "<b>Store</b>", rating: 4.5, isOpen: true });
    expect(result).toEqual({ name: "Store", rating: 4.5, isOpen: true });
  });

  it("does not mutate the input object", () => {
    const input = { name: "<b>Store</b>" };
    sanitizeObject(input);
    expect(input.name).toBe("<b>Store</b>");
  });
});
