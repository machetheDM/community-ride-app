import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Content-Security-Policy for the portal, set without nonces (the "Without Nonces"
 * pattern in Next 16's CSP guide, node_modules/next/dist/docs/01-app/02-guides/
 * content-security-policy.md).
 *
 * `script-src` needs `'unsafe-inline'`: the App Router streams its RSC payload as
 * inline `<script>` tags, and without it the page renders but never hydrates, so
 * the sign-in form and the order buttons do nothing. The nonce alternative needs a
 * proxy generating one per request and is the next step if the portal ever renders
 * third-party or user-supplied markup. What this policy still buys: no script,
 * frame, form target or base URL from any other origin, no plugins, and no framing.
 * `'unsafe-eval'` is added in development only, where React uses eval to rebuild
 * server error stacks.
 *
 * `img-src` allows any HTTPS host because avatars come from arbitrary hosts
 * (`components/ui/Avatar.tsx`); an image cannot run script. There is no
 * `upgrade-insecure-requests`: every other resource is same-origin, and HSTS
 * already keeps the origin on HTTPS.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * The portal sent no security headers at all (threat model PA-6): it could be
 * framed to trick a merchant into clicking an order button, and nothing told the
 * browser to insist on HTTPS. Applied to every path, including the Server Action
 * POSTs, which are requests to the page's own URL.
 */
const securityHeaders = [
  // Two years, the preload list's minimum. Browsers ignore it over plain HTTP,
  // so `next start` on localhost is unaffected.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // frame-ancestors in the CSP is the modern control; this covers older browsers.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**.supabase.co" }],
  },
  serverExternalPackages: ["@prisma/client"],
  // Says which framework served the page, and nothing a merchant needs.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
