import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { parseBody, deliveryStatusSchema } from "@/lib/validate";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { NotFoundError, AuthorizationError } from "@/lib/errors";
import { sendPushToUser } from "@/lib/notifications";
import { emitOrderEvent } from "@/lib/analytics";

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

/** Order status implied by a delivery reaching a given state. */
const ORDER_STATUS_FOR: Record<string, string | undefined> = {
  PICKED_UP: "OUT_FOR_DELIVERY",
  EN_ROUTE: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
};

export const PATCH = withErrorHandler(async (req: NextRequest, ctx) => {
  const authUser = requireAuth(req);
  const { id } = await ctx.params;
  const { status, failReason } = await parseBody(req, deliveryStatusSchema);

  const delivery = await prisma.delivery.findUnique({
    where: { id },
    select: {
      id: true,
      riderId: true,
      orderId: true,
      order: { select: { customer: { select: { pushToken: true } } } },
    },
  });

  if (!delivery) throw new NotFoundError("Delivery");

  // Only the assigned rider may advance a delivery. Without this any authenticated
  // user could mark someone else's order delivered.
  const rider = await prisma.rider.findUnique({
    where: { userId: authUser.userId },
    select: { id: true },
  });
  if (!rider || delivery.riderId !== rider.id) {
    throw new AuthorizationError("Only the assigned rider can update this delivery");
  }

  const now = new Date();
  const updated = await prisma.delivery.update({
    where: { id },
    data: {
      status: status as never,
      ...(status === "PICKED_UP" ? { pickedUpAt: now } : {}),
      ...(status === "DELIVERED" ? { deliveredAt: now } : {}),
      ...(status === "FAILED" ? { failedAt: now, failReason } : {}),
    },
  });

  // Keep the merchant-facing order status in step with the rider-facing one.
  const orderStatus = ORDER_STATUS_FOR[status];
  if (orderStatus) {
    const order = await prisma.order.update({
      where: { id: delivery.orderId },
      data: {
        status: orderStatus as never,
        ...(orderStatus === "DELIVERED" ? { deliveredAt: now } : {}),
      },
      include: {
        store: { select: { name: true } },
        _count: { select: { items: true } },
      },
    });

    if (orderStatus === "DELIVERED") {
      emitOrderEvent({
        ...order,
        storeName: order.store.name,
        itemCount: order._count.items,
        riderId: delivery.riderId,
      });
    }
  }

  const msg = DELIVERY_MESSAGES[status];
  if (msg && delivery.order.customer.pushToken) {
    await sendPushToUser(delivery.order.customer.pushToken, msg.title, msg.body, {
      orderId: delivery.orderId,
      screen: "orders",
    });
  }

  return ok(updated);
});
