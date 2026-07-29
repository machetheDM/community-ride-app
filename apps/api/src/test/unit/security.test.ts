import { describe, it, expect } from "@jest/globals";
import { NextResponse } from "next/server";
import { addSecurityHeaders, sanitizeInput, sanitizeObject } from "@/lib/security";

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
