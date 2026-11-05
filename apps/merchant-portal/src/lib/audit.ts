import "server-only";
import { headers } from "next/headers";
import { recordAudit, type AuditEntry } from "@ride/db";
import { prisma } from "./prisma";
import { clientIpFrom } from "./client-ip";
import type { PortalSession } from "./session";

/**
 * Audit rows from the portal (PRACTICES.md SEC-4): sign-ins, status changes, and
 * admin reads of personal data.
 *
 * Reads are recorded as well as writes. An insider admin paging through every
 * driver's phone number changes nothing in the database, so a log of writes alone
 * would never show it (threat model PA-7).
 */

export async function requestIp(): Promise<string> {
  const h = await headers();
  return clientIpFrom(h.get("x-forwarded-for"), process.env.TRUST_PROXY_HOPS);
}

type PortalDetail = Record<string, string | number | boolean | null>;

/** Never throws: an audit outage must not become a sign-in outage. */
export async function auditPortal(entry: Omit<AuditEntry, "ip" | "detail"> & { detail?: PortalDetail }): Promise<void> {
  await recordAudit(prisma, {
    ...entry,
    ip: await requestIp(),
    detail: { channel: "portal", ...entry.detail },
  });
}

/** One row per admin page view of personal data: who looked, at what, and how many rows. */
export async function auditAdminRead(session: PortalSession, entityType: string, rows: number): Promise<void> {
  await auditPortal({
    actorUserId: session.userId,
    actorRole: session.role,
    action: `admin.view.${entityType.toLowerCase()}`,
    entityType,
    detail: { rows },
  });
}
