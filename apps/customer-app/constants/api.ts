import Constants from "expo-constants";
import { Platform } from "react-native";

const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;

/**
 * Base URL of the API.
 *
 * Resolution order: an explicit EXPO_PUBLIC_API_URL (set this when testing against
 * a deployed API or a physical device on the LAN), then `extra.apiUrl` from
 * app.json, then a platform-appropriate localhost.
 *
 * The Android emulator reaches the host machine at 10.0.2.2, never 127.0.0.1 —
 * that address is the emulator itself. The iOS simulator shares the host's
 * loopback, so localhost works there.
 *
 * The port is 3000 to match `next dev --port 3000` in apps/api. It previously
 * defaulted to 3002, where nothing listens, so every request from this app failed
 * to connect.
 */
const DEFAULT_HOST = Platform.OS === "android" ? "http://10.0.2.2" : "http://localhost";

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? extra?.apiUrl ?? `${DEFAULT_HOST}:3000`;
