import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { storeListSelect } from "@/lib/views";

/**
 * Public store list. Public on purpose, so a customer can browse before
 * signing in; for the same reason it returns only what a shop window shows.
 * It used to `include` every store column, `merchantId` among them, and that one
 * value was all it took to forge the old portal cookie (threat model PA-3).
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.slice(0, 100);
  const category = searchParams.get("category")?.slice(0, 100);
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
    select: storeListSelect,
    orderBy: [{ isOpen: "desc" }, { rating: "desc" }],
    take: 50,
  });

  return ok(stores);
});
