"use server";

import { revalidatePath } from "next/cache";
import { recordAuditStrict } from "@ride/db";
import { prisma } from "./prisma";
import { sessionFor } from "./session";
import { requestIp } from "./audit";
import type { FormState } from "./event-actions";
import { parseAdjustmentForm, parseDocumentReview, parsePaymentForm, type LedgerEntryInput } from "./operator-forms";

/**
 * The admin's actions on operators (docs/PLAN.md Phase 3.7, 3.8): checking
 * their documents, and recording what they paid. Each re-checks the admin
 * session and writes its audit row in the same transaction as the change.
 */

/**
 * Verifies or rejects a PENDING document. Conditional on it still being
 * PENDING, so two admins reviewing at once cannot both decide, and an admin
 * cannot verify their own document: nothing approves itself.
 */
export async function reviewDocument(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await sessionFor("admin");
  if (!session) return { error: "Not authenticated" };
  const parsed = parseDocumentReview(Object.fromEntries(formData));
  if (!parsed.ok) return { errors: parsed.errors };
  const { documentId, decision, note } = parsed.value;

  const doc = await prisma.operatorDocument.findUnique({ where: { id: documentId }, select: { userId: true, kind: true } });
  if (!doc) return { error: "That document no longer exists" };
  if (doc.userId === session.userId) return { error: "You cannot review your own document" };

  const ip = await requestIp();
  const done = await prisma.$transaction(async (tx) => {
    const written = await tx.operatorDocument.updateMany({
      where: { id: documentId, status: "PENDING" },
      data: { status: decision, note, verifiedById: session.userId, verifiedAt: new Date() },
    });
    if (written.count !== 1) return false;
    await recordAuditStrict(tx, {
      actorUserId: session.userId,
      actorRole: session.role,
      action: decision === "VERIFIED" ? "operator_document.verify" : "operator_document.reject",
      entityType: "OperatorDocument",
      entityId: documentId,
      ip,
      detail: { channel: "portal", operatorUserId: doc.userId, kind: doc.kind, ...(note ? { note } : {}) },
    });
    return true;
  });
  if (!done) return { error: "Someone has already reviewed this document" };
  revalidatePath("/dashboard/operators");
  return { ok: true, id: documentId };
}

async function recordEntry(kind: "FEE_PAID" | "ADJUSTMENT", sourceType: "PAYMENT" | "MANUAL", entry: LedgerEntryInput): Promise<FormState> {
  const session = await sessionFor("admin");
  if (!session) return { error: "Not authenticated" };

  const operator = await prisma.user.findUnique({ where: { id: entry.operatorUserId }, select: { role: true } });
  if (!operator || (operator.role !== "DRIVER" && operator.role !== "RIDER")) return { error: "Not an operator" };
  if (entry.operatorUserId === session.userId) return { error: "You cannot record money against your own account" };

  const ip = await requestIp();
  try {
    const id = await prisma.$transaction(async (tx) => {
      const row = await tx.ledgerEntry.create({
        data: {
          operatorUserId: entry.operatorUserId,
          kind,
          amount: entry.amount,
          sourceType,
          sourceId: entry.entryKey,
          note: entry.note,
          recordedById: session.userId,
        },
      });
      await recordAuditStrict(tx, {
        actorUserId: session.userId,
        actorRole: session.role,
        action: kind === "FEE_PAID" ? "ledger.payment" : "ledger.adjustment",
        entityType: "LedgerEntry",
        entityId: row.id,
        ip,
        detail: { channel: "portal", operatorUserId: entry.operatorUserId, amount: entry.amount },
      });
      return row.id;
    });
    revalidatePath("/dashboard/operators");
    return { ok: true, id };
  } catch (error) {
    // The same form submitted twice carries the same key: recorded once.
    if ((error as { code?: string }).code === "P2002") return { ok: true };
    throw error;
  }
}

export async function recordPayment(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parsePaymentForm(Object.fromEntries(formData));
  if (!parsed.ok) return { errors: parsed.errors };
  return recordEntry("FEE_PAID", "PAYMENT", parsed.value);
}

export async function recordAdjustment(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseAdjustmentForm(Object.fromEntries(formData));
  if (!parsed.ok) return { errors: parsed.errors };
  return recordEntry("ADJUSTMENT", "MANUAL", parsed.value);
}
