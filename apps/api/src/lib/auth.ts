import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";
import { AuthenticationError, AuthorizationError } from "./errors";

const DEV_FALLBACK_SECRET = "dev-secret-change-in-production";
const TOKEN_TTL = "30d";

/**
 * Pinned on both sides of every token (threat model AU-5).
 *
 * jsonwebtoken 9 already refuses `alg: none` and keeps a string secret to HMAC, so
 * the algorithm pin is hardening: it stops a future library default or a key-type
 * change from widening what verify accepts. Issuer and audience are what make a
 * token from this API mean something only to these apps. Another service signing
 * with a shared secret, or a token minted for a different purpose later (the
 * portal, a webhook), is refused rather than accepted as a sign-in.
 */
export const JWT_ALGORITHM = "HS256" as const;
export const JWT_ISSUER = "community-ride-api";
export const JWT_AUDIENCE = "community-ride-apps";

export interface AuthPayload {
  userId: string;
  phone: string;
  role: string;
  /**
   * `User.tokenVersion` at sign-in. `requireActiveUser` compares it with the
   * database on every request, so bumping the column (sign out everywhere, a
   * suspension) revokes every earlier token. Optional because tokens issued
   * before it existed lack it; they count as version 0.
   */
  tokenVersion?: number;
}

/**
 * Resolve the JWT signing secret, failing closed outside development.
 *
 * The previous implementation fell back to a hardcoded literal unconditionally,
 * so a production deploy that forgot to set JWT_SECRET would happily sign and
 * accept tokens anyone could forge from this repo's source. Missing config is
 * now a hard error everywhere except development and test.
 *
 * Resolved lazily rather than at module load so that `next build` — which runs
 * with NODE_ENV=production and no runtime secrets — does not fail.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length > 0) {
    if (process.env.NODE_ENV === "production" && secret === DEV_FALLBACK_SECRET) {
      throw new Error(
        "JWT_SECRET is set to the published development fallback. Refusing to start in production."
      );
    }
    return secret;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is not set. Refusing to sign or verify tokens in production.");
  }
  return DEV_FALLBACK_SECRET;
}

export function signAuthToken(payload: AuthPayload): string {
  const claims: AuthPayload = {
    userId: payload.userId,
    phone: payload.phone,
    role: payload.role,
    tokenVersion: payload.tokenVersion ?? 0,
  };
  return jwt.sign(claims, getJwtSecret(), {
    algorithm: JWT_ALGORITHM,
    expiresIn: TOKEN_TTL,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

export function getAuthUser(req: NextRequest): AuthPayload | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  // Resolved outside the try: a misconfigured secret must surface as a loud
  // 500, not be swallowed into an indistinguishable "invalid token" 401.
  const secret = getJwtSecret();
  let decoded: unknown;
  try {
    decoded = jwt.verify(header.slice(7), secret, {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  } catch {
    return null;
  }
  // A genuine signature over the wrong shape is still not a sign-in.
  if (typeof decoded !== "object" || decoded === null) return null;
  const claims = decoded as Record<string, unknown>;
  if (typeof claims.userId !== "string" || claims.userId.length === 0) return null;
  if (claims.tokenVersion !== undefined && !Number.isInteger(claims.tokenVersion)) return null;
  return decoded as AuthPayload;
}

export function requireAuth(req: NextRequest): AuthPayload {
  const user = getAuthUser(req);
  if (!user) throw new AuthenticationError();
  return user;
}

export function requireRole(req: NextRequest, ...roles: string[]): AuthPayload {
  const user = requireAuth(req);
  if (roles.length > 0 && !roles.includes(user.role)) {
    throw new AuthorizationError(`This action requires one of these roles: ${roles.join(", ")}`);
  }
  return user;
}

export function optionalAuth(req: NextRequest): AuthPayload | null {
  return getAuthUser(req);
}

/** The caller as the database knows them right now, not as their token remembers. */
export interface ActiveUser {
  userId: string;
  phone: string;
  role: UserRoleName;
}

export type UserRoleName = "CUSTOMER" | "DRIVER" | "RIDER" | "MERCHANT" | "ADMIN";

/**
 * Verifies the token, then checks the account is still active and the token has
 * not been revoked, and returns the role from the database.
 *
 * The token's own role claim is never trusted for a decision: a token lives 30
 * days, and a driver suspended this morning must not keep accepting rides until
 * it expires. Use this, not `requireAuth`, in every route that reads or changes
 * someone's data. One indexed primary-key read per request is the cost.
 */
export async function requireActiveUser(req: NextRequest, ...roles: UserRoleName[]): Promise<ActiveUser> {
  const token = requireAuth(req) as AuthPayload & { tokenVersion?: number };
  const { prisma } = await import("./prisma");
  const user = await prisma.user.findUnique({
    where: { id: token.userId },
    select: { id: true, phone: true, role: true, isActive: true, tokenVersion: true },
  });
  if (!user || !user.isActive || user.tokenVersion !== (token.tokenVersion ?? 0)) {
    throw new AuthenticationError();
  }
  if (roles.length > 0 && !roles.includes(user.role)) {
    throw new AuthorizationError(`This action requires one of these roles: ${roles.join(", ")}`);
  }
  return { userId: user.id, phone: user.phone, role: user.role };
}
