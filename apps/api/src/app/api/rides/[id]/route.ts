import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { sendPushToUser } from "@/lib/notifications";

const RIDE_STATUS_MESSAGES: Record<string, { title: string; body: string }> = {
  ACCEPTED:       { title: "Driver found! 🚗", body: "A driver accepted your ride and is on the way." },
  DRIVER_ARRIVED: { title: "Your driver has arrived 📍", body: "Your driver is waiting at the pickup point." },
  IN_PROGRESS:    { title: "Trip started 🛣️", body: "Enjoy your ride!" },
  COMPLETED:      { title: "Trip completed ✅", body: "Thanks for riding with Community Ride!" },
  CANCELLED:      { title: "Ride cancelled", body: "Your ride has been cancelled." },
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ride = await prisma.ride.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true, avatar: true } },
      driver: {
        include: {
          user: { select: { id: true, name: true, phone: true, avatar: true } },
          vehicle: true,
        },
      },
      locations: { orderBy: { timestamp: "desc" }, take: 1 },
      payment: true,
      rating: true,
    },
  });

  if (!ride) {
    return NextResponse.json(
      { success: false, error: "Ride not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, data: ride });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await req.json();
    const { status, fareActual, cancelReason } = body;

    const data: Record<string, unknown> = {};
    if (status) data.status = status;
    if (fareActual !== undefined) data.fareActual = fareActual;
    if (cancelReason) data.cancelReason = cancelReason;

    if (status === "IN_PROGRESS") data.startedAt = new Date();
    if (status === "COMPLETED") data.completedAt = new Date();
    if (status === "CANCELLED") data.cancelledAt = new Date();

    // When a driver accepts, attach their driver profile to the ride.
    if (status === "ACCEPTED") {
      const driver = await prisma.driver.findUnique({ where: { userId: authUser.userId } });
      if (!driver) return NextResponse.json({ error: "Not a registered driver" }, { status: 403 });
      data.driverId = driver.id;
    }

    const ride = await prisma.ride.update({
      where: { id },
      data,
      include: { customer: { select: { id: true, pushToken: true } }, driver: true },
    });

    // Credit the driver's completed-rides counter.
    if (status === "COMPLETED" && ride.driverId) {
      await prisma.driver.update({
        where: { id: ride.driverId },
        data: { totalRides: { increment: 1 } },
      });
    }

    // Notify the customer of the status change.
    const msg = RIDE_STATUS_MESSAGES[status as string];
    if (msg && ride.customer.pushToken) {
      await sendPushToUser(ride.customer.pushToken, msg.title, msg.body, {
        rideId: ride.id,
        screen: "ride",
      });
    }

    return NextResponse.json({ success: true, data: ride });
  } catch {
    return NextResponse.json({ error: "Failed to update ride" }, { status: 500 });
  }
}
