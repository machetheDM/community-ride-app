/**
 * @ride/push-service — push notifications over two transports.
 *
 * SERVER ONLY. Holds Firebase service-account credentials; must never be imported
 * from a mobile or browser bundle.
 *
 * The apps register through Expo's push service, which relays to FCM on Android and
 * APNs on iOS — so FCM was always in the path, just not directly. Talking to FCM
 * ourselves requires `google-services.json` and a development build, which would end
 * Expo Go testing. Both transports therefore live here and the *token* decides which
 * is used: Expo Go keeps working today, and the FCM path is real code that takes
 * over the moment a dev build starts issuing native tokens.
 *
 * Shared by the API and the merchant portal. They previously kept separate copies,
 * and the portal's copy dropped any token not starting with `ExponentPushToken[` —
 * so once FCM tokens existed, merchant-triggered order notifications would have
 * silently gone nowhere while still reporting success.
 *
 * Nothing here throws. A push is a courtesy on top of an operation that already
 * succeeded; a ride is still accepted whether or not the notification lands.
 */

export type PushProvider = "expo" | "fcm";

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
}

export interface PushLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

const consoleLogger: PushLogger = {
  info: (m, meta) => console.log(m, meta ?? ""),
  warn: (m, meta) => console.warn(m, meta ?? ""),
  error: (m, meta) => console.error(m, meta ?? ""),
};

export interface PushOptions {
  logger?: PushLogger;
  fetchImpl?: typeof fetch;
}

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/**
 * Classifies a token by shape.
 *
 * Derived from the token rather than from a stored `pushProvider` column, so a
 * device migrating from Expo Go to a dev build is routed correctly on its very next
 * push instead of waiting for a backfill.
 */
