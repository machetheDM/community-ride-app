import { NextRequest } from "next/server";
import { detectProvider } from "@ride/push-service";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { parseBody, pushTokenSchema } from "@/lib/validate";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";

/**
 * Registers a device's push token.
 *
 * `pushProvider` is derived from the token's shape rather than taken from the
 * request body: the client has no reason to be trusted about which transport it is
 * on, and the shape is unambiguous. It is stored for observability — the send path
 * re-derives it per message, so a device that switches from Expo Go to a dev build
 * is routed correctly on its next push without waiting for this column to catch up.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const authUser = requireAuth(req);
  const { token } = await parseBody(req, pushTokenSchema);
  const provider = detectProvider(token);

  await prisma.user.update({
    where: { id: authUser.userId },
    data: { pushToken: token, pushProvider: provider },
  });

  return ok({ registered: true, provider });
});
