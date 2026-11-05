/**
 * The caller's address, as far as it can be trusted.
 *
 * `X-Forwarded-For` is a list each proxy appends to: `<whatever the caller
 * wrote>, <address proxy 1 saw>, <address proxy 2 saw>`. Only the entries our own
 * proxies appended are facts; everything to their left is text the caller chose.
 * The old limiter keyed on the left-most entry, so changing one header gave a
 * fresh rate-limit bucket on every request, which is what made guessing OTPs
 * practical (threat model AU-1).
 *
 * So the address is counted from the right. `TRUST_PROXY_HOPS` says how many
 * proxies in front of the app append an entry:
 *
 * - **1 (the default)**: Cloud Run reached on its own `run.app` URL. Google's front
 *   end appends the address the connection came from, so the right-most entry is
 *   the client. This is how `infra/gcp/cloudrun.tf` deploys the API.
 * - **2**: behind an external Application Load Balancer, which appends the client
 *   and then its own address.
 * - **0**: nothing trusted appends the header, so it is ignored entirely and every
 *   caller shares one bucket. Safe, but it throttles everyone together.
 *
 * Getting the number wrong in the generous direction (too high) hands the key
 * back to the caller, so the default is the smallest that is right on Cloud Run.
 *
 * Locally, `next dev` and `next start` fill the header with the socket address
 * when the request has none (`next/dist/server/base-server.js`), so the default
 * also works on a laptop.
 *
 * No `next/server` import: the merchant portal keeps its own copy of these few
 * lines for its audit rows, and both stay testable without a request object.
 */

const DEFAULT_HOPS = 1;
const MAX_HOPS = 10;

/** An IPv4 or IPv6 literal, loosely. Bounds the key length and rejects junk. */
const IP_LITERAL = /^[0-9A-Fa-f:.]{2,45}$/;

let warnedAboutHops = false;

/** Only `TRUST_PROXY_HOPS` is read; a plain object in tests. */
export type ClientIpEnv = Readonly<Record<string, string | undefined>>;

export function trustedProxyHops(env: ClientIpEnv = process.env): number {
  const raw = env.TRUST_PROXY_HOPS?.trim();
  if (!raw) return DEFAULT_HOPS;
  const hops = Number(raw);
  if (Number.isInteger(hops) && hops >= 0 && hops <= MAX_HOPS) return hops;
  // A typo here must not silently trust the caller's entry, so it falls back to
  // the default rather than to a guess.
  if (!warnedAboutHops) {
    warnedAboutHops = true;
    console.warn(`[client-ip] TRUST_PROXY_HOPS="${raw}" is not an integer from 0 to ${MAX_HOPS}; using ${DEFAULT_HOPS}`);
  }
  return DEFAULT_HOPS;
}

/**
 * The entry `hops` from the right, or null when there is nothing trustworthy.
 *
 * With fewer entries than hops, every entry was appended by a trusted proxy and
 * the left-most is the closest to the client.
 */
export function clientIpFromForwardedFor(header: string | null | undefined, hops: number): string | null {
  if (hops <= 0 || !header) return null;
  const entries = header
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) return null;
  const candidate = entries[Math.max(0, entries.length - hops)];
  return IP_LITERAL.test(candidate) ? candidate : null;
}

/** For anything with request headers: a `NextRequest`, a `Request`, `headers()`. */
export function getClientIp(req: { headers: Pick<Headers, "get"> }, env: ClientIpEnv = process.env): string {
  return clientIpFromForwardedFor(req.headers.get("x-forwarded-for"), trustedProxyHops(env)) ?? "unknown";
}
