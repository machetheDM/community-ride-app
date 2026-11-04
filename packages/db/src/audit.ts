import type { Prisma } from "./generated/prisma/index";

/**
 * The audit trail: who did what, when (PRACTICES.md SEC-4).
 *
 * Takes the client to write with, so a caller inside a transaction passes the
 * transaction and the audit row commits or rolls back with the change it records.
 */

export interface AuditEntry {
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  ip?: string | null;
  detail?: Prisma.InputJsonValue;
}

/** Anything with an `auditLog.create` — the client or a transaction client. */
export interface AuditWriter {
  auditLog: { create(args: { data: Prisma.AuditLogCreateInput }): Promise<unknown> };
}

/**
 * Writes an audit row inside the caller's transaction. Throws on failure, which
 * is the point: when the record and the change must stand or fall together.
 */
export async function recordAuditStrict(db: AuditWriter, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorUserId: entry.actorUserId ?? null,
      actorRole: entry.actorRole ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      ip: entry.ip ?? null,
      ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
    },
  });
}

/**
 * Writes an audit row after the fact and never throws.
 *
 * For events that are not themselves a database change — a failed sign-in, a
 * refused request. An audit outage must not turn into a sign-in outage, so the
 * failure is reported on stderr and swallowed.
 */
export async function recordAudit(db: AuditWriter, entry: AuditEntry): Promise<void> {
  try {
    await recordAuditStrict(db, entry);
  } catch (error) {
    console.error("[audit] failed to write audit row", {
      action: entry.action,
      entityType: entry.entityType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
