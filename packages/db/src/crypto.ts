import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Secrets and field-level encryption, shared by the API and the portal.
 *
 * Pure node:crypto with no database import, so it can be loaded from a test or a
 * script without a connection string (`@ride/db/crypto`).
 */

/**
 * Reads a server secret, failing closed in production.
 *
 * Outside production a missing secret falls back to a value derived from its name.
 * That fallback is published in this repository, so it is refused in production
 * even when someone sets it explicitly — the same rule `apps/api/src/lib/auth.ts`
 * applies to the JWT secret.
 */
export function requireSecret(name: string): string {
  const value = process.env[name];
  const devFallback = `dev-only-${name.toLowerCase()}-change-in-production`;
  const isProduction = process.env.NODE_ENV === "production";

  if (value && value.length > 0) {
    if (isProduction && value === devFallback) {
      throw new Error(`${name} is set to the published development fallback. Refusing to run in production.`);
    }
    if (isProduction && value.length < 32) {
      throw new Error(`${name} is shorter than 32 characters. Refusing to run in production.`);
    }
    return value;
  }
  if (isProduction) {
    throw new Error(`${name} is not set. Refusing to run in production.`);
  }
  return devFallback;
}

/** A 32-byte key derived from a named secret, so any length of secret works. */
function keyFrom(secretName: string): Buffer {
  return createHash("sha256").update(requireSecret(secretName)).digest();
}

/**
 * Keyed hash (HMAC-SHA256, hex) of a value.
 *
 * Used where equality must be checkable but the value must not be readable: a
 * blind index for an encrypted ID number, or a one-time password. Keyed because the
 * inputs are guessable — a 13-digit ID number or a 6-digit code — and an unkeyed
 * hash of a guessable value is reversed by trying them all.
 */
export function keyedHash(value: string, secretName = "BLIND_INDEX_KEY"): string {
  return createHmac("sha256", keyFrom(secretName)).update(value).digest("hex");
}

/** Constant-time comparison of two hex digests of equal length. */
export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

const FORMAT_VERSION = "v1";

/**
 * Encrypts a field with AES-256-GCM.
 *
 * Output is `v1.<iv>.<tag>.<ciphertext>`, base64url. A fresh random IV per value
 * means two equal inputs encrypt differently — which is why uniqueness is enforced
 * on the keyed hash, not on this column. The version prefix lets the key or the
 * algorithm change later without guessing what an old row holds.
 */
export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom("FIELD_ENCRYPTION_KEY"), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT_VERSION, iv, tag, ciphertext].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

/** Decrypts a value from `encryptField`. Throws if it was altered or the key is wrong. */
export function decryptField(stored: string): string {
  const [version, iv, tag, ciphertext] = stored.split(".");
  if (version !== FORMAT_VERSION || !iv || !tag || ciphertext === undefined) {
    throw new Error("Unrecognised encrypted field format");
  }
  const decipher = createDecipheriv("aes-256-gcm", keyFrom("FIELD_ENCRYPTION_KEY"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

/**
 * Everything stored for an identity number: ciphertext, blind index, and the last
 * four characters — the only part a screen ever shows.
 */
export function protectIdNumber(idNumber: string): {
  idNumberEnc: string;
  idNumberHash: string;
  idNumberLast4: string;
} {
  const normalised = idNumber.replace(/\s+/g, "");
  return {
    idNumberEnc: encryptField(normalised),
    idNumberHash: keyedHash(normalised),
    idNumberLast4: normalised.slice(-4),
  };
}
