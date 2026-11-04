import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import type { LatLng } from "../types";
import { decodePolyline } from "../polyline";

export interface RouteMapProps {
  pickup?: LatLng | null;
  dropoff?: LatLng | null;
  /** Encoded polyline from the Routes API. */
  polyline?: string | null;
  /** Live driver position, when one is assigned. */
  driver?: LatLng | null;
  style?: object;
  /** Keeps the camera fitted to the route as it changes. Default true. */
  autoFit?: boolean;
}

const EDGE_PADDING = { top: 60, right: 60, bottom: 60, left: 60 };

/**
 * Map with the trip route drawn on it.
 *
 * Rendering costs nothing: the Maps SDK for Android and iOS SKU is free at
 * unlimited volume. Only the Routes call that produced `polyline` was billable, and
 * that already happened server-side — this component never talks to Google beyond
 * fetching tiles.
 *
 * `PROVIDER_GOOGLE` is explicit so Android and iOS render the same basemap; without
 * it iOS silently falls back to Apple Maps and the two apps look different.
 */
export function RouteMap({
  pickup,
  dropoff,
  polyline,
  driver,
  style,
  autoFit = true,
}: RouteMapProps) {
  const mapRef = useRef<MapView | null>(null);

  const routeCoords = useMemo(() => {
    const decoded = polyline ? decodePolyline(polyline) : [];
    if (decoded.length) return decoded;
    // No geometry yet — fall back to a straight line so the screen still shows the
    // trip's shape rather than an empty map.
    if (pickup && dropoff) return [pickup, dropoff];
    return [];
  }, [polyline, pickup, dropoff]);

  const initialRegion = useMemo(() => {
    const anchor = pickup ?? dropoff ?? driver;
    if (!anchor) {
      // Johannesburg, so the first frame is not the middle of the ocean while the
      // real coordinates load.
      return { latitude: -26.2041, longitude: 28.0473, latitudeDelta: 0.3, longitudeDelta: 0.3 };
    }
    return {
      latitude: anchor.lat,
      longitude: anchor.lng,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    };
  }, [pickup, dropoff, driver]);

  useEffect(() => {
    if (!autoFit || !mapRef.current) return;

    const points = [...routeCoords, ...(driver ? [driver] : [])];
    if (points.length < 2) return;

    mapRef.current.fitToCoordinates(
      points.map((p) => ({ latitude: p.lat, longitude: p.lng })),
      { edgePadding: EDGE_PADDING, animated: true }
    );
  }, [routeCoords, driver, autoFit]);

  return (
    <View style={[styles.container, style]}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
      >
        {routeCoords.length > 1 ? (
          <Polyline
            coordinates={routeCoords.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
            strokeColor="#f59e0b"
            strokeWidth={4}
          />
        ) : null}

        {pickup ? (
          <Marker
            coordinate={{ latitude: pickup.lat, longitude: pickup.lng }}
            title="Pickup"
            pinColor="#10b981"
          />
        ) : null}

        {dropoff ? (
          <Marker
            coordinate={{ latitude: dropoff.lat, longitude: dropoff.lng }}
            title="Dropoff"
            pinColor="#ef4444"
          />
        ) : null}

        {driver ? (
          <Marker
            coordinate={{ latitude: driver.lat, longitude: driver.lng }}
            title="Driver"
            pinColor="#f59e0b"
            flat
          />
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: "hidden", backgroundColor: "#1e293b" },
});
