import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";

export const GET = withErrorHandler(async (req: NextRequest) => {
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

  return ok(drivers);
});
