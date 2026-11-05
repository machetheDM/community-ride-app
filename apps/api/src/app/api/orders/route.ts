import { NextRequest } from "next/server";
import { Prisma, recordAuditStrict } from "@ride/db";
import { prisma } from "@/lib/prisma";
import { auditRefusals, requireViewer } from "@/lib/actor";
import { parseBody, parseQuery, orderCreateSchema, orderListQuerySchema } from "@/lib/validate";
import { ok, created } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { getPagination, paginatedResponse } from "@/lib/pagination";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { orderListScope, orderRelation, storeOrderRefusal } from "@/lib/policy";
import { orderSelect, presentOrder } from "@/lib/views";

/**
 * The caller's orders: a customer's own, a merchant's stores' orders, a rider's
 * deliveries, or every order for an admin.
 *
 * Like the ride list, this filtered by customer only when a token was present,
 * so a request without one returned every order and delivery address (PLAN.md
 * section 2, hole 1; threat model OD-1).
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const viewer = await requireViewer(req);
  const { page, pageSize, skip } = getPagination(req);
  // An unknown status is a 400 now, not a value cast straight into the query.
  const { status } = parseQuery(req, orderListQuerySchema);

  const scope = orderListScope(viewer);
  if (!scope) return ok(paginatedResponse({ items: [], total: 0, page, pageSize }));

  const where = { ...scope, ...(status ? { status } : {}) };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({ where, select: orderSelect, orderBy: { createdAt: "desc" }, skip, take: pageSize }),
    prisma.order.count({ where }),
  ]);

  const items = orders.flatMap((order) => {
    const relation = orderRelation(viewer, order);
    return relation ? [presentOrder(order, relation)] : [];
  });
  return ok(paginatedResponse({ items, total, page, pageSize }));
});

/**
 * Places an order.
 *
 * What changed, and what each change stops (threat model OD-3; PLAN.md 2.4):
 *
 * - Every product must belong to the store being ordered from. The product was
 *   looked up by id alone, so an order at a cheap store could carry another
 *   store's goods at whatever that store charges, and the merchant would see an
 *   item on their ticket they do not sell.
 * - The store must be approved and open.
 * - Stock, where a product tracks it, is checked and taken in the same
 *   statement (`stock >= n`, then decrement), so two customers cannot both buy
 *   the last one.
 * - Money is summed as `Decimal`, not as floats: 0.1 + 0.2 is 0.30000000000000004
 *   in floating point, and a till that is out by a cent per order is a till
 *   nobody trusts.
 * - All of it is one transaction. A failure halfway leaves no order without its
 *   stock taken, and no stock taken without its order.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const viewer = await requireViewer(req);
  const body = await parseBody(req, orderCreateSchema);

  const order = await auditRefusals(
    viewer,
    { action: "order.create", entityType: "Store", entityId: body.storeId },
    () =>
      prisma.$transaction(async (tx) => {
        const store = await tx.store.findUnique({
          where: { id: body.storeId },
          select: { id: true, isApproved: true, isOpen: true, deliveryFee: true, minimumOrder: true },
        });
        if (!store || !store.isApproved) throw new NotFoundError("Store");
        const storeRefusal = storeOrderRefusal(store);
        if (storeRefusal) throw new ConflictError(storeRefusal);

        const ids = body.items.map((item) => item.productId);
        const products = await tx.product.findMany({
          where: { id: { in: ids }, storeId: store.id },
          select: { id: true, name: true, price: true, isAvailable: true, stock: true },
        });
        const byId = new Map(products.map((p) => [p.id, p]));

        const foreign = ids.filter((id) => !byId.has(id));
        if (foreign.length > 0) {
          throw new ValidationError("Every product must come from this store", {
            items: foreign.map((id) => `Product ${id} is not sold by this store`),
          });
        }

        let subtotal = new Prisma.Decimal(0);
        const lines: Prisma.OrderItemCreateWithoutOrderInput[] = [];

        for (const item of body.items) {
          const product = byId.get(item.productId);
          if (!product) throw new ValidationError(`Product ${item.productId} is not sold by this store`);
          if (!product.isAvailable) throw new ConflictError(`${product.name} is unavailable`);

          if (product.stock !== null) {
            const taken = await tx.product.updateMany({
              where: { id: product.id, stock: { gte: item.quantity } },
              data: { stock: { decrement: item.quantity } },
            });
            if (taken.count !== 1) throw new ConflictError(`Not enough ${product.name} in stock`);
          }

          const unitPrice = new Prisma.Decimal(product.price);
          const totalPrice = unitPrice.mul(item.quantity);
          subtotal = subtotal.add(totalPrice);
          lines.push({
            product: { connect: { id: product.id } },
            quantity: item.quantity,
            unitPrice,
            totalPrice,
            notes: item.notes,
          });
        }

        if (subtotal.lessThan(store.minimumOrder)) {
          throw new ValidationError(`This store's minimum order is R${new Prisma.Decimal(store.minimumOrder).toFixed(2)}`);
        }

        const deliveryFee = new Prisma.Decimal(store.deliveryFee);
        const total = subtotal.add(deliveryFee);

        const placed = await tx.order.create({
          data: {
            customer: { connect: { id: viewer.userId } },
            store: { connect: { id: store.id } },
            subtotal,
            deliveryFee,
            total,
            deliveryAddress: body.deliveryAddress,
            deliveryLat: body.deliveryLat ?? 0,
            deliveryLng: body.deliveryLng ?? 0,
            notes: body.notes,
            paymentMethod: body.paymentMethod,
            items: { create: lines },
            delivery: { create: {} },
          },
          select: orderSelect,
        });

        await recordAuditStrict(tx, {
          actorUserId: viewer.userId,
          actorRole: viewer.role,
          action: "order.create",
          entityType: "Order",
          entityId: placed.id,
          detail: { storeId: store.id, total: total.toFixed(2), items: lines.length },
        });

        return placed;
      })
  );

  return created(presentOrder(order, "CUSTOMER"));
});
