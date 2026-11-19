import { NextRequest } from "next/server";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { NotFoundError } from "@/lib/errors";
import { loadSharedTrip } from "@/lib/group-trips";

/**
 * Share-my-trip as JSON (PLAN.md 3.9). The page a passenger actually sends is
 * `/t/{token}` (`app/t/[token]/page.tsx`); both read `loadSharedTrip`, which
 * shows the trip and the vehicle, never who is on it.
 */
export const GET = withErrorHandler(async (_req: NextRequest, ctx) => {
  const { token } = await ctx.params;
  const trip = await loadSharedTrip(token);
  if (!trip) throw new NotFoundError("Trip");
  return ok(trip);
});
