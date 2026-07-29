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
