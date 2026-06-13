import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const authUser = getAuthUser(req);
    const { searchParams } = new URL(req.url);
    const active = searchParams.get("active") === "true";
    const page = Number(searchParams.get("page") ?? "1");
    const pageSize = Number(searchParams.get("pageSize") ?? "20");

    const where = {
      ...(authUser ? { customerId: authUser.userId } : {}),
      ...(active
        ? { status: { in: ["REQUESTED", "ACCEPTED", "DRIVER_ARRIVED", "IN_PROGRESS"] as never[] } }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.ride.findMany({
        where,
        include: {
          driver: {
            include: { user: { select: { name: true, phone: true, avatar: true } }, vehicle: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.ride.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch rides" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { pickupAddress, dropoffAddress, vehicleType, fareEstimate, paymentMethod } = body;

    if (!pickupAddress || !dropoffAddress) {
      return NextResponse.json({ error: "pickup and dropoff addresses required" }, { status: 400 });
    }

    const ride = await prisma.ride.create({
      data: {
        customerId: authUser.userId,
        pickupLat: 0,
        pickupLng: 0,
        pickupAddress,
        dropoffLat: 0,
        dropoffLng: 0,
        dropoffAddress,
        fareEstimate: fareEstimate ?? 0,
        vehicleType: vehicleType ?? "SEDAN",
        paymentMethod: paymentMethod ?? "CASH",
      },
    });

    return NextResponse.json({ success: true, data: ride }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create ride" }, { status: 500 });
  }
}
