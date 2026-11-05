import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertRole, auditRefusals, requireViewer } from "@/lib/actor";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { driverAdminSelect } from "@/lib/views";

/**
 * The operator roster, for admins only.
 *
 * This was public. One unauthenticated `GET /api/drivers?isOnline=true` returned
 * every online operator's name, phone, plate, ID number, licence number and live
 * coordinates (PLAN.md section 2, hole 3; threat model RD-6). In a district
 * where e-hailing drivers have been attacked over routes, that request is the
 * one a person hunting operators would poll. It is now an admin tool, and even
 * an admin gets the last four digits of an ID number, never the number or the
 * licence number.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const viewer = await requireViewer(req);

  return auditRefusals(viewer, { action: "driver.list", entityType: "Driver", entityId: null }, async () => {
    assertRole(viewer, "ADMIN");

    const { searchParams } = new URL(req.url);
    const isOnline = searchParams.get("isOnline");
    const isApproved = searchParams.get("isApproved");

    const drivers = await prisma.driver.findMany({
      where: {
        ...(isOnline !== null ? { isOnline: isOnline === "true" } : {}),
        ...(isApproved !== null ? { isApproved: isApproved === "true" } : {}),
      },
      select: driverAdminSelect,
      orderBy: { rating: "desc" },
      take: 200,
    });

    return ok(drivers);
  });
});
