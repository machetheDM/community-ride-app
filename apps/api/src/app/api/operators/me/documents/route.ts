import { NextRequest } from "next/server";
import { recordAuditStrict } from "@ride/db";
import { encryptField } from "@ride/db/crypto";
import { REQUIRED_OPERATOR_DOCUMENTS, missingDocuments } from "@ride/db/trips";
import { prisma } from "@/lib/prisma";
import { requireViewer } from "@/lib/actor";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { operatorDocumentSchema, parseBody } from "@/lib/validate";

const documentView = {
  kind: true,
  referenceLast4: true,
  expiresOn: true,
  status: true,
  note: true,
  verifiedAt: true,
  updatedAt: true,
} as const;

/**
 * An operator's documents (PLAN.md 3.7): driving permit, operating licence,
 * vehicle licence and insurance. The number is stored encrypted and only its
 * last four characters come back (AGENTS.md non-negotiable 6).
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const viewer = await requireViewer(req, "DRIVER");
  const documents = await prisma.operatorDocument.findMany({ where: { userId: viewer.userId }, select: documentView });
  return ok({
    required: REQUIRED_OPERATOR_DOCUMENTS,
    missing: missingDocuments(documents),
    documents,
  });
});

/**
 * Adds or replaces one document. Whatever the operator sends is PENDING until an
 * admin checks it in the portal: a replaced document is checked again, even if
 * the old one was verified, because nothing approves itself.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const viewer = await requireViewer(req, "DRIVER");
  const body = await parseBody(req, operatorDocumentSchema);
  const reference = body.reference.replace(/\s+/g, "").toUpperCase();
  const fields = {
    referenceEnc: encryptField(reference),
    referenceLast4: reference.slice(-4),
    expiresOn: body.expiresOn ?? null,
    status: "PENDING" as const,
    note: null,
    verifiedById: null,
    verifiedAt: null,
  };

  const saved = await prisma.$transaction(async (tx) => {
    const doc = await tx.operatorDocument.upsert({
      where: { userId_kind: { userId: viewer.userId, kind: body.kind } },
      create: { userId: viewer.userId, kind: body.kind, ...fields },
      update: fields,
      select: documentView,
    });
    await recordAuditStrict(tx, {
      actorUserId: viewer.userId,
      actorRole: viewer.role,
      action: "operator_document.submit",
      entityType: "OperatorDocument",
      entityId: `${viewer.userId}:${body.kind}`,
      detail: { kind: body.kind, last4: fields.referenceLast4 },
    });
    return doc;
  });
  return ok(saved);
});
