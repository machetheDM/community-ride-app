import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, optionalAuth } from "@/lib/auth";
import { parseBody, orderCreateSchema } from "@/lib/validate";
import { ok, created, notFound, badRequest } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { getPagination, paginatedResponse } from "@/lib/pagination";

export const GET = withErrorHandler(async (req: NextRequest) => {
  const authUser = optionalAuth(req);
  const { page, pageSize, skip } = getPagination(req);
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? undefined;

  const where = {
    ...(authUser ? { customerId: authUser.userId } : {}),
    ...(status ? { status: status as never } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        store: { select: { id: true, name: true, logoUrl: true, address: true } },
        items: {
          include: { product: { select: { id: true, name: true, price: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.order.count({ where }),
  ]);

  return ok(paginatedResponse({ items, total, page, pageSize }));
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const authUser = requireAuth(req);
  const body = await parseBody(req, orderCreateSchema);

  const store = await prisma.store.findUnique({ where: { id: body.storeId } });
  if (!store) return notFound("Store not found");

  let subtotal = 0;
  const orderItems: { productId: string; quantity: number; unitPrice: number; totalPrice: number; notes?: string }[] = [];

  for (const item of body.items) {
    const product = await prisma.product.findUnique({ where: { id: item.productId } });
    if (!product || !product.isAvailable) {
      return badRequest(`Product ${item.productId} is unavailable`);
    }
    const unitPrice = Number(product.price);
    const totalPrice = unitPrice * item.quantity;
    subtotal += totalPrice;
    orderItems.push({ productId: item.productId, quantity: item.quantity, unitPrice, totalPrice, notes: item.notes });
  }

  const deliveryFee = Number(store.deliveryFee);
  const total = subtotal + deliveryFee;

  const order = await prisma.order.create({
    data: {
      customerId: authUser.userId,
      storeId: body.storeId,
      subtotal,
      deliveryFee,
      total,
      deliveryAddress: body.deliveryAddress,
      deliveryLat: body.deliveryLat ?? 0,
      deliveryLng: body.deliveryLng ?? 0,
      notes: body.notes,
      paymentMethod: body.paymentMethod,
      items: { create: orderItems },
      delivery: { create: {} },
    },
    include: { items: true, delivery: true },
  });

  return created(order);
});
