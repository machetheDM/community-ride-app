import { NextRequest } from "next/server";
import { getETA } from "@ride/maps-service";
import { requireAuth } from "@/lib/auth";
import { parseBody, routeSchema } from "@/lib/validate";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { getMapsConfig, withMaps } from "@/lib/maps";
import { mapsLimiter } from "@/lib/rate-limit";

/**
 * Travel time and distance between two points, without the polyline.
 *
 * Separate from /route because the trip-preview screen re-runs this on every
 * vehicle-type change and does not need the geometry — and Google bills the two
 * endpoints independently.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  requireAuth(req);
  mapsLimiter(req);

  const { origin, destination } = await parseBody(req, routeSchema);
  const result = await withMaps(() => getETA(getMapsConfig(), origin, destination));

  return ok(result);
});
