import { NextRequest } from "next/server";
import { RateLimitError } from "./errors";
import { getClientIp } from "./client-ip";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * In-memory fixed-window rate limiter.
 *
 * Deliberately process-local: this is a portfolio/demo deployment with a single
 * instance. Behind more than one instance the limit becomes per-instance, so a
 * shared store (Redis, Upstash) would be required for a real rollout. The limits
 * that guard sign-in do not depend on it: the OTP send cap and lockout are counted
 * in the database (`packages/db/src/otp.ts`), so they hold across instances and
 * restarts. This limiter only sheds load before a request reaches them.
 *
 * Each limiter has its own store. They used to share one map keyed by address, so
 * sixty ordinary requests used up the sign-in allowance too, and the limits were
 * applied to one another's counts.
 *
 * Expired entries are swept on access rather than on a timer. A module-level
 * setInterval would leak across hot reloads, and the proxy runs in its own bundle
 * where a timer has nobody to clear it.
 */

/**
 * The most keys one limiter tracks. When it is full, the oldest windows go first.
 *
 * The old sweep dropped only expired keys, so a flood of fresh keys (one per
 * spoofed address) grew the map for a whole window (threat model IN-12). Every
 * entry in a store shares one window length, and a key is re-inserted when its
 * window restarts, so the map's insertion order is also expiry order: the oldest
 * entry is the one nearest to expiring anyway, and evicting from the front costs
 * nothing to find. The cost of eviction is that a flooded limiter forgets its
 * oldest callers early; the trusted client address (`client-ip.ts`) is what keeps
 * an attacker from producing that flood in the first place.
 */
export const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  keyFn?: (req: NextRequest) => string;
  /** Defaults to MAX_TRACKED_KEYS; smaller in tests. */
  maxKeys?: number;
}

export interface Limiter {
  /** Counts one request against the caller's address (or `keyFn`). Throws RateLimitError over the limit. */
  (req: NextRequest): void;
  /** Counts one request against an explicit key, such as a phone number. */
  hit(key: string): void;
  /** How many keys are tracked now; for tests and diagnostics. */
  size(): number;
}

const allStores = new Set<Map<string, RateLimitEntry>>();

export function rateLimit(opts: RateLimitOptions = {}): Limiter {
  const { windowMs = 60_000, maxRequests = 60, keyFn = (req) => getClientIp(req), maxKeys = MAX_TRACKED_KEYS } = opts;
  const store = new Map<string, RateLimitEntry>();
  allStores.add(store);

  function makeRoom(now: number): void {
    for (const [key, entry] of store) {
      if (store.size < maxKeys && entry.resetAt > now) return;
      store.delete(key);
    }
  }

  function hit(key: string): void {
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      // Delete before set so the key moves to the end: insertion order stays
      // expiry order, which is what makes evicting from the front correct.
      store.delete(key);
      makeRoom(now);
      store.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }

    entry.count++;
    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      throw new RateLimitError(`Too many requests. Retry after ${retryAfter}s.`);
    }
  }

  const check = ((req: NextRequest) => hit(keyFn(req))) as Limiter;
  check.hit = hit;
  check.size = () => store.size;
  return check;
}

/** Test-only hook: clears accumulated state between cases. */
export function __resetRateLimitStore(): void {
  for (const store of allStores) store.clear();
}

// Pre-configured limiters
export const defaultLimiter = rateLimit({ windowMs: 60_000, maxRequests: 60 });
export const authLimiter = rateLimit({ windowMs: 60_000, maxRequests: 10 });
export const strictLimiter = rateLimit({ windowMs: 60_000, maxRequests: 5 });

/**
 * Sign-in limits keyed by phone number rather than by address.
 *
 * The address limit stops one caller hammering many phones; these stop many
 * callers (a botnet, or one caller whose address the front end cannot see)
 * hammering one phone. They sit above the database caps in `@ride/db/otp`, three
 * sends in fifteen minutes and a lockout at ten wrong guesses, so a person who
 * mistypes is stopped by those, with their clearer messages, and these only absorb
 * bursts that would otherwise race the database counts.
 */
export const otpSendPhoneLimiter = rateLimit({ windowMs: 15 * 60_000, maxRequests: 5 });
export const otpVerifyPhoneLimiter = rateLimit({ windowMs: 15 * 60_000, maxRequests: 15 });

/**
 * Limiters for the Google Maps proxy routes.
 *
 * These exist for cost, not abuse: each call through them consumes billable Maps
 * quota, so an unbounded proxy would let one client spend real money. The ceilings
 * are set well above what booking a ride needs and well below what a runaway loop
 * or a scraped token could burn.
 *
 * Autocomplete is looser because typing an address legitimately fires a request per
 * keystroke — and it is the one Maps SKU that stays free at any volume, provided
 * the session token is used, so the cost pressure there is much lower.
 */
export const mapsLimiter = rateLimit({ windowMs: 60_000, maxRequests: 20 });
export const autocompleteLimiter = rateLimit({ windowMs: 60_000, maxRequests: 100 });
