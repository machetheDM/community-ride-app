/**
 * The caller's address for the portal's audit rows.
 *
 * The same rule as the API's `apps/api/src/lib/client-ip.ts`, kept as a copy of a
 * few lines because one app importing another's source would tie their builds
 * together: count `TRUST_PROXY_HOPS` entries (default 1, Cloud Run's front end)
 * from the right of `X-Forwarded-For`, because everything to the left is text the
 * caller wrote. A changed rule must change in both files; the API suite tests
 * this copy too.
 */

const IP_LITERAL = /^[0-9A-Fa-f:.]{2,45}$/;

export function clientIpFrom(forwardedFor: string | null | undefined, hopsSetting: string | undefined): string {
  const raw = hopsSetting?.trim();
  const parsed = raw ? Number(raw) : 1;
  const hops = Number.isInteger(parsed) && parsed >= 0 && parsed <= 10 ? parsed : 1;
  if (hops === 0 || !forwardedFor) return "unknown";
  const entries = forwardedFor
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) return "unknown";
  const candidate = entries[Math.max(0, entries.length - hops)];
  return IP_LITERAL.test(candidate) ? candidate : "unknown";
}
