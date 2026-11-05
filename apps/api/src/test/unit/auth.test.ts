import { describe, it, expect, afterEach } from "@jest/globals";
import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";
import { getJwtSecret, signAuthToken, getAuthUser, requireAuth, requireRole } from "@/lib/auth";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";

const env = process.env as Record<string, string | undefined>;
const ORIGINAL_SECRET = env.JWT_SECRET;
const ORIGINAL_NODE_ENV = env.NODE_ENV;

afterEach(() => {
  env.JWT_SECRET = ORIGINAL_SECRET;
  env.NODE_ENV = ORIGINAL_NODE_ENV;
});

const bearer = (token: string) =>
  new NextRequest("http://localhost/api/rides", { headers: { authorization: `Bearer ${token}` } });

describe("getJwtSecret", () => {
  it("returns the configured secret", () => {
    env.JWT_SECRET = "a-configured-secret";
    expect(getJwtSecret()).toBe("a-configured-secret");
  });

  it("falls back to the dev secret outside production", () => {
    delete env.JWT_SECRET;
    env.NODE_ENV = "development";
    expect(getJwtSecret()).toBe("dev-secret-change-in-production");
  });

  it("refuses to run in production without a secret", () => {
    delete env.JWT_SECRET;
    env.NODE_ENV = "production";
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET is not set/);
  });

  it("refuses the published dev fallback in production", () => {
    env.JWT_SECRET = "dev-secret-change-in-production";
    env.NODE_ENV = "production";
    expect(() => getJwtSecret()).toThrow(/published development fallback/);
  });

  it("treats an empty secret as unset", () => {
    env.JWT_SECRET = "";
    env.NODE_ENV = "production";
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET is not set/);
  });
});

describe("token round-trip", () => {
  it("signs a token that getAuthUser can read back", () => {
    env.JWT_SECRET = "round-trip-secret";
    const token = signAuthToken({ userId: "u1", phone: "+27810000001", role: "CUSTOMER" });
    const user = getAuthUser(bearer(token));
    expect(user).toMatchObject({ userId: "u1", phone: "+27810000001", role: "CUSTOMER" });
  });

  it("rejects a token signed with a different secret", () => {
    env.JWT_SECRET = "the-real-secret";
    const forged = jwt.sign({ userId: "u1", phone: "+27810000001", role: "ADMIN" }, "attacker-secret");
    expect(getAuthUser(bearer(forged))).toBeNull();
  });

  it("rejects an expired token", () => {
    env.JWT_SECRET = "expiry-secret";
    const expired = jwt.sign({ userId: "u1" }, "expiry-secret", { expiresIn: "-1s" });
    expect(getAuthUser(bearer(expired))).toBeNull();
  });
});

describe("getAuthUser", () => {
  it("returns null when the header is absent", () => {
    expect(getAuthUser(new NextRequest("http://localhost/api/rides"))).toBeNull();
  });

  it("returns null for a non-Bearer scheme", () => {
    const req = new NextRequest("http://localhost/api/rides", {
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(getAuthUser(req)).toBeNull();
  });

  it("returns null for a malformed token", () => {
    env.JWT_SECRET = "some-secret";
    expect(getAuthUser(bearer("not-a-jwt"))).toBeNull();
  });
});

describe("token algorithm, issuer and audience", () => {
  const SECRET = "pinning-secret";
  const claims = { userId: "u1", phone: "+27810000001", role: "ADMIN" };
  const ours = { issuer: "community-ride-api", audience: "community-ride-apps" };

  /** A JWT with whatever header the caller likes, signed (or not) by hand. */
  function handMade(header: object, payload: object, signature = ""): string {
    const enc = (part: object) => Buffer.from(JSON.stringify(part)).toString("base64url");
    return `${enc(header)}.${enc(payload)}.${signature}`;
  }

  it("signs with HS256 and names this API as issuer and the apps as audience", () => {
    env.JWT_SECRET = SECRET;
    const decoded = jwt.decode(signAuthToken(claims), { complete: true });
    expect(decoded?.header.alg).toBe("HS256");
    expect(decoded?.payload).toMatchObject({ iss: "community-ride-api", aud: "community-ride-apps" });
  });

  it("carries the user's token version, so signing out everywhere can revoke it", () => {
    env.JWT_SECRET = SECRET;
    expect(jwt.decode(signAuthToken({ ...claims, tokenVersion: 4 }))).toMatchObject({ tokenVersion: 4 });
    expect(jwt.decode(signAuthToken(claims))).toMatchObject({ tokenVersion: 0 });
  });

  it("refuses an unsigned token (alg: none)", () => {
    env.JWT_SECRET = SECRET;
    const now = Math.floor(Date.now() / 1000);
    const unsigned = handMade(
      { alg: "none", typ: "JWT" },
      { ...claims, iss: ours.issuer, aud: ours.audience, iat: now, exp: now + 60 }
    );
    expect(getAuthUser(bearer(unsigned))).toBeNull();
  });

  it("refuses a token signed with the right secret under another algorithm", () => {
    env.JWT_SECRET = SECRET;
    const hs512 = jwt.sign(claims, SECRET, { algorithm: "HS512", ...ours });
    expect(getAuthUser(bearer(hs512))).toBeNull();
  });

  it("refuses a token minted for another audience", () => {
    env.JWT_SECRET = SECRET;
    const elsewhere = jwt.sign(claims, SECRET, { algorithm: "HS256", issuer: ours.issuer, audience: "some-other-service" });
    expect(getAuthUser(bearer(elsewhere))).toBeNull();
  });

  it("refuses a token from another issuer, or with no issuer and audience at all", () => {
    env.JWT_SECRET = SECRET;
    const otherIssuer = jwt.sign(claims, SECRET, { algorithm: "HS256", issuer: "someone-else", audience: ours.audience });
    const bare = jwt.sign(claims, SECRET, { algorithm: "HS256" });
    expect(getAuthUser(bearer(otherIssuer))).toBeNull();
    expect(getAuthUser(bearer(bare))).toBeNull();
  });

  it("refuses a genuine token whose payload names no user", () => {
    env.JWT_SECRET = SECRET;
    const anonymous = jwt.sign({ role: "ADMIN" }, SECRET, { algorithm: "HS256", ...ours });
    expect(getAuthUser(bearer(anonymous))).toBeNull();
  });
});

describe("requireAuth / requireRole", () => {
  it("throws AuthenticationError when unauthenticated", () => {
    expect(() => requireAuth(new NextRequest("http://localhost/api/rides"))).toThrow(AuthenticationError);
  });

  it("allows a permitted role", () => {
    env.JWT_SECRET = "role-secret";
    const token = signAuthToken({ userId: "u1", phone: "+27810000001", role: "DRIVER" });
    expect(requireRole(bearer(token), "DRIVER", "ADMIN").role).toBe("DRIVER");
  });

  it("throws AuthorizationError for a disallowed role", () => {
    env.JWT_SECRET = "role-secret";
    const token = signAuthToken({ userId: "u1", phone: "+27810000001", role: "CUSTOMER" });
    expect(() => requireRole(bearer(token), "ADMIN")).toThrow(AuthorizationError);
  });
});
