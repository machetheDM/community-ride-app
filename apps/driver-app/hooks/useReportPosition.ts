import { useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import { API_URL } from "@/constants/api";

/** Why position reporting is not running, for the screen to say so. */
export type PositionState = "off" | "asking" | "reporting" | "denied" | "unavailable";

/**
 * Reports the operator's position to the API while they are online and the app
 * is open.
 *
 * The app never did this before November 2026, although everything downstream
 * depends on it: the distance to a pickup, the "driver arriving" alert, the list
 * of deliveries near a rider, and the customer's tracking map.
 *
 * Foreground only, on purpose. Reporting with the app closed needs the "always"
 * location permission, a foreground service on Android and a store review
 * justification; none of that is built, so it is not claimed. An operator who
 * switches apps stops reporting until they come back.
 *
 * The server keeps a position only while the operator is online and approved,
 * and clears it when they go offline (`drivers/me`, `riders/me`), so this hook
 * simply stops sending when `enabled` turns false.
 *
 * @param path  `/api/drivers/me` or `/api/riders/me`
 */
export function useReportPosition(path: "/api/drivers/me" | "/api/riders/me", token: string | null, enabled: boolean) {
  const [state, setState] = useState<PositionState>("off");
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const lastSent = useRef(0);

  useEffect(() => {
    if (!enabled || !token) {
      setState("off");
      return;
    }

    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    const send = async (lat: number, lng: number) => {
      // At most one report every ten seconds, whatever the device delivers.
      const now = Date.now();
      if (now - lastSent.current < 10_000) return;
      lastSent.current = now;
      try {
        await fetch(`${API_URL}${path}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ currentLat: lat, currentLng: lng }),
        });
      } catch {
        // A dropped report is replaced by the next one; nothing to show.
      }
    };

    (async () => {
      setState("asking");
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (permission.status !== "granted") {
          setState("denied");
          return;
        }
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 15_000, distanceInterval: 50 },
          (update) => {
            const next = { lat: update.coords.latitude, lng: update.coords.longitude };
            setPosition(next);
            void send(next.lat, next.lng);
          }
        );
        if (cancelled) {
          subscription.remove();
          return;
        }
        setState("reporting");
      } catch {
        if (!cancelled) setState("unavailable");
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [path, token, enabled]);

  return { state, position };
}

/** One line for the screen, or null when there is nothing to say. */
export function positionMessage(state: PositionState): string | null {
  switch (state) {
    case "denied":
      return "Location is off for this app. Allow it in your phone's settings to get work near you.";
    case "unavailable":
      return "We cannot read your location right now. Check that location is switched on.";
    default:
      return null;
  }
}
