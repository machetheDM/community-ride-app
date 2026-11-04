import { useMemo } from "react";
import { createMapsClient, type MapsClient } from "@ride/maps-service/client";
import { useAuth } from "@/context/AuthContext";
import { API_URL } from "@/constants/api";

/**
 * Client for the API's Maps proxy routes.
 *
 * Rebuilt only when the auth token changes, so the identity stays stable across
 * renders — `AddressAutocomplete` holds it in a `useCallback` dependency array, and
 * a fresh object every render would restart the debounce on each keystroke.
 */
export function useMapsClient(): MapsClient {
  const { token } = useAuth();
  return useMemo(() => createMapsClient({ baseUrl: API_URL, token }), [token]);
}
