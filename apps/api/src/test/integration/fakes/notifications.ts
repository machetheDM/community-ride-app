/**
 * Stand-in for `@/lib/notifications` in the integration suite (mapped in
 * `jest.integration.config.mjs`). Records every push instead of sending it, so
 * a test can read exactly what would have reached a lock screen, and nothing
 * leaves the machine.
 */

export type { PushMessage } from "@ride/push-service";
export { detectProvider } from "@ride/push-service";

export interface SentPush {
  tokens: Array<string | null | undefined>;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export const sentPushes: SentPush[] = [];

export async function sendPushNotification(messages: { to: string; title: string; body: string }[]): Promise<number> {
  for (const m of messages) sentPushes.push({ tokens: [m.to], title: m.title, body: m.body });
  return messages.length;
}

export async function sendPushToUser(
  pushToken: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<number> {
  sentPushes.push({ tokens: [pushToken], title, body, data });
  return pushToken ? 1 : 0;
}

export async function sendPushToMany(
  pushTokens: Array<string | null | undefined>,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<number> {
  sentPushes.push({ tokens: pushTokens, title, body, data });
  return pushTokens.filter(Boolean).length;
}
