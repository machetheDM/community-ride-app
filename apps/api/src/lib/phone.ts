/**
 * Phone-number rules for the API, re-exported from the one definition the API and
 * the merchant portal share (`packages/db/src/phone.ts`). South African mobiles
 * only, normalised to `+27…`.
 */
export { normaliseSaMobile, isSaMobile, maskPhone } from "@ride/db/otp";
