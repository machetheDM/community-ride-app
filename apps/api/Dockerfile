# syntax=docker/dockerfile:1
#
# Production image for the API, targeting Cloud Run.
#
# Built from the REPOSITORY ROOT, not from apps/api — the app imports four
# workspace packages (@ride/db, @ride/maps-service, @ride/push-service,
# @ride/analytics) as raw TypeScript, so the build context has to include them:
#
#   docker build -f apps/api/Dockerfile -t community-ride-api .
#
# Multi-stage so the runtime image carries neither the toolchain nor the full
# node_modules tree — Next's standalone output traces only the files actually
# reachable, which on Cloud Run means a smaller image and a faster cold start.

# ─── deps ─────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /repo

# Only the manifests, so this layer is cached until a dependency actually
# changes. Copying source first would invalidate it on every edit.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/merchant-portal/package.json ./apps/merchant-portal/
COPY apps/customer-app/package.json ./apps/customer-app/
COPY apps/driver-app/package.json ./apps/driver-app/
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/
COPY packages/maps-service/package.json ./packages/maps-service/
COPY packages/push-service/package.json ./packages/push-service/
COPY packages/analytics/package.json ./packages/analytics/

# `npm ci` rather than `install`: the lockfile is the contract, and a resolution
# that drifts between local and image is exactly the class of bug that only shows
# up in deployment.
RUN npm ci

# ─── build ────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY . .

# The Prisma client is generated code and is not in the image otherwise.
RUN npx prisma generate --schema=packages/db/prisma/schema.prisma

# Next reads env at build time for anything inlined. Nothing secret belongs here
# — these exist only so the build can complete. Real values arrive at runtime
# from Secret Manager, and DATABASE_URL is deliberately unreachable so a page
# that tries to query at build time fails here rather than shipping frozen data.
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:59999/build"
ENV DIRECT_URL="postgresql://build:build@127.0.0.1:59999/build"
ENV JWT_SECRET="build-time-only-never-used-at-runtime"

RUN npm run build --workspace @ride/api

# ─── runtime ──────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Non-root. Cloud Run does not require it, but a container that cannot write to
# its own filesystem or escalate is the cheapest hardening available.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Next's standalone output already contains a traced node_modules and a server.js.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/api/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/api/.next/static ./apps/api/.next/static

USER nextjs

# Cloud Run injects PORT and expects the container to honour it rather than
# hardcode 8080. HOSTNAME must be 0.0.0.0 — Next binds localhost by default,
# which fails the health check with no useful error.
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
EXPOSE 8080

# Node, not curl or wget: neither is present in node:20-alpine, and a probe that
# exits -1 because the binary is missing looks exactly like an unhealthy service.
# This exact mistake made every service in the compose stack permanently
# unhealthy in a sibling project.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Standalone output preserves the workspace layout, so server.js sits under the
# app's path rather than at the root.
CMD ["node", "apps/api/server.js"]
