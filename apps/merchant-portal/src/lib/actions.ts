"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { getSession, setSession, clearSession } from "./session";
import { sendPushToUser } from "./notifications";

const STATUS_MESSAGES: Record<string, { title: string; body: string }> = {
  CONFIRMED:        { title: "Order Confirmed ✅", body: "Your order has been confirmed by the store." },
  PREPARING:        { title: "Being Prepared 👨‍🍳", body: "The store is preparing your order." },
  READY_FOR_PICKUP: { title: "Ready for Pickup 📦", body: "Your order is ready and waiting for a rider." },
  CANCELLED:        { title: "Order Cancelled", body: "Sorry, the store was unable to accept your order." },
};

export interface LoginState {
  error?: string;
}

export async function loginMerchant(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const phone = String(formData.get("phone") ?? "").trim();
  if (!phone) return { error: "Enter your phone number." };

  const user = await prisma.user.findUnique({
    where: { phone },
    include: { merchantProfile: true },
  });

  if (!user || user.role !== "MERCHANT" || !user.merchantProfile) {
    return { error: "No merchant account is registered for this number." };
  }

  await setSession({ userId: user.id, merchantId: user.merchantProfile.id, name: user.name });
  redirect("/dashboard");
}

export async function logoutMerchant() {
  await clearSession();
  redirect("/login");
}

export async function updateOrderStatus(orderId: string, status: string) {
  const session = await getSession();
  if (!session) return { error: "Not authenticated" };

  // Verify the order belongs to one of this merchant's stores.
  const order = await prisma.order.findFirst({
    where: { id: orderId, store: { merchantId: session.merchantId } },
    include: { customer: { select: { pushToken: true } } },
  });
  if (!order) return { error: "Order not found" };

  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: status as never,
      ...(status === "CONFIRMED" ? { confirmedAt: new Date() } : {}),
      ...(status === "PREPARING" ? { preparedAt: new Date() } : {}),
      ...(status === "DELIVERED" ? { deliveredAt: new Date() } : {}),
      ...(status === "CANCELLED" ? { cancelledAt: new Date() } : {}),
    },
  });

  const msg = STATUS_MESSAGES[status];
  if (msg && order.customer.pushToken) {
    await sendPushToUser(order.customer.pushToken, msg.title, msg.body, { orderId, screen: "orders" });
  }

  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function toggleStoreOpen(storeId: string, isOpen: boolean) {
  const session = await getSession();
  if (!session) return { error: "Not authenticated" };

  await prisma.store.updateMany({
    where: { id: storeId, merchantId: session.merchantId },
    data: { isOpen },
  });

  revalidatePath("/dashboard/store");
  revalidatePath("/dashboard");
  return { ok: true };
}
