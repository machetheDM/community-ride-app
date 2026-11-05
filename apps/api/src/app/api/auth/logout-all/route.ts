import { NextRequest } from "next/server";
import { recordAudit } from "@ride/db";
import { prisma } from "@/lib/prisma";
import { requireActiveUser } from "@/lib/auth";
import { getClientIp } from "@/lib/client-ip";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";

/**
 * Signs the caller out on every device: for a lost phone, or a token the user
 * thinks was copied.
 *
 * Tokens are stateless and live 30 days, so there is nothing to delete. Every
 * token carries the `tokenVersion` it was issued under, and `requireActiveUser`
 * compares it with the database on each request; incrementing the column makes
 * every token issued so far, this one included, fail that comparison. It also ends
 * the user's merchant-portal sessions, which carry the same version.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const caller = await requireActiveUser(req);

  const updated = await prisma.user.update({
    where: { id: caller.userId },
    data: { tokenVersion: { increment: 1 } },
    select: { tokenVersion: true },
  });

  await recordAudit(prisma, {
    actorUserId: caller.userId,
    actorRole: caller.role,
    action: "auth.logout_all",
    entityType: "User",
    entityId: caller.userId,
    ip: getClientIp(req),
    detail: { channel: "api", tokenVersion: updated.tokenVersion },
  });

  return ok({ message: "Signed out on every device" });
});
