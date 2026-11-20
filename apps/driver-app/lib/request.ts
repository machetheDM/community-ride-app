import { Alert, Linking, Platform } from "react-native";
import { API_URL } from "@/constants/api";

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** The server's message when it refused, for the screen to show as it is. */
  error: string | null;
}

/**
 * One call to the API with the operator's token.
 *
 * Never throws: a refusal and a dropped connection both come back as
 * `ok: false` with a message, so a screen has one path for "that did not work".
 * The server's own message is passed through, because it is written for the
 * operator ("This order is not ready for pickup", "2 tries left").
 */
export async function api<T>(
  token: string | null,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const json = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null;
    const ok = res.ok && json?.success !== false;
    return {
      ok,
      status: res.status,
      data: ok ? ((json?.data ?? null) as T | null) : null,
      error: ok ? null : (json?.error ?? "Something went wrong. Try again."),
    };
  } catch {
    return { ok: false, status: 0, data: null, error: "No connection. Check your signal and try again." };
  }
}

/**
 * Hands off to the phone's own navigation app. A URL scheme, not an API call: it
 * uses no Maps Platform quota. With no coordinates, the address is searched.
 */
export function openNavigation(target: { lat?: number | null; lng?: number | null; label: string }) {
  const hasPoint = typeof target.lat === "number" && typeof target.lng === "number" && !(target.lat === 0 && target.lng === 0);
  const web = hasPoint
    ? `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(target.label)}`;
  const native = hasPoint
    ? Platform.select({
        ios: `maps://app?daddr=${target.lat},${target.lng}&dirflg=d`,
        android: `google.navigation:q=${target.lat},${target.lng}`,
        default: web,
      })
    : web;

  Linking.openURL(native as string).catch(() => {
    Linking.openURL(web).catch(() => Alert.alert("Could not open navigation", `Head to ${target.label}.`));
  });
}
