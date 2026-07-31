import { NextRequest } from "next/server";
import { placesAutocomplete, getPlaceCoordinates } from "@ride/maps-service";
import { requireAuth } from "@/lib/auth";
import { parseBody, autocompleteSchema, placeResolveSchema } from "@/lib/validate";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { getMapsConfig, withMaps } from "@/lib/maps";
import { autocompleteLimiter } from "@/lib/rate-limit";

/**
 * Address autocomplete, and resolution of the chosen suggestion.
 *
 * Both halves share one `sessionToken`, which is what keeps the whole interaction
 * on the Autocomplete *Session* SKU — free at unlimited volume. Billed per request
 * instead, a single address entry is roughly one call per keystroke.
 *
 * POST = suggestions for partial input.
 * PUT  = resolve a chosen placeId to coordinates, closing the session.
 *
 * The limit here is looser than the other maps routes because typing legitimately
 * produces a burst of calls.
 */

export const POST = withErrorHandler(async (req: NextRequest) => {
  requireAuth(req);
  autocompleteLimiter(req);

  const { input, sessionToken, bias } = await parseBody(req, autocompleteSchema);

  const suggestions = await withMaps(() =>
    placesAutocomplete(getMapsConfig(), input, { sessionToken, bias })
  );

  return ok(suggestions);
});

export const PUT = withErrorHandler(async (req: NextRequest) => {
  requireAuth(req);
  autocompleteLimiter(req);

  const { placeId, sessionToken } = await parseBody(req, placeResolveSchema);

  const address = await withMaps(() =>
    getPlaceCoordinates(getMapsConfig(), placeId, sessionToken)
  );

  return ok(address);
});
