/**
 * Phone numbers the platform will send a sign-in code to.
 *
 * South African mobiles only for now: `+27` followed by 6, 7 or 8 and eight more
 * digits. The restriction is the cheapest defence against SMS toll fraud, where
 * an attacker requests codes to premium-rate foreign numbers and the platform
 * pays for every message (threat model AU-3). Widening it is a product decision,
 * and when it happens the SMS provider's geo-permissions must widen with it.
 *
 * Pure string handling with no imports, so the API and the portal share exactly
 * one definition of a valid number.
 */

const SA_MOBILE = /^\+27[678]\d{8}$/;

/**
 * Normalises how people actually type a number (`082 123 4567`, `27821234567`,
 * `+27 (82) 123-4567`, `0027821234567`) to E.164, `+27821234567`.
 *
 * Returns null for anything that is not a South African mobile, rather than a
 * best guess. The old normaliser prefixed whatever digits it was given with `+`,
 * so any country code passed.
 */
export function normaliseSaMobile(input: string): string | null {
  const compact = input.trim().replace(/[\s\-().]/g, "");
  let candidate = compact;
  if (/^0[678]\d{8}$/.test(compact)) candidate = `+27${compact.slice(1)}`;
  else if (/^27[678]\d{8}$/.test(compact)) candidate = `+${compact}`;
  else if (/^0027[678]\d{8}$/.test(compact)) candidate = `+${compact.slice(2)}`;
  return SA_MOBILE.test(candidate) ? candidate : null;
}

/** True only for an already-normalised number (`+27821234567`). */
export function isSaMobile(phone: string): boolean {
  return SA_MOBILE.test(phone);
}

/**
 * A number safe to write to a log or an audit row: the country code and the last
 * two digits, enough to tell two numbers apart in a support conversation and too
 * little to call anyone.
 */
export function maskPhone(phone: string): string {
  if (phone.length < 6) return "***";
  return `${phone.slice(0, 3)}${"*".repeat(phone.length - 5)}${phone.slice(-2)}`;
}