export function detectProvider(token: string): PushProvider {
  return /^Expo(nent)?PushToken\[/.test(token) ? "expo" : "fcm";
}

// ─── Expo transport ───────────────────────────────────────────

async function sendViaExpo(
  messages: PushMessage[],
  log: PushLogger,
  doFetch: typeof fetch
): Promise<number> {
  if (!messages.length) return 0;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Required only for projects with Expo's enhanced push security enabled.
  if (process.env.EXPO_PUSH_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.EXPO_PUSH_ACCESS_TOKEN}`;
  }

  const res = await doFetch(EXPO_PUSH_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(messages.map((m) => ({ ...m, sound: m.sound ?? "default" }))),
  });

  if (!res.ok) {
    log.warn("[push] Expo rejected the request", { status: res.status });
    return 0;
  }

  return messages.length;
}

// ─── FCM transport ────────────────────────────────────────────

type FirebaseMessaging = {
  sendEachForMulticast: (msg: {
    tokens: string[];
    notification: { title: string; body: string };
    data?: Record<string, string>;
  }) => Promise<{ successCount: number }>;
};

let messagingPromise: Promise<FirebaseMessaging | null> | null = null;

/**
 * Initialises Firebase Admin lazily, and at most once.
 *
 * Lazy because a missing service account must not stop the app booting — push is
 * not on the critical path for rides, orders or auth. Resolving at import would
 * turn an optional integration into a hard startup dependency and would break
 * `next build`, which runs without runtime secrets.
 *
 * The import is dynamic so `firebase-admin` never enters the bundle of a
 * deployment that does not use it.
 */
async function getMessaging(log: PushLogger): Promise<FirebaseMessaging | null> {
  if (messagingPromise) return messagingPromise;

  messagingPromise = (async () => {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) {
      log.info("[push] FIREBASE_SERVICE_ACCOUNT_JSON not set — FCM transport disabled");
      return null;
    }

    try {
      const json = JSON.parse(raw) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };

      // Google issues the service-account file in snake_case; the Admin SDK's
      // ServiceAccount type is camelCase. `cert()` tolerates both at runtime, but
      // mapping explicitly keeps the types honest and the failure legible.
      //
      // Private keys carry literal "\n" when passed through an environment
      // variable; Firebase rejects them unencoded with an opaque PEM error.
      const credentials = {
        projectId: json.project_id,
        clientEmail: json.client_email,
        privateKey: json.private_key?.replace(/\\n/g, "\n"),
      };

      if (!credentials.projectId || !credentials.clientEmail || !credentials.privateKey) {
        log.error("[push] FIREBASE_SERVICE_ACCOUNT_JSON is incomplete — FCM transport disabled");
        return null;
      }

      // The modular entry points. firebase-admin 14 removed the namespaced API
      // (`admin.apps`, `admin.credential`, `admin.messaging()`); these have existed
      // since version 10, and importing only the app and messaging modules keeps
      // the rest of the SDK out of the server bundle.
      const [{ cert, getApps, initializeApp }, { getMessaging }] = await Promise.all([
        import("firebase-admin/app"),
        import("firebase-admin/messaging"),
      ]);
      const app = getApps()[0] ?? initializeApp({ credential: cert(credentials) });

      log.info("[push] Firebase Admin initialised", { projectId: credentials.projectId });
      return getMessaging(app) as unknown as FirebaseMessaging;
    } catch (error) {
      log.error("[push] Firebase Admin failed to initialise — FCM transport disabled", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  })();

  return messagingPromise;
}

/** FCM data payloads must be flat string maps; anything else is rejected upstream. */
function stringifyData(data?: Record<string, unknown>): Record<string, string> | undefined {
  if (!data) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    out[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return out;
}

async function sendViaFcm(messages: PushMessage[], log: PushLogger): Promise<number> {
  if (!messages.length) return 0;

  const messaging = await getMessaging(log);
  if (!messaging) return 0;

  // Grouped by content so a fan-out to many drivers is one multicast, not N sends.
  const groups = new Map<string, { message: PushMessage; tokens: string[] }>();
  for (const message of messages) {
    const key = `${message.title}\u0000${message.body}\u0000${JSON.stringify(message.data ?? {})}`;
    const existing = groups.get(key);
    if (existing) existing.tokens.push(message.to);
    else groups.set(key, { message, tokens: [message.to] });
  }

  let sent = 0;
  for (const { message, tokens } of groups.values()) {
    const result = await messaging.sendEachForMulticast({
      tokens,
      notification: { title: message.title, body: message.body },
      data: stringifyData(message.data),
    });
    sent += result.successCount;
  }
  return sent;
}

// ─── Public API ───────────────────────────────────────────────

/** Sends a batch, routing each message to the transport its token belongs to. */
export async function sendPushNotification(
  messages: PushMessage[],
  options: PushOptions = {}
): Promise<number> {
  const log = options.logger ?? consoleLogger;
  const doFetch = options.fetchImpl ?? fetch;

  const valid = messages.filter((m) => typeof m.to === "string" && m.to.length > 0);
  if (!valid.length) return 0;

  const expo: PushMessage[] = [];
  const fcm: PushMessage[] = [];
  for (const message of valid) {
    (detectProvider(message.to) === "expo" ? expo : fcm).push(message);
  }

  // Settled, not all: one transport failing must not suppress the other.
  const results = await Promise.allSettled([
    sendViaExpo(expo, log, doFetch),
    sendViaFcm(fcm, log),
  ]);

  let sent = 0;
  for (const result of results) {
    if (result.status === "fulfilled") sent += result.value;
    else {
      log.warn("[push] transport failed", {
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  }
  return sent;
}

/** Sends to a single token. A null or empty token is a no-op, not an error. */
export async function sendPushToUser(
  pushToken: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  options: PushOptions = {}
): Promise<number> {
  if (!pushToken) return 0;
  return sendPushNotification([{ to: pushToken, title, body, data }], options);
}

/** Fans one notification out to many recipients — e.g. every online driver. */
export async function sendPushToMany(
  pushTokens: Array<string | null | undefined>,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  options: PushOptions = {}
): Promise<number> {
  const tokens = pushTokens.filter((t): t is string => Boolean(t));
  if (!tokens.length) return 0;
  return sendPushNotification(
    tokens.map((to) => ({ to, title, body, data })),
    options
  );
}

/** Test-only hook: drops the memoised Firebase Admin instance. */
export function __resetMessaging(): void {
  messagingPromise = null;
}
