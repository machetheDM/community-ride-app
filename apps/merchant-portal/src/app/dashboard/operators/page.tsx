import { randomUUID } from "node:crypto";
import { BadgeCheck, FileText, Wallet } from "lucide-react";
import { OWED_LIMIT_RANDS, REQUIRED_OPERATOR_DOCUMENTS, missingDocuments, owedBalance } from "@ride/db/trips";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { auditAdminRead } from "@/lib/audit";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ActionForm } from "@/components/ActionForm";
import { recordAdjustment, recordPayment, reviewDocument } from "@/lib/operator-actions";

export const metadata = { title: "Operators" };
export const dynamic = "force-dynamic";

const DOCUMENT_LABELS: Record<string, string> = {
  DRIVING_PERMIT: "Driving permit",
  OPERATING_LICENCE: "Operating licence",
  VEHICLE_LICENCE: "Vehicle licence",
  INSURANCE: "Insurance",
};

const rands = (n: number) => `R${n.toFixed(2)}`;

/**
 * Operators: the documents an admin checks before a driver sees group trips
 * (PLAN.md 3.7), and each operator's fee statement, with payments recorded
 * against it (3.8). What an operator owes is derived from their ledger rows on
 * every load; no balance is stored. ADMIN only, and the view is audited: this
 * page holds people's names and what they owe.
 */
export default async function OperatorsPage() {
  const session = await requireAdmin();

  const operators = await prisma.user.findMany({
    where: { role: { in: ["DRIVER", "RIDER"] } },
    orderBy: { name: "asc" },
    take: 200,
    select: {
      id: true,
      name: true,
      role: true,
      operatorDocuments: {
        select: { id: true, kind: true, referenceLast4: true, expiresOn: true, status: true, note: true, updatedAt: true },
      },
      ledgerEntries: {
        select: { id: true, kind: true, amount: true, sourceType: true, note: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  await auditAdminRead(session, "Operator", operators.length);

  const rows = operators.map((o) => ({
    ...o,
    owed: owedBalance(o.ledgerEntries),
    missing: o.role === "DRIVER" ? missingDocuments(o.operatorDocuments) : [],
    pending: o.operatorDocuments.filter((d) => d.status === "PENDING"),
  }));
  const waiting = rows.reduce((sum, o) => sum + o.pending.length, 0);
  const totalOwed = rows.reduce((sum, o) => sum + Math.max(0, o.owed), 0);

  return (
    <div className="p-8 space-y-8">
      <PageHeader
        title="Operators"
        subtitle={`${waiting} document${waiting === 1 ? "" : "s"} waiting for a check · ${rands(totalOwed)} owed in fees · paused above ${rands(OWED_LIMIT_RANDS)}`}
      />

      {rows.length === 0 && <EmptyState title="No operators yet" description="Drivers and scooter riders appear here once they sign up." />}

      {rows.map((o) => (
        <Card key={o.id}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-slate-100 font-semibold">{o.name ?? "Unnamed"}</p>
              <p className="text-slate-500 text-xs">{o.role === "DRIVER" ? "Driver" : "Scooter rider"}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {o.role === "DRIVER" &&
                (o.missing.length === 0 ? (
                  <Badge variant="success">Cleared for group trips</Badge>
                ) : (
                  <Badge variant="warning">{o.missing.length} document{o.missing.length === 1 ? "" : "s"} outstanding</Badge>
                ))}
              <Badge variant={o.owed > OWED_LIMIT_RANDS ? "danger" : o.owed > 0 ? "info" : "neutral"}>
                Owes {rands(o.owed)}
                {o.owed > OWED_LIMIT_RANDS ? " · paused" : ""}
              </Badge>
            </div>
          </div>

          {o.role === "DRIVER" && (
            <div className="mt-5">
              <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-2">
                <FileText size={14} /> Documents
              </h3>
              <ul className="space-y-3">
                {REQUIRED_OPERATOR_DOCUMENTS.map((kind) => {
                  const doc = o.operatorDocuments.find((d) => d.kind === kind);
                  return (
                    <li key={kind} className="flex items-start justify-between gap-4 flex-wrap border-b border-slate-800 pb-3">
                      <div>
                        <p className="text-slate-200 text-sm">{DOCUMENT_LABELS[kind]}</p>
                        <p className="text-slate-500 text-xs">
                          {doc
                            ? `ending ${doc.referenceLast4}${doc.expiresOn ? ` · expires ${doc.expiresOn.toISOString().slice(0, 10)}` : ""}`
                            : "Not sent yet"}
                          {doc?.note ? ` · ${doc.note}` : ""}
                        </p>
                      </div>
                      {doc?.status === "PENDING" ? (
                        <ActionForm
                          action={reviewDocument}
                          hidden={{ documentId: doc.id }}
                          submitLabel="Save decision"
                          successMessage="Saved."
                          fields={[
                            {
                              name: "decision",
                              label: "Decision",
                              type: "select",
                              required: true,
                              options: [
                                { value: "VERIFIED", label: "Verified against the original" },
                                { value: "REJECTED", label: "Rejected" },
                              ],
                            },
                            { name: "note", label: "Note", placeholder: "Required when rejecting" },
                          ]}
                        />
                      ) : doc ? (
                        <Badge variant={doc.status === "VERIFIED" ? "success" : "danger"}>{doc.status.toLowerCase()}</Badge>
                      ) : (
                        <Badge variant="neutral">missing</Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="mt-5 grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-2">
                <Wallet size={14} /> Statement
              </h3>
              {o.ledgerEntries.length === 0 ? (
                <p className="text-slate-500 text-sm">No fees yet.</p>
              ) : (
                <ul className="text-sm space-y-1 max-h-48 overflow-y-auto">
                  {o.ledgerEntries.slice(0, 20).map((e) => (
                    <li key={e.id} className="flex justify-between gap-3">
                      <span className="text-slate-400">
                        {e.createdAt.toISOString().slice(0, 10)} · {e.kind === "FEE_DUE" ? `fee, ${e.sourceType.toLowerCase().replace("_", " ")}` : e.kind === "FEE_PAID" ? "paid" : "adjustment"}
                        {e.note ? ` · ${e.note}` : ""}
                      </span>
                      <span className={e.kind === "FEE_PAID" ? "text-emerald-400" : "text-slate-200"}>
                        {e.kind === "FEE_PAID" ? "−" : ""}
                        {rands(Number(e.amount))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-4">
              <h3 className="text-xs uppercase tracking-wide text-slate-500 flex items-center gap-2">
                <BadgeCheck size={14} /> Record money received
              </h3>
              <ActionForm
                action={recordPayment}
                hidden={{ operatorUserId: o.id, entryKey: randomUUID() }}
                submitLabel="Record payment"
                successMessage="Payment recorded."
                fields={[
                  { name: "amount", label: "Amount (R)", type: "number", required: true },
                  { name: "note", label: "Reference", placeholder: "EFT reference, or cash receipt number", required: true },
                ]}
              />
              <details className="text-sm">
                <summary className="text-slate-400 cursor-pointer">Correct the balance</summary>
                <div className="mt-3">
                  <ActionForm
                    action={recordAdjustment}
                    hidden={{ operatorUserId: o.id, entryKey: randomUUID() }}
                    submitLabel="Record adjustment"
                    successMessage="Adjustment recorded."
                    fields={[
                      { name: "amount", label: "Amount (R)", placeholder: "-25 reduces what is owed", required: true },
                      { name: "note", label: "Why", required: true },
                    ]}
                  />
                </div>
              </details>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
