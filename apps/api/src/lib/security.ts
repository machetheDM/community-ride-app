import { NextResponse } from "next/server";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

export function addSecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

// ── CORS ────────────────────────────────────────────────────────────────────

/**
 * Browser origins allowed to read API responses, from `CORS_ALLOWED_ORIGINS`
 * (comma-separated, exact origins such as `https://portal.example.co.za`).
 *
 * This replaces `Access-Control-Allow-Origin: *` (threat model IN-10). The wildcard
 * cost little while every caller used a bearer token, but it would let any website
 * read responses the moment a cookie session or a browser client exists.
 *
 * The Expo apps are unaffected by the list: CORS is enforced by browsers, and a
 * native app's requests carry no `Origin` header, so there is nothing to allow.
 * Unset means no browser origin is allowed, which is right today, when no browser
 * client calls the API (the portal reads the database directly).
 *
 * `*` is refused rather than honoured: a wildcard in this variable would quietly
 * undo the fix it exists for.
 */
export function parseAllowedOrigins(raw: string | undefined): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const value = part.trim();
    if (!value || value === "*") continue;
    try {
      const url = new URL(value);
      if (url.protocol === "https:" || url.protocol === "http:") origins.add(url.origin);
    } catch {
      // Not a URL: ignored rather than guessed at.
    }
  }
  return origins;
}

const CORS_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const CORS_HEADERS = "Content-Type, Authorization";

/**
 * Sets the CORS headers for one response. An origin not on the list gets no
 * `Access-Control-Allow-Origin` at all, so the browser refuses to hand the
 * response to the page. `Vary: Origin` is always set, because the response now
 * depends on the header and a shared cache must not serve one origin's answer to
 * another.
 */
export function applyCors(response: NextResponse, origin: string | null, allowed: ReadonlySet<string>): NextResponse {
  response.headers.append("Vary", "Origin");
  if (origin && allowed.has(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", CORS_METHODS);
    response.headers.set("Access-Control-Allow-Headers", CORS_HEADERS);
    response.headers.set("Access-Control-Max-Age", "600");
  }
  return response;
}

// ── Input ───────────────────────────────────────────────────────────────────

export function sanitizeInput(input: string): string {
  return input
    .replace(/<[^>]*>/g, "")       // strip HTML tags
    .replace(/[<>]/g, "")           // strip angle brackets
    .trim();
}

export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  // Built as a loose record and cast once on return: TypeScript will not allow
  // writing through an index into a value of unresolved generic type T.
  const sanitized: Record<string, unknown> = { ...obj };
  for (const [key, value] of Object.entries(sanitized)) {
    if (typeof value === "string") sanitized[key] = sanitizeInput(value);
  }
  return sanitized as T;
}
