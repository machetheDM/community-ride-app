import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-in-production";

export interface AuthPayload {
  userId: string;
  phone: string;
  role: string;
}

export function getAuthUser(req: NextRequest): AuthPayload | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(header.slice(7), JWT_SECRET) as AuthPayload;
  } catch {
    return null;
  }
}

export function requireAuth(req: NextRequest): AuthPayload {
  const user = getAuthUser(req);
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}
