import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rides = await prisma.ride.findMany({
      where: { status: "REQUESTED", driverId: null },
      include: {
        customer: { select: { name: true, phone: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 30,
    });

    return NextResponse.json({ success: true, data: rides });
  } catch {
    return NextResponse.json({ error: "Failed to fetch available rides" }, { status: 500 });
  }
}
