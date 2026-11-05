import { NextRequest } from "next/server";
import { recordAuditStrict } from "@ride/db";
import {
  checkDeliveryTransition,
  ORDER_STATUS_FOR_DELIVERY,
  ORDER_TRANSITIONS,
  type DeliveryStatus,
} from "@ride/db/lifecycle";
import { prisma } from "@/lib/prisma";
import { auditRefusals, requireViewer } from "@/lib/actor";
import { parseBody, deliveryStatusSchema } from "@/lib/validate";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { ConcealedRecordError, ConflictError, NotFoundError } from "@/lib/errors";
import { isAssignedRider, type Viewer } from "@/lib/policy";
import { deliverySelect } from "@/lib/views";
import { sendPushToUser } from "@/lib/notifications";
import { emitOrderEvent } from "@/lib/analytics";
import { logger } from "@/lib/logger";

/**
 * Advances a delivery through its own lifecycle.
 *
 * `Delivery.status` (PENDING → ASSIGNED → PICKED_UP → EN_ROUTE → DELIVERED) existed
 * in the schema with no endpoint writing to it — only `Order.status` was ever
 * updated, so the rider-side leg of a delivery was permanently stuck at its default
 * and "order picked up" could not be notified because nothing recorded a pickup.
 *
 * The two statuses track different things and both are needed: `Order.status` is
 * the merchant's view (confirmed, preparing, ready), `Delivery.status` is the
 * rider's (picked up, en route). They are kept consistent here rather than left to
 * drift.
 *
 * Only the assigned rider may move a delivery, one step at a time
 * (`DELIVERY_TRANSITIONS`), and the order moves with it in the same transaction:
 * a pickup needs an order the store has marked ready, so a rider cannot collect
 * an order that was cancelled a minute ago. Each write is conditional on the
 * status that was read, so two taps on "delivered" record one delivery.
 * Assigning a rider (dispatch) is Phase 2 and is not done here.
 */

const DELIVERY_MESSAGES: Record<string, { title: string; body: string }> = {
  PICKED_UP: {
    title: "Order picked up 🛵",
    body: "Your rider has collected your order and is on the way.",
  },
  EN_ROUTE: {
    title: "Rider en route 📍",
    body: "Your order is close — please be ready to receive it.",
  },
  DELIVERED: {
    title: "Delivered 🎉",
    body: "Your order has been delivered. Enjoy!",
  },
  FAILED: {
    title: "Delivery problem",
    body: "We could not complete your delivery. Support will be in touch.",
  },
};

const VERB: Record<DeliveryStatus, string> = {
  PENDING: "delivery.status",
  ASSIGNED: "delivery.assign",
  PICKED_UP: "delivery.pick_up",
  EN_ROUTE: "delivery.en_route",
  DELIVERED: "delivery.deliver",
  FAILED: "delivery.fail",
};

export const PATCH = withErrorHandler(async (req: NextRequest, ctx) => {
  const viewer = await requireViewer(req);
  const { id } = await ctx.params;
  const { status, failReason } = await parseBody(req, deliveryStatusSchema);

  const result = await auditRefusals(
    viewer,
    { action: VERB[status], entityType: "Delivery", entityId: id, detail: { to: status } },
    () => transition(viewer, id, status, failReason)
  );

  await afterTransition(result.delivery.orderId, status, result.riderId);
  return ok(result.delivery);
});

async function transition(viewer: Viewer, id: string, to: DeliveryStatus, failReason: string | undefined) {
  const current = await prisma.delivery.findUnique({
    where: { id },
    select: { id: true, status: true, riderId: true, orderId: true },
  });
  if (!current) throw new NotFoundError("Delivery");

  // Only the assigned rider may advance a delivery. Without this any
  // authenticated user could mark someone else's order delivered. Anyone else
  // hears "not found", as for rides and orders, so a delivery id is not
  // confirmed to a stranger.
  if (!isAssignedRider(viewer, current)) throw new ConcealedRecordError("Delivery");
  const riderId = current.riderId as string;

  const check = checkDeliveryTransition(current.status, to, "RIDER");
  if (!check.allowed) throw new ConflictError(`A ${current.status} delivery cannot be moved to ${to}`);

  const orderStep = ORDER_STATUS_FOR_DELIVERY[to];
  const now = new Date();

  const delivery = await prisma.$transaction(async (tx) => {
    const written = await tx.delivery.updateMany({
      where: { id, status: current.status, riderId },
      data: {
        status: to,
        ...(to === "PICKED_UP" ? { pickedUpAt: now } : {}),
        ...(to === "DELIVERED" ? { deliveredAt: now } : {}),
        ...(to === "FAILED" ? { failedAt: now, failReason: failReason ?? null } : {}),
      },
    });
    if (written.count !== 1) throw new ConflictError("This delivery changed while you were updating it; reload it");

    await recordAuditStrict(tx, {
      actorUserId: viewer.userId,
      actorRole: viewer.role,
      action: check.action,
      entityType: "Delivery",
      entityId: id,
      detail: { from: current.status, to, orderId: current.orderId, ...(failReason ? { reason: failReason } : {}) },
    });

    // Keep the merchant-facing order status in step with the rider-facing one,
    // conditionally: an order an admin cancelled while the rider was on the way
    // matches no row, and the whole move rolls back with a 409.
    if (orderStep) {
      const moved = await tx.order.updateMany({
        where: { id: current.orderId, status: orderStep.from },
        data: {
          status: orderStep.to,
          ...(orderStep.to === "DELIVERED" ? { deliveredAt: now } : {}),
        },
      });
      if (moved.count !== 1) {
        throw new ConflictError(
          orderStep.from === "READY_FOR_PICKUP"
            ? "This order is not ready for pickup"
            : "This order is no longer out for delivery"
        );
      }

      const orderMove = ORDER_TRANSITIONS.find((t) => t.from === orderStep.from && t.to === orderStep.to);
      if (orderMove) {
        await recordAuditStrict(tx, {
          actorUserId: viewer.userId,
          actorRole: viewer.role,
          action: orderMove.action,
          entityType: "Order",
          entityId: current.orderId,
          detail: { from: orderStep.from, to: orderStep.to, as: "DELIVERY", deliveryId: id },
        });
      }
    }

    return tx.delivery.findUniqueOrThrow({ where: { id }, select: deliverySelect });
  });

  return { delivery, riderId };
}

/** Push and analytics after the commit; neither may fail a change that has happened. */
async function afterTransition(orderId: string, status: DeliveryStatus, riderId: string): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        customerId: true,
        storeId: true,
        deliveryAddress: true,
        subtotal: true,
        deliveryFee: true,
        total: true,
        paymentMethod: true,
        createdAt: true,
        deliveredAt: true,
        cancelledAt: true,
        store: { select: { name: true } },
        customer: { select: { pushToken: true } },
        _count: { select: { items: true } },
      },
    });
    if (!order) return;

    if (status === "DELIVERED") {
      emitOrderEvent({ ...order, storeName: order.store.name, itemCount: order._count.items, riderId });
    }

    const msg = DELIVERY_MESSAGES[status];
    if (msg) {
      await sendPushToUser(order.customer.pushToken, msg.title, msg.body, { orderId, screen: "orders" });
    }
  } catch (error) {
    logger.warn("[deliveries] post-transition notification failed", {
      orderId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
