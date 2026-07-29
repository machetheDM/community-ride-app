import { NextRequest, NextResponse } from "next/server";
import { addSecurityHeaders } from "@/lib/security";
import { defaultLimiter, authLimiter } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const AUTH_ROUTES = ["/api/auth/request-otp", "/api/auth/verify-otp"];

export function middleware(req: NextRequest) {
  const start = Date.now();
  const path = req.nextUrl.pathname;

  // Skip middleware for non-API routes
  if (!path.startsWith("/api/")) {
    return NextResponse.next();
  }

  try {
    // Rate limit auth endpoints more strictly
    if (AUTH_ROUTES.includes(path)) {
      authLimiter(req);
    } else if (path.startsWith("/api/")) {
      defaultLimiter(req);
    }
  } catch {
    const response = NextResponse.json(
      { success: false, error: "Too many requests. Please try again later." },
      { status: 429 }
    );
    addSecurityHeaders(response);
    return response;
  }

  const response = NextResponse.next();

  // Add security headers
  addSecurityHeaders(response);

  // CORS headers
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  const duration = Date.now() - start;
  if (duration > 50) {
    logger.warn(`Slow middleware: ${path} (${duration}ms)`);
  }

  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};
