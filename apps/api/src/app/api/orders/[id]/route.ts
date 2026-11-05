import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditRefusals, requireViewer } from "@/lib/actor";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { ConcealedRecordError, NotFoundError } from "@/lib/errors";
import { orderRelation } from "@/lib/policy";
import { orderSelect, presentOrder } from "@/lib/views";

/**
 * One order, for its customer, the store's merchant, the assigned rider or an
 * admin. Anyone else gets the same 404 as for an id that does not exist.
 */
export const GET = withErrorHandler(async (req: NextRequest, ctx) => {
  const viewer = await requireViewer(req);
  const { id } = await ctx.params;

  return auditRefusals(viewer, { action: "order.read", entityType: "Order", entityId: id }, async () => {
    const order = await prisma.order.findUnique({ where: { id }, select: orderSelect });
    if (!order) throw new NotFoundError("Order");
    const relation = orderRelation(viewer, order);
    if (!relation) throw new ConcealedRecordError("Order");
    return ok(presentOrder(order, relation));
  });
});
