import { describe, it, expect, jest } from "@jest/globals";
import { NextRequest } from "next/server";
import { clientIpFromForwardedFor, getClientIp, trustedProxyHops } from "@/lib/client-ip";
import { clientIpFrom as portalClientIpFrom } from "../../../../merchant-portal/src/lib/client-ip";

const req = (forwardedFor?: string) =>
  new NextRequest("http://localhost/api/rides", {
    headers: forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor },
  });

describe("getClientIp", () => {
  it("takes the entry Cloud Run's front end appended, the right-most, by default", () => {
    expect(getClientIp(req("203.0.113.7"), {})).toBe("203.0.113.7");
  });

  it("ignores a spoofed left-most entry", () => {
    expect(getClientIp(req("6.6.6.6, 203.0.113.7"), {})).toBe("203.0.113.7");
    expect(getClientIp(req("1.2.3.4, 5.6.7.8, 203.0.113.7"), {})).toBe("203.0.113.7");
  });

  it("counts two hops from the right behind a load balancer", () => {
    expect(getClientIp(req("6.6.6.6, 203.0.113.7, 34.120.0.1"), { TRUST_PROXY_HOPS: "2" })).toBe("203.0.113.7");
  });

  it("takes the left-most entry when there are fewer entries than trusted hops", () => {
    expect(getClientIp(req("203.0.113.7"), { TRUST_PROXY_HOPS: "2" })).toBe("203.0.113.7");
  });

  it("reads nothing from the header when no hop is trusted", () => {
    expect(getClientIp(req("203.0.113.7"), { TRUST_PROXY_HOPS: "0" })).toBe("unknown");
  });

  it("answers unknown with no header, and for an entry that is not an address", () => {
    expect(getClientIp(req(), {})).toBe("unknown");
    expect(getClientIp(req("1.1.1.1, <script>"), {})).toBe("unknown");
    expect(getClientIp(req(`1.1.1.1, ${"a".repeat(100)}`), {})).toBe("unknown");
  });

  it("accepts IPv6 addresses", () => {
    expect(getClientIp(req("2001:db8::1"), {})).toBe("2001:db8::1");
  });

  it("falls back to one hop, with a warning, when TRUST_PROXY_HOPS is not a small integer", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(trustedProxyHops({ TRUST_PROXY_HOPS: "lots" })).toBe(1);
    expect(trustedProxyHops({ TRUST_PROXY_HOPS: "-1" })).toBe(1);
    expect(trustedProxyHops({ TRUST_PROXY_HOPS: "1.5" })).toBe(1);
    warn.mockRestore();
  });
});

describe("the portal's copy of the rule", () => {
  const cases: Array<[string | null, string | undefined]> = [
    ["203.0.113.7", undefined],
    ["6.6.6.6, 203.0.113.7", undefined],
    ["6.6.6.6, 203.0.113.7, 34.120.0.1", "2"],
    ["203.0.113.7", "2"],
    ["203.0.113.7", "0"],
    [null, undefined],
    ["1.1.1.1, not-an-ip", undefined],
    ["2001:db8::1", "nonsense"],
  ];

  it.each(cases)("agrees with the API for %p with TRUST_PROXY_HOPS=%p", (header, hops) => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const api = clientIpFromForwardedFor(header, trustedProxyHops({ TRUST_PROXY_HOPS: hops })) ?? "unknown";
    expect(portalClientIpFrom(header, hops)).toBe(api);
    warn.mockRestore();
  });
});
