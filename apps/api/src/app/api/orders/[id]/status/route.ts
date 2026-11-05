import { NextRequest } from "next/server";
import { recordAuditStrict } from "@ride/db";
import { checkOrderTransition, type OrderActor, type OrderStatus } from "@ride/db/lifecycle";
import { prisma } from "@/lib/prisma";
import { auditRefusals, requireViewer } from "@/lib/actor";
import { parseBody, orderStatusSchema } from "@/lib/validate";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { AuthorizationError, ConcealedRecordError, ConflictError, NotFoundError } from "@/lib/errors";
import { orderRelation, type OrderRelation, type Viewer } from "@/lib/policy";
import { orderSelect, presentOrder, type OrderRecord } from "@/lib/views";
import { sendPushToUser } from "@/lib/notifications";
import { emitOrderEvent } from "@/lib/analytics";
import { logger } from "@/lib/logger";

const STATUS_MESSAGES: Record<string, { title: string; body: string }> = {
  CONFIRMED:        { title: "Order Confirmed ✅", body: "Your order has been confirmed by the store." },
  PREPARING:        { title: "Being Prepared 👨‍🍳", body: "The store is preparing your order." },
  READY_FOR_PICKUP: { title: "Ready for Pickup 📦", body: "Your order is ready and waiting for a rider." },
  CANCELLED:        { title: "Order Cancelled", body: "Your order has been cancelled." },
};

/** Audit verb for each target status, used before the move is known to be valid. */
const VERB: Record<OrderStatus, string> = {
  PENDING: "order.status",
  CONFIRMED: "order.confirm",
  PREPARING: "order.prepare",
  READY_FOR_PICKUP: "order.ready",
  OUT_FOR_DELIVERY: "order.out_for_delivery",
  DELIVERED: "order.delivered",
  CANCELLED: "order.cancel",
};

/** The lifecycle actor each relation acts as. A rider moves the delivery, not the order. */
const ACTOR_FOR: Record<OrderRelation, OrderActor | null> = {
  CUSTOMER: "CUSTOMER",
  MERCHANT: "MERCHANT",
  ADMIN: "ADMIN",
  RIDER: null,
};

/**
 * Moves an order one step: the store's merchant confirms, prepares, marks it
 * ready or cancels it; the customer may cancel while it is still pending; an
 * admin may cancel anything unfinished. OUT_FOR_DELIVERY and DELIVERED are not
 * settable here; only the assigned rider's delivery updates set them.
 *
 * Before, any signed-in user could set any order to any status, and the
 * response carried the customer's push token (PLAN.md hole 5; threat model
 * OD-2, PU-1). Now the caller must stand in a relation to the order (else 404),
 * the move must be theirs in `@ride/db/lifecycle` (else 403 or 409), and the
 * write is conditional on the status that was read, so a merchant confirming an
 * order the customer cancelled a second earlier gets 409, not a resurrected
 * order.
 */
export const PATCH = withErrorHandler(async (req: NextRequest, ctx) => {
  const viewer = await requireViewer(req);
  const { id } = await ctx.params;
  const body = await parseBody(req, orderStatusSchema);

  const { order, relation, actor } = await auditRefusals(
    viewer,
    { action: VERB[body.status], entityType: "Order", entityId: id, detail: { to: body.status } },
    () => transition(viewer, id, body.status, body.cancelReason)
  );

  await afterTransition(order, actor);
  return ok(presentOrder(order, relation));
});

async function transition(
  viewer: Viewer,
  id: string,
  to: OrderStatus,
  cancelReason: string | undefined
): Promise<{ order: OrderRecord; relation: OrderRelation; actor: OrderActor }> {
  const current = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      customerId: true,
      storeId: true,
      store: { select: { merchantId: true } },
      delivery: { select: { riderId: true } },
    },
  });
  if (!current) throw new NotFoundError("Order");

  const relation = orderRelation(viewer, current);
  if (!relation) throw new ConcealedRecordError("Order");
  const actor = ACTOR_FOR[relation];
  if (!actor) throw new AuthorizationError("Riders update the delivery, not the order");

  const check = checkOrderTransition(current.status, to, actor, { hasReason: Boolean(cancelReason) });
  if (!check.allowed) {
    if (check.refusal === "NO_SUCH_MOVE") {
      throw new ConflictError(`A ${current.status} order cannot be moved to ${to}`);
    }
    throw new AuthorizationError("You cannot make this change to this order");
  }

  const now = new Date();
  const order = await prisma.$transaction(async (tx) => {
    const written = await tx.order.updateMany({
      where: {
        id,
        status: current.status,
        // Restated in the write so the decision and the change rest on the
        // same facts: the store a merchant owns, the customer's own order.
        ...(actor === "MERCHANT" ? { storeId: current.storeId } : {}),
        ...(actor === "CUSTOMER" ? { customerId: viewer.userId } : {}),
      },
      data: {
        status: to,
        ...(to === "CONFIRMED" ? { confirmedAt: now } : {}),
        ...(to === "PREPARING" ? { preparedAt: now } : {}),
        ...(to === "READY_FOR_PICKUP" ? { readyAt: now } : {}),
        ...(to === "CANCELLED" ? { cancelledAt: now, cancelledBy: actor, cancelReason: cancelReason ?? null } : {}),
      },
    });
    if (written.count !== 1) throw new ConflictError("This order changed while you were updating it; reload it");

    // A cancelled order gives back the stock it took when it was placed.
    // Products that do not track stock (null) are left alone.
    if (to === "CANCELLED") {
      const items = await tx.orderItem.findMany({ where: { orderId: id }, select: { productId: true, quantity: true } });
      for (const item of items) {
        await tx.product.updateMany({
          where: { id: item.productId, stock: { not: null } },
          data: { stock: { increment: item.quantity } },
        });
      }
    }

    await recordAuditStrict(tx, {
      actorUserId: viewer.userId,
      actorRole: viewer.role,
      action: check.action,
      entityType: "Order",
      entityId: id,
      detail: { from: current.status, to, as: actor, ...(cancelReason ? { reason: cancelReason } : {}) },
    });

    return tx.order.findUniqueOrThrow({ where: { id }, select: orderSelect });
  });

  return { order, relation, actor };
}

/** Push and analytics after the commit; neither may fail a change that has happened. */
async function afterTransition(order: OrderRecord, actor: OrderActor): Promise<void> {
  try {
    if (order.status === "CANCELLED") {
      emitOrderEvent({
        ...order,
        storeName: order.store.name,
        itemCount: order.items.length,
        riderId: order.delivery?.riderId ?? null,
      });
    }

    const msg = STATUS_MESSAGES[order.status];
    if (msg && actor !== "CUSTOMER") {
      const customer = await prisma.user.findUnique({ where: { id: order.customerId }, select: { pushToken: true } });
      await sendPushToUser(customer?.pushToken, msg.title, msg.body, { orderId: order.id, screen: "orders" });
    }
  } catch (error) {
    logger.warn("[orders] post-transition notification failed", {
      orderId: order.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
