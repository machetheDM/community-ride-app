import { describe, it, expect } from "@jest/globals";
import {
  parseAdjustmentForm,
  parseDocumentReview,
  parsePaymentForm,
} from "../../../../merchant-portal/src/lib/operator-forms";

/** The admin's operator forms (PLAN.md 3.7, 3.8), tested here because the portal has no test runner. */

const KEY = "3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f";

describe("document review", () => {
  it("verifies without a note", () => {
    expect(parseDocumentReview({ documentId: "doc1", decision: "VERIFIED" })).toEqual({
      ok: true,
      value: { documentId: "doc1", decision: "VERIFIED", note: null },
    });
  });

  it("will not reject without saying why", () => {
    const result = parseDocumentReview({ documentId: "doc1", decision: "REJECTED", note: " " });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.note).toBeTruthy();
  });

  it("refuses any decision but verify or reject (no way back to pending from the form)", () => {
    expect(parseDocumentReview({ documentId: "doc1", decision: "PENDING" }).ok).toBe(false);
  });
});

describe("payments", () => {
  it("takes a positive amount with a reference and the form's key", () => {
    expect(parsePaymentForm({ operatorUserId: "u1", amount: "150.5", note: "EFT 123", entryKey: KEY })).toEqual({
      ok: true,
      value: { operatorUserId: "u1", amount: "150.50", note: "EFT 123", entryKey: KEY },
    });
  });

  it("refuses zero, negative, three decimals, no reference and a missing key", () => {
    for (const amount of ["0", "-10", "10.123", "abc"]) {
      expect(parsePaymentForm({ operatorUserId: "u1", amount, note: "x", entryKey: KEY }).ok).toBe(false);
    }
    expect(parsePaymentForm({ operatorUserId: "u1", amount: "10", note: "", entryKey: KEY }).ok).toBe(false);
    expect(parsePaymentForm({ operatorUserId: "u1", amount: "10", note: "cash", entryKey: "" }).ok).toBe(false);
  });
});

describe("adjustments", () => {
  it("keeps the sign: negative reduces what is owed", () => {
    const result = parseAdjustmentForm({ operatorUserId: "u1", amount: "-25", note: "Fare disputed, refunded", entryKey: KEY });
    expect(result.ok && result.value.amount).toBe("-25.00");
  });

  it("refuses zero and a reason too short to explain anything", () => {
    expect(parseAdjustmentForm({ operatorUserId: "u1", amount: "0", note: "Correction", entryKey: KEY }).ok).toBe(false);
    expect(parseAdjustmentForm({ operatorUserId: "u1", amount: "5", note: "oops", entryKey: KEY }).ok).toBe(false);
  });
});
