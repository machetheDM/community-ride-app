import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { parseBody, geocodeSchema } from "@/lib/validate";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { geocodeCached, withMaps } from "@/lib/maps";
import { mapsLimiter } from "@/lib/rate-limit";

/**
 * Address string → coordinates.
 *
 * Authenticated and rate limited because every miss costs money: Geocoding is
 * 10,000 free calls a month and $5 per 1,000 after that. An open proxy in front of
 * a billed API is a funnel straight into our billing account, so the gate is the
 * point of this route existing at all rather than the app calling Google directly.
 *
 * Repeats are served from the process-local cache in `lib/maps.ts`.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  requireAuth(req);
  mapsLimiter(req);

  const { address } = await parseBody(req, geocodeSchema);
  const result = await withMaps(() => geocodeCached(address));

  return ok(result);
});
