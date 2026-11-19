import { NextRequest } from "next/server";
import { recordAuditStrict } from "@ride/db";
import { checkDeliveryTransition } from "@ride/db/lifecycle";
import { prisma } from "@/lib/prisma";
import { assertRole, auditRefusals, requireViewer } from "@/lib/actor";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { AuthorizationError, ConflictError, NotFoundError } from "@/lib/errors";
import { riderAcceptRefusal } from "@/lib/policy";
import { orderSelect, presentOrder } from "@/lib/views";
import { ACTIVE_DELIVERY_STATUSES, DISPATCHABLE_ORDER_STATUSES } from "@/lib/delivery";
import { sendPushToUser } from "@/lib/notifications";
import { logger } from "@/lib/logger";
import { owedBy } from "@/lib/group-trips";
import { owedRefusal } from "@ride/db/trips";

/**
 * A rider takes a waiting delivery (PLAN.md Phase 2.3).
 *
 * The same shape as a driver accepting a ride, for the same reasons:
 * - The rider must be able to work (approved, approved vehicle, online), hold no
 *   other active delivery, and not be the customer.
 * - The rider's row is locked first, so one rider accepting two deliveries at
 *   once is serialised and the second is refused.
 * - The write is conditional on the delivery still waiting with no rider, so two
 *   riders tapping the same job get one 200 and one 409.
 * - The order must still be one a store has accepted and not cancelled.
 *
 * Only now does the rider see the customer: the response is the order as its
 * assigned rider sees it (first name, phone while the job is active, address).
 */
export const POST = withErrorHandler(async (req: NextRequest, ctx) => {
  const viewer = await requireViewer(req);
  const { id } = await ctx.params;

  const result = await auditRefusals(
    viewer,
    { action: "delivery.accept", entityType: "Delivery", entityId: id },
    async () => {
      assertRole(viewer, "RIDER");
      const riderId = viewer.riderId;
      if (!riderId) throw new NotFoundError("Rider profile");

      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "ride"."Rider" WHERE id = ${riderId} FOR UPDATE`;

        const delivery = await tx.delivery.findUnique({
          where: { id },
          select: { id: true, status: true, riderId: true, orderId: true, order: { select: { status: true, customerId: true } } },
        });
        if (!delivery) throw new NotFoundError("Delivery");

        const rider = await tx.rider.findUnique({
          where: { id: riderId },
          select: { isApproved: true, isOnline: true, vehicle: { select: { isApproved: true } } },
        });
        const otherActive = await tx.delivery.count({
          where: { riderId, status: { in: [...ACTIVE_DELIVERY_STATUSES] } },
        });
        const refusal = rider
          ? riderAcceptRefusal(rider, otherActive, viewer, delivery.order)
          : "Not a registered rider";
        if (refusal) throw new AuthorizationError(refusal);
        const paused = owedRefusal(await owedBy(tx, viewer.userId));
        if (paused) throw new AuthorizationError(paused);

        const check = checkDeliveryTransition(delivery.status, "ASSIGNED", "RIDER");
        if (!check.allowed || delivery.riderId !== null) {
          throw new ConflictError("Another rider has already taken this delivery");
        }
        if (!(DISPATCHABLE_ORDER_STATUSES as readonly string[]).includes(delivery.order.status)) {
          throw new ConflictError("This order is no longer waiting for a rider");
        }

        const now = new Date();
        const taken = await tx.delivery.updateMany({
          where: { id, status: "PENDING", riderId: null },
          data: { status: "ASSIGNED", riderId, assignedAt: now },
        });
        if (taken.count !== 1) throw new ConflictError("Another rider has already taken this delivery");

        await recordAuditStrict(tx, {
          actorUserId: viewer.userId,
          actorRole: viewer.role,
          action: check.action,
          entityType: "Delivery",
          entityId: id,
          detail: { from: "PENDING", to: "ASSIGNED", orderId: delivery.orderId },
        });

        return tx.order.findUniqueOrThrow({ where: { id: delivery.orderId }, select: orderSelect });
      });
    }
  );

  notifyCustomer(result.id).catch(() => {
    /* notifyCustomer logs its own failures; a push never fails an accepted job */
  });

  return ok(presentOrder(result, "RIDER"));
});

async function notifyCustomer(orderId: string): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { customer: { select: { pushToken: true } } },
    });
    if (!order) return;
    await sendPushToUser(
      order.customer.pushToken,
      "A rider is on the way 🛵",
      "A rider has taken your delivery and is heading to the store.",
      { orderId, screen: "orders" }
    );
  } catch (error) {
    logger.warn("[deliveries] accept notification failed", {
      orderId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
