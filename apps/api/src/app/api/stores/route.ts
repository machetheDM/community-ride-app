import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";

export const GET = withErrorHandler(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search");
  const category = searchParams.get("category");
  const isOpen = searchParams.get("isOpen");

  const stores = await prisma.store.findMany({
    where: {
      isApproved: true,
      ...(isOpen !== null ? { isOpen: isOpen === "true" } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
              { address: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(category && category !== "All"
        ? { categories: { some: { name: { contains: category, mode: "insensitive" } } } }
        : {}),
    },
    include: {
      categories: true,
      _count: { select: { products: true, orders: true } },
    },
    orderBy: [{ isOpen: "desc" }, { rating: "desc" }],
    take: 50,
  });

  return ok(stores);
});
