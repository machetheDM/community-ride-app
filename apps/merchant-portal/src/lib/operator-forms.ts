/**
 * Pure parsers for the operator admin forms (docs/PLAN.md Phase 3.7 and 3.8):
 * reviewing a document, recording a payment, and an adjustment. No database
 * import, so each is unit-tested on its own.
 */

import type { FormResult } from "./event-forms";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A rand amount with at most two decimals, up to R100 000. */
const RANDS = /^\d{1,6}(\.\d{1,2})?$/;
const MAX_RANDS = 100_000;

/**
 * A key the form carries so a double-submitted payment is recorded once: it is
 * the ledger row's sourceId, and the ledger is unique on (kind, sourceType,
 * sourceId).
 */
const ENTRY_KEY = /^[0-9a-f-]{36}$/;

export interface DocumentReviewInput {
  documentId: string;
  decision: "VERIFIED" | "REJECTED";
  note: string | null;
}

export function parseDocumentReview(input: Record<string, unknown>): FormResult<DocumentReviewInput> {
  const errors: Record<string, string> = {};
  const documentId = text(input.documentId);
  if (!documentId || documentId.length > 64) errors.documentId = "Which document?";
  const decision = text(input.decision);
  if (decision !== "VERIFIED" && decision !== "REJECTED") errors.decision = "Verify or reject";
  const note = text(input.note).slice(0, 200) || null;
  // A rejection the operator cannot act on is a dead end; say what is wrong.
  if (decision === "REJECTED" && !note) errors.note = "Say why, so the operator can fix it";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { documentId, decision: decision as DocumentReviewInput["decision"], note } };
}

export interface LedgerEntryInput {
  operatorUserId: string;
  amount: string;
  note: string;
  entryKey: string;
}

/** A payment from an operator towards what they owe: positive, with a reference. */
export function parsePaymentForm(input: Record<string, unknown>): FormResult<LedgerEntryInput> {
  const errors: Record<string, string> = {};
  const operatorUserId = text(input.operatorUserId);
  if (!operatorUserId || operatorUserId.length > 64) errors.operatorUserId = "Which operator?";
  const amount = text(input.amount);
  if (!RANDS.test(amount) || Number(amount) <= 0 || Number(amount) > MAX_RANDS) errors.amount = "An amount in rands, more than 0";
  const note = text(input.note).slice(0, 200);
  if (!note) errors.note = "How it was paid: the EFT reference or 'cash, receipt 12'";
  const entryKey = text(input.entryKey);
  if (!ENTRY_KEY.test(entryKey)) errors.entryKey = "Reload the page and try again";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { operatorUserId, amount: Number(amount).toFixed(2), note, entryKey } };
}

/**
 * A correction, signed: positive adds to what the operator owes, negative takes
 * away. Always with a reason, because a balance nobody can explain is the thing
 * a ledger of events exists to prevent.
 */
export function parseAdjustmentForm(input: Record<string, unknown>): FormResult<LedgerEntryInput> {
  const errors: Record<string, string> = {};
  const operatorUserId = text(input.operatorUserId);
  if (!operatorUserId || operatorUserId.length > 64) errors.operatorUserId = "Which operator?";
  const raw = text(input.amount);
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  if (!RANDS.test(digits) || Number(digits) === 0 || Number(digits) > MAX_RANDS) {
    errors.amount = "An amount in rands, not 0; negative to reduce what is owed";
  }
  const note = text(input.note).slice(0, 200);
  if (note.length < 5) errors.note = "Say why the balance is being corrected";
  const entryKey = text(input.entryKey);
  if (!ENTRY_KEY.test(entryKey)) errors.entryKey = "Reload the page and try again";
  if (Object.keys(errors).length) return { ok: false, errors };
  const amount = (negative ? -1 : 1) * Number(digits);
  return { ok: true, value: { operatorUserId, amount: amount.toFixed(2), note, entryKey } };
}
