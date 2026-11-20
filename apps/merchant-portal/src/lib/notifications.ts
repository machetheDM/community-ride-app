import { sendPushToMany as sendMany, sendPushToUser as sendOne } from "@ride/push-service";

/**
 * Order notifications from the merchant portal.
 *
 * Delegates to the shared transport rather than keeping a local copy. The previous
 * implementation required tokens to start with `ExponentPushToken[` and returned
 * silently otherwise — harmless while every token came from Expo, but the moment
 * FCM tokens exist it would have dropped those notifications without a trace while
 * the action still reported success.
 */
export function sendPushToUser(
  pushToken: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<number> {
  return sendOne(pushToken, title, body, data);
}

/** One message to many devices: the new-delivery push to nearby riders. */
export function sendPushToMany(
  pushTokens: Array<string | null | undefined>,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<number> {
  return sendMany(pushTokens, title, body, data);
}
