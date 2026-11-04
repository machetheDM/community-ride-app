import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";
import { AuthenticationError, AuthorizationError } from "./errors";

const DEV_FALLBACK_SECRET = "dev-secret-change-in-production";
const TOKEN_TTL = "30d";

export interface AuthPayload {
  userId: string;
  phone: string;
  role: string;
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
  return jwt.sign(payload, getJwtSecret(), { expiresIn: TOKEN_TTL });
}

export function getAuthUser(req: NextRequest): AuthPayload | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  // Resolved outside the try: a misconfigured secret must surface as a loud
  // 500, not be swallowed into an indistinguishable "invalid token" 401.
  const secret = getJwtSecret();
  try {
    return jwt.verify(header.slice(7), secret) as AuthPayload;
  } catch {
    return null;
  }
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
