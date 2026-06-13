import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { sendPushToUser } from "@/lib/notifications";

const STATUS_MESSAGES: Record<string, { title: string; body: string }> = {
  CONFIRMED:        { title: "Order Confirmed ✅", body: "Your order has been confirmed by the store." },
  PREPARING:        { title: "Being Prepared 👨‍🍳", body: "The store is preparing your order." },
  READY_FOR_PICKUP: { title: "Ready for Pickup 📦", body: "Your order is ready and waiting for a rider." },
  OUT_FOR_DELIVERY: { title: "On the Way 🛵", body: "Your order is out for delivery!" },
  DELIVERED:        { title: "Delivered 🎉", body: "Your order has been delivered. Enjoy!" },
  CANCELLED:        { title: "Order Cancelled", body: "Your order has been cancelled." },
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const { status } = await req.json();

    if (!status) return NextResponse.json({ error: "status required" }, { status: 400 });

    const order = await prisma.order.update({
      where: { id },
      data: {
        status: status as never,
        ...(status === "CONFIRMED"        ? { confirmedAt: new Date() } : {}),
        ...(status === "PREPARING"        ? { preparedAt: new Date() } : {}),
        ...(status === "DELIVERED"        ? { deliveredAt: new Date() } : {}),
        ...(status === "CANCELLED"        ? { cancelledAt: new Date() } : {}),
      },
      include: {
        customer: { select: { id: true, name: true, fcmToken: true } },
        store: { select: { name: true } },
      },
    });

    const msg = STATUS_MESSAGES[status];
    if (msg && order.customer.fcmToken) {
      await sendPushToUser(order.customer.fcmToken, msg.title, msg.body, {
        orderId: order.id,
        screen: "orders",
      });
    }

    return NextResponse.json({ success: true, data: order });
  } catch {
    return NextResponse.json({ error: "Failed to update order status" }, { status: 500 });
  }
}
