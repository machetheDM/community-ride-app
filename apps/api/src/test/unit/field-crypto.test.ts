import { describe, it, expect, afterEach } from "@jest/globals";
import {
  decryptField,
  encryptField,
  hashesEqual,
  keyedHash,
  protectIdNumber,
  requireSecret,
} from "@ride/db/crypto";

const env = process.env as Record<string, string | undefined>;

describe("encryptField and decryptField", () => {
  it("round-trips a value", () => {
    expect(decryptField(encryptField("DEMO-ID-0001"))).toBe("DEMO-ID-0001");
  });

  it("encrypts the same value differently each time, so the column reveals no repeats", () => {
    expect(encryptField("same")).not.toBe(encryptField("same"));
  });

  it("refuses a value that was altered after encryption", () => {
    const stored = encryptField("DEMO-ID-0001");
    const [version, iv, tag, ciphertext] = stored.split(".");
    const flipped = ciphertext.startsWith("A") ? `B${ciphertext.slice(1)}` : `A${ciphertext.slice(1)}`;
    expect(() => decryptField([version, iv, tag, flipped].join("."))).toThrow();
  });

  it("refuses a value in an unknown format", () => {
    expect(() => decryptField("plain text")).toThrow("Unrecognised encrypted field format");
  });
});

describe("keyedHash", () => {
  afterEach(() => {
    delete env.OTP_HASH_KEY;
  });

  it("is stable for one key and differs between keys", () => {
    expect(keyedHash("123456", "OTP_HASH_KEY")).toBe(keyedHash("123456", "OTP_HASH_KEY"));
    const before = keyedHash("123456", "OTP_HASH_KEY");
    env.OTP_HASH_KEY = "a-different-key-for-this-test-only-0123456789";
    expect(keyedHash("123456", "OTP_HASH_KEY")).not.toBe(before);
  });

  it("compares digests in constant time and rejects a mismatch", () => {
    const a = keyedHash("123456");
    expect(hashesEqual(a, keyedHash("123456"))).toBe(true);
    expect(hashesEqual(a, keyedHash("654321"))).toBe(false);
    expect(hashesEqual(a, "")).toBe(false);
  });
});

describe("protectIdNumber", () => {
  it("keeps only the last four characters readable", () => {
    const stored = protectIdNumber("DEMO DRIVER ID 0001");
    expect(stored.idNumberLast4).toBe("0001");
    expect(stored.idNumberEnc).not.toContain("DRIVER");
    expect(decryptField(stored.idNumberEnc)).toBe("DEMODRIVERID0001");
  });

  it("gives equal numbers equal hashes, so a duplicate registration can be refused", () => {
    expect(protectIdNumber("DEMO-1").idNumberHash).toBe(protectIdNumber("DEMO-1").idNumberHash);
  });
});

describe("requireSecret", () => {
  const original = env.NODE_ENV;
  afterEach(() => {
    env.NODE_ENV = original;
    delete env.FIELD_ENCRYPTION_KEY;
  });

  it("falls back to a development value outside production", () => {
    env.NODE_ENV = "test";
    expect(requireSecret("FIELD_ENCRYPTION_KEY")).toMatch(/^dev-only-/);
  });

  it("refuses to run in production with the secret missing", () => {
    env.NODE_ENV = "production";
    expect(() => requireSecret("FIELD_ENCRYPTION_KEY")).toThrow("is not set");
  });

  it("refuses the published development fallback in production", () => {
    env.NODE_ENV = "production";
    env.FIELD_ENCRYPTION_KEY = "dev-only-field_encryption_key-change-in-production";
    expect(() => requireSecret("FIELD_ENCRYPTION_KEY")).toThrow("published development fallback");
  });

  it("refuses a short secret in production", () => {
    env.NODE_ENV = "production";
    env.FIELD_ENCRYPTION_KEY = "too-short";
    expect(() => requireSecret("FIELD_ENCRYPTION_KEY")).toThrow("shorter than 32");
  });
});
