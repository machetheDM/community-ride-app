import { NextRequest } from "next/server";
import { RateLimitError } from "./errors";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * In-memory fixed-window rate limiter.
 *
 * Deliberately process-local: this is a portfolio/demo deployment with a single
 * instance. Behind more than one instance the limit becomes per-instance, so a
 * shared store (Redis, Upstash) would be required for a real rollout.
 *
 * Expired entries are swept on access rather than on a timer. A module-level
 * setInterval would leak across hot reloads and is not portable to the Edge
 * runtime that Next.js middleware executes in, where timer handles have no
 * .unref().
 */
const store = new Map<string, RateLimitEntry>();

// Bound the map so a flood of unique keys cannot grow it without limit.
const MAX_TRACKED_KEYS = 10_000;

function sweep(now: number): void {
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}

export interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  keyFn?: (req: NextRequest) => string;
}

export function rateLimit(opts: RateLimitOptions = {}) {
  const {
    windowMs = 60_000,
    maxRequests = 60,
    keyFn = (req) =>
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "127.0.0.1",
  } = opts;

  return function check(req: NextRequest): void {
    const key = keyFn(req);
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      if (store.size >= MAX_TRACKED_KEYS) sweep(now);
      store.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }

    entry.count++;
    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      throw new RateLimitError(`Too many requests. Retry after ${retryAfter}s.`);
    }
  };
}

/** Test-only hook: clears accumulated state between cases. */
export function __resetRateLimitStore(): void {
  store.clear();
}

// Pre-configured limiters
export const defaultLimiter = rateLimit({ windowMs: 60_000, maxRequests: 60 });
export const authLimiter = rateLimit({ windowMs: 60_000, maxRequests: 10 });
export const strictLimiter = rateLimit({ windowMs: 60_000, maxRequests: 5 });
