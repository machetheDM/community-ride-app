import {
  sendPushNotification as send,
  sendPushToUser as sendOne,
  sendPushToMany as sendMany,
  type PushMessage,
} from "@ride/push-service";
import { logger } from "@/lib/logger";

/**
 * Thin binding of the shared push transport to this app's structured logger.
 *
 * The transport itself lives in `@ride/push-service` because the merchant portal
 * sends the same order notifications, and the two apps previously kept separate
 * copies — the portal's dropped any token that was not an `ExponentPushToken[…]`,
 * so merchant-triggered pushes to FCM devices would have vanished silently while
 * still reporting success.
 */

export type { PushMessage };
export { detectProvider } from "@ride/push-service";

export function sendPushNotification(messages: PushMessage[]): Promise<number> {
  return send(messages, { logger });
}

export function sendPushToUser(
  pushToken: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<number> {
  return sendOne(pushToken, title, body, data, { logger });
}

export function sendPushToMany(
  pushTokens: Array<string | null | undefined>,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<number> {
  return sendMany(pushTokens, title, body, data, { logger });
}
