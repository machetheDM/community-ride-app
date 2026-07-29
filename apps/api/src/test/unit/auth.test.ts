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
