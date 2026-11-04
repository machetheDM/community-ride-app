import { useMemo } from "react";
import { createMapsClient, type MapsClient } from "@ride/maps-service/client";
import { useAuth } from "@/context/AuthContext";
import { API_URL } from "@/constants/api";

/**
 * Client for the API's Maps proxy routes.
 *
 * Rebuilt only when the auth token changes, so the identity stays stable across
 * renders and dependent effects do not re-run on every frame.
 */
export function useMapsClient(): MapsClient {
  const { token } = useAuth();
  return useMemo(() => createMapsClient({ baseUrl: API_URL, token }), [token]);
}
