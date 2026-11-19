import type { NextConfig } from "next";
import path from "node:path";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Headers for the public pages (`/e/{slug}`, the event pages a Facebook post links
 * to). `src/proxy.ts` covers `/api` only, so without this the one part of the API
 * app a stranger opens in a browser would carry no headers at all.
 *
 * The CSP follows the portal's (apps/merchant-portal/next.config.ts): the App
 * Router's inline RSC scripts need `'unsafe-inline'` until a per-request nonce is
 * set (threat model, open item). The page renders no user-supplied markup: titles
 * and descriptions are React text, so they are escaped. `img-src 'self'` because
 * the poster is served from this origin; `form-action 'none'` because booking
 * happens in the app, not on the page.
 */
const publicPageCsp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const publicPageHeaders = [
  { key: "Content-Security-Policy", value: publicPageCsp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/e/:path*", headers: publicPageHeaders }];
  },
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },

  /**
   * Packages that must stay external to the server bundle.
   *
   * The Prisma adapter and `pg` load native bindings. `firebase-admin` and
   * `@google-cloud/bigquery` are dynamically imported and resolve credentials at
   * runtime; bundling them breaks that lookup and inflates the build for
   * deployments that never use either.
   */
  serverExternalPackages: [
    "@prisma/adapter-pg",
    "pg",
    "firebase-admin",
    "@google-cloud/bigquery",
  ],

  /**
   * Standalone output for the Cloud Run image.
   *
   * Produces a self-contained server with only the traced dependencies, rather
   * than requiring the full node_modules tree in the runtime image — a smaller
   * image and a faster cold start, which on a scale-to-zero service is
   * user-visible latency on the first request.
   */
  output: "standalone",

  /**
   * File tracing has to start at the monorepo root.
   *
   * This app imports four workspace packages as raw TypeScript from ../../packages.
   * Left at its default, Next infers the root from the app directory, traces only
   * what it can see beneath it, and silently omits those packages — producing an
   * image that builds cleanly and then crashes on first request with a module
   * resolution error.
   */
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
