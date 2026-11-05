import { NextRequest, NextResponse } from "next/server";
import { addSecurityHeaders, applyCors, parseAllowedOrigins } from "@/lib/security";
import { defaultLimiter, authLimiter } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
import { logger } from "@/lib/logger";

/**
 * Runs before every `/api` route (Next.js 16 renamed Middleware to Proxy; same
 * mechanism, and it now runs on the Node.js runtime by default).
 *
 * Rate limits by the trusted client address (`lib/client-ip.ts`), security
 * headers, and CORS from an allow-list. It is a first filter only: every route
 * still authenticates and authorises for itself, because a matcher change would
 * otherwise silently remove the check.
 */

const OTP_ROUTES = new Set(["/api/auth/request-otp", "/api/auth/verify-otp"]);

// Read once per process: an origin list does not change without a redeploy.
const allowedOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);

export function proxy(req: NextRequest) {
  const start = Date.now();
  const path = req.nextUrl.pathname;
  const origin = req.headers.get("origin");

  // Answered here, before the limiter, so a browser's preflight never costs the
  // caller one of their requests. Disallowed origins get no allow headers and the
  // browser stops there.
  if (req.method === "OPTIONS") {
    const preflight = new NextResponse(null, { status: 204 });
    addSecurityHeaders(preflight);
    return applyCors(preflight, origin, allowedOrigins);
  }

  try {
    // Counted from the right of X-Forwarded-For: the left-most entry is whatever
    // the caller wrote, and keying on it gave a fresh bucket per request.
    const ip = getClientIp(req);
    if (OTP_ROUTES.has(path)) authLimiter.hit(ip);
    else defaultLimiter.hit(ip);
  } catch {
    const response = NextResponse.json(
      { success: false, error: "Too many requests. Please try again later." },
      { status: 429 }
    );
    addSecurityHeaders(response);
    // CORS on the refusal too, or a browser client sees an opaque network error
    // instead of the 429 it could have backed off from.
    return applyCors(response, origin, allowedOrigins);
  }

  const response = NextResponse.next();
  addSecurityHeaders(response);
  applyCors(response, origin, allowedOrigins);

  const duration = Date.now() - start;
  if (duration > 50) {
    logger.warn(`Slow proxy: ${path} (${duration}ms)`);
  }

  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};
