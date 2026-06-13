import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const authUser = getAuthUser(req);
    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get("page") ?? "1");
    const pageSize = Number(searchParams.get("pageSize") ?? "20");
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
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.order.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { storeId, items, deliveryAddress, deliveryLat, deliveryLng, notes, paymentMethod } = body;
  const customerId = authUser.userId;

  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) {
    return NextResponse.json({ success: false, error: "Store not found" }, { status: 404 });
  }

  let subtotal = 0;
  const orderItems: { productId: string; quantity: number; unitPrice: number; totalPrice: number; notes?: string }[] = [];

  for (const item of items) {
    const product = await prisma.product.findUnique({ where: { id: item.productId } });
    if (!product || !product.isAvailable) {
      return NextResponse.json({ success: false, error: `Product ${item.productId} is unavailable` }, { status: 400 });
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
      customerId,
      storeId,
      subtotal,
      deliveryFee,
      total,
      deliveryAddress,
      deliveryLat,
      deliveryLng,
      notes,
      paymentMethod: paymentMethod ?? "CASH",
      items: { create: orderItems },
      delivery: { create: {} },
    },
    include: { items: true, delivery: true },
  });

  return NextResponse.json({ success: true, data: order }, { status: 201 });
}
