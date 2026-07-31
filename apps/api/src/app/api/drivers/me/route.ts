import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { maybeNotifyArrival } from "@/lib/arrival";

export async function GET(req: NextRequest) {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const driver = await prisma.driver.findUnique({
      where: { userId: authUser.userId },
      include: {
        user: { select: { name: true, phone: true, avatar: true } },
        vehicle: true,
        _count: { select: { rides: true } },
      },
    });

    if (!driver) {
      return NextResponse.json({ error: "Not a registered driver" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: driver });
  } catch {
    return NextResponse.json({ error: "Failed to fetch driver" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { isOnline, currentLat, currentLng, heading } = body;

    const driver = await prisma.driver.update({
      where: { userId: authUser.userId },
      data: {
        ...(isOnline !== undefined ? { isOnline } : {}),
        ...(currentLat !== undefined ? { currentLat } : {}),
        ...(currentLng !== undefined ? { currentLng } : {}),
        ...(heading !== undefined ? { heading } : {}),
      },
    });

    // A new position may mean the driver is now close enough to pickup to warn the
    // customer. Fire-and-forget: the driver's location update is the operation
    // being requested here and must not wait on, or fail with, a notification.
    if (typeof currentLat === "number" && typeof currentLng === "number") {
      maybeNotifyArrival(driver.id, { lat: currentLat, lng: currentLng }).catch(() => {
        /* maybeNotifyArrival logs its own failures */
      });
    }

    return NextResponse.json({ success: true, data: driver });
  } catch {
    return NextResponse.json({ error: "Failed to update driver" }, { status: 500 });
  }
}
