import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, optionalAuth } from "@/lib/auth";
import { parseBody, rideCreateSchema } from "@/lib/validate";
import { ok, created } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { getPagination, paginatedResponse } from "@/lib/pagination";

export const GET = withErrorHandler(async (req: NextRequest) => {
  const authUser = optionalAuth(req);
  const { page, pageSize, skip } = getPagination(req);
  const { searchParams } = new URL(req.url);
  const active = searchParams.get("active") === "true";

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
      skip,
      take: pageSize,
    }),
    prisma.ride.count({ where }),
  ]);

  return ok(paginatedResponse({ items, total, page, pageSize }));
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const authUser = requireAuth(req);
  const body = await parseBody(req, rideCreateSchema);

  const ride = await prisma.ride.create({
    data: {
      customerId: authUser.userId,
      pickupLat: body.pickupLat ?? 0,
      pickupLng: body.pickupLng ?? 0,
      pickupAddress: body.pickupAddress,
      dropoffLat: body.dropoffLat ?? 0,
      dropoffLng: body.dropoffLng ?? 0,
      dropoffAddress: body.dropoffAddress,
      fareEstimate: body.fareEstimate,
      vehicleType: body.vehicleType,
      paymentMethod: body.paymentMethod,
    },
  });

  return created(ride);
});
