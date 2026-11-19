import { NextRequest } from "next/server";
import { OWED_LIMIT_RANDS, owedBalance } from "@ride/db/trips";
import { prisma } from "@/lib/prisma";
import { requireActiveUser } from "@/lib/auth";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";

/**
 * An operator's fee statement (PLAN.md 3.8): every ledger row, newest first, and
 * what they owe, derived from all of them. Drivers and scooter riders both owe
 * fees, so both may read their own.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const user = await requireActiveUser(req, "DRIVER", "RIDER");
  const rows = await prisma.ledgerEntry.findMany({
    where: { operatorUserId: user.userId },
    select: { id: true, kind: true, amount: true, sourceType: true, sourceId: true, note: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const owed = owedBalance(rows);
  return ok({
    owed,
    limit: OWED_LIMIT_RANDS,
    paused: owed > OWED_LIMIT_RANDS,
    entries: rows.slice(0, 100).map((r) => ({ ...r, amount: Number(r.amount) })),
  });
});
