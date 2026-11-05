import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { NotFoundError } from "@/lib/errors";
import { storeDetailSelect } from "@/lib/views";

/**
 * Public store page: the store's shop-window fields and its menu. No
 * `merchantId`, no phone, no stock counts (threat model PA-3).
 */
export const GET = withErrorHandler(async (_req: NextRequest, ctx) => {
  const { id } = await ctx.params;

  const store = await prisma.store.findFirst({
    where: { id, isApproved: true },
    select: storeDetailSelect,
  });
  if (!store) throw new NotFoundError("Store");

  return ok(store);
});
