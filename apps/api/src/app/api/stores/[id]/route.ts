import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const store = await prisma.store.findUnique({
      where: { id, isApproved: true },
      include: {
        categories: {
          include: {
            products: {
              where: { isAvailable: true },
              orderBy: { name: "asc" },
            },
          },
          orderBy: { name: "asc" },
        },
        _count: { select: { products: true, orders: true } },
      },
    });

    if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 });

    return NextResponse.json({ success: true, data: store });
  } catch {
    return NextResponse.json({ error: "Failed to fetch store" }, { status: 500 });
  }
}
