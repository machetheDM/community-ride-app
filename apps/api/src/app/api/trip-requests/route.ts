import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActiveUser } from "@/lib/auth";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { myRequestSelect, presentMyRequest } from "@/lib/group-trips";

/**
 * The caller's own requests for event seats, newest first: the passenger's
 * "My trips". Scoped by the user id from the database, so there is no id to
 * swap for someone else's.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const user = await requireActiveUser(req);
  const requests = await prisma.tripRequest.findMany({
    where: { customerId: user.userId },
    select: myRequestSelect,
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return ok(requests.map(presentMyRequest));
});
