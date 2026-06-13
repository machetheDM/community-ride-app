import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const isOnline = searchParams.get("isOnline");
  const isApproved = searchParams.get("isApproved");

  const where = {
    ...(isOnline !== null ? { isOnline: isOnline === "true" } : {}),
    ...(isApproved !== null ? { isApproved: isApproved === "true" } : {}),
  };

  const drivers = await prisma.driver.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, phone: true, avatar: true } },
      vehicle: true,
      _count: { select: { rides: true } },
    },
    orderBy: { rating: "desc" },
  });

  return NextResponse.json({ success: true, data: drivers });
}
