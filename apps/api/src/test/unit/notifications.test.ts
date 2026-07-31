import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import {
  detectProvider,
  sendPushNotification,
  sendPushToUser,
  sendPushToMany,
  __resetMessaging,
} from "@ride/push-service";

/**
 * Transport selection is the whole point of this module, so it is what these
 * assert: an Expo token must reach exp.host, an FCM token must not, and neither
 * must ever throw into a caller that has already completed a ride or an order.
 *
 * `fetch` is injected. The global stub in `src/test/setup.ts` throws, so anything
 * that failed to inject would fail loudly rather than reach the network.
 */

const EXPO_TOKEN = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";
const FCM_TOKEN =
  "fZ7bQ1p2R0m:APA91bHqK3xY_exampleRegistrationTokenValueThatIsQuiteLong123";

const okResponse = () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }) as Response;

describe("detectProvider", () => {
  it("recognises Expo tokens in both spellings", () => {
    expect(detectProvider(EXPO_TOKEN)).toBe("expo");
    expect(detectProvider("ExpoPushToken[abc]")).toBe("expo");
  });

  it("treats anything else as FCM", () => {
    expect(detectProvider(FCM_TOKEN)).toBe("fcm");
  });

  it("does not misread a token that merely mentions Expo later on", () => {
    expect(detectProvider("abcExponentPushToken[x]")).toBe("fcm");
  });
});

describe("sendPushNotification", () => {
  beforeEach(() => {
    __resetMessaging();
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  });

  afterEach(() => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  });

  it("sends Expo tokens to the Expo push endpoint", async () => {
    const fetchImpl = jest.fn(async () => okResponse());

    const sent = await sendPushNotification(
      [{ to: EXPO_TOKEN, title: "Driver found", body: "On the way" }],
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );

    expect(sent).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toContain("exp.host");
  });

  it("does not send FCM tokens to Expo", async () => {
    const fetchImpl = jest.fn(async () => okResponse());

    await sendPushNotification([{ to: FCM_TOKEN, title: "t", body: "b" }], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Firebase is unconfigured, so this delivers nothing — but it must not have
    // been misrouted to Expo, which would silently drop it.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("routes a mixed batch to both transports independently", async () => {
    const fetchImpl = jest.fn(async () => okResponse());

    const sent = await sendPushNotification(
      [
        { to: EXPO_TOKEN, title: "t", body: "b" },
        { to: FCM_TOKEN, title: "t", body: "b" },
      ],
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );

    // The Expo half still lands even though the FCM half cannot.
    expect(sent).toBe(1);
    const body = JSON.parse(String(((fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(body).toHaveLength(1);
    expect(body[0].to).toBe(EXPO_TOKEN);
  });

  it("skips rather than throws when Firebase is not configured", async () => {
    const fetchImpl = jest.fn(async () => okResponse());

    await expect(
      sendPushNotification([{ to: FCM_TOKEN, title: "t", body: "b" }], {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).resolves.toBe(0);
  });

  it("skips rather than throws when the service account JSON is malformed", async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = "{not valid json";

    await expect(
      sendPushNotification([{ to: FCM_TOKEN, title: "t", body: "b" }])
    ).resolves.toBe(0);
  });

  it("skips rather than throws when the service account is missing fields", async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: "p" });

    await expect(
      sendPushNotification([{ to: FCM_TOKEN, title: "t", body: "b" }])
    ).resolves.toBe(0);
  });

  it("does not throw when Expo rejects the request", async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 502 }) as Response);

    await expect(
      sendPushNotification([{ to: EXPO_TOKEN, title: "t", body: "b" }], {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).resolves.toBe(0);
  });

  it("does not throw when the transport itself rejects", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error("network down");
    });

    await expect(
      sendPushNotification([{ to: EXPO_TOKEN, title: "t", body: "b" }], {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).resolves.toBe(0);
  });

  it("defaults the sound so notifications are audible", async () => {
    const fetchImpl = jest.fn(async () => okResponse());

    await sendPushNotification([{ to: EXPO_TOKEN, title: "t", body: "b" }], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const body = JSON.parse(String(((fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(body[0].sound).toBe("default");
  });

  it("ignores empty and whitespace-free-but-absent tokens without calling out", async () => {
    const fetchImpl = jest.fn(async () => okResponse());

    await expect(
      sendPushNotification([{ to: "", title: "t", body: "b" }], {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).resolves.toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("sendPushToUser", () => {
  it("is a no-op for a null token", async () => {
    const fetchImpl = jest.fn(async () => okResponse());

    await expect(
      sendPushToUser(null, "t", "b", undefined, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).resolves.toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("sendPushToMany", () => {
  it("batches Expo recipients into a single upstream request", async () => {
    const fetchImpl = jest.fn(async () => okResponse());

    const sent = await sendPushToMany(
      [EXPO_TOKEN, "ExponentPushToken[second]", null, undefined],
      "New ride request",
      "2.4 km away",
      { rideId: "ride-1" },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );

    expect(sent).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(((fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(body).toHaveLength(2);
  });

  it("is a no-op when every recipient lacks a token", async () => {
    const fetchImpl = jest.fn(async () => okResponse());

    await expect(
      sendPushToMany([null, undefined], "t", "b", undefined, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).resolves.toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
