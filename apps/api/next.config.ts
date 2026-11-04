import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
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
