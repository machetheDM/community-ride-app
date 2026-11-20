import { API_URL } from "@/constants/api";

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** The server's message when it refused, shown as it is: it is written for the passenger. */
  error: string | null;
  /** Per-field messages from a 400, such as the price floor. */
  fields: Record<string, string[]> | null;
}

/**
 * One call to the API, with the customer's token when there is one. Never
 * throws: a refusal and a dropped connection both come back as `ok: false`
 * with a message, so a screen has one path for "that did not work".
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
    const json = (await res.json().catch(() => null)) as {
      success?: boolean;
      data?: T;
      error?: string;
      errors?: Record<string, string[]>;
    } | null;
    const ok = res.ok && json?.success !== false;
    return {
      ok,
      status: res.status,
      data: ok ? ((json?.data ?? null) as T | null) : null,
      error: ok ? null : (json?.error ?? "Something went wrong. Try again."),
      fields: ok ? null : (json?.errors ?? null),
    };
  } catch {
    return { ok: false, status: 0, data: null, error: "No connection. Check your signal and try again.", fields: null };
  }
}

/** A date as people in South Africa say it: "Sat 5 Dec, 18:00". */
export function sastDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
