interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
}

export async function sendPushNotification(messages: PushMessage[]) {
  const valid = messages.filter((m) => m.to?.startsWith("ExponentPushToken["));
  if (!valid.length) return;
  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(valid.map((m) => ({ ...m, sound: m.sound ?? "default" }))),
    });
  } catch {
    console.error("[notifications] push send failed");
  }
}

export async function sendPushToUser(
  pushToken: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  if (!pushToken) return;
  return sendPushNotification([{ to: pushToken, title, body, data }]);
}
