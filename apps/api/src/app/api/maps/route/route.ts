import { NextRequest } from "next/server";
import { getRoute } from "@ride/maps-service";
import { requireAuth } from "@/lib/auth";
import { parseBody, routeSchema } from "@/lib/validate";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { getMapsConfig, withMaps } from "@/lib/maps";
import { mapsLimiter } from "@/lib/rate-limit";

/**
 * Full route between two points, including the encoded polyline the apps draw on
 * the map. Routes Essentials: 10,000 free calls a month, then $5 per 1,000.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  requireAuth(req);
  mapsLimiter(req);

  const { origin, destination } = await parseBody(req, routeSchema);
  const result = await withMaps(() => getRoute(getMapsConfig(), origin, destination));

  return ok(result);
});
