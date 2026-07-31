import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  ActivityIndicator, Alert, Linking, ScrollView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { RouteMap } from "@ride/maps-service/native";
import { useAuth } from "@/context/AuthContext";
import { useMapsClient } from "@/hooks/useMapsClient";
import { API_URL } from "@/constants/api";

// Maps the current status to the next action a driver can take.
const NEXT_ACTION: Record<string, { label: string; next: string } | null> = {
  ACCEPTED:       { label: "I've Arrived at Pickup", next: "DRIVER_ARRIVED" },
  DRIVER_ARRIVED: { label: "Start Trip",             next: "IN_PROGRESS" },
  IN_PROGRESS:    { label: "Complete Trip",          next: "COMPLETED" },
  COMPLETED:      null,
  CANCELLED:      null,
};

const STATUS_LABEL: Record<string, string> = {
  ACCEPTED:       "Heading to pickup",
  DRIVER_ARRIVED: "Waiting for customer",
  IN_PROGRESS:    "Trip in progress",
  COMPLETED:      "Trip completed",
  CANCELLED:      "Ride cancelled",
};

interface Ride {
  id: string;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  distanceKm: number;
  durationMinutes: number | null;
  fareEstimate: number;
  fareActual: number | null;
  vehicleType: string;
  paymentMethod: string;
  customer: { name: string; phone: string };
}

/**
 * Hands off to the device's own navigation app.
 *
 * Turn-by-turn guidance is not something to rebuild inside this app, and opening
 * Google Maps this way is a URL scheme rather than an API call — it consumes no
 * Maps Platform quota and costs nothing.
 */
function openNavigation(lat: number, lng: number, label: string) {
  const url = Platform.select({
    ios: `maps://app?daddr=${lat},${lng}&dirflg=d`,
    android: `google.navigation:q=${lat},${lng}`,
    default: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
  });

  Linking.openURL(url as string).catch(() => {
    // Navigation app missing or the scheme is blocked — fall back to the web map.
    Linking.openURL(
      `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
    ).catch(() => Alert.alert("Could not open navigation", `Head to ${label}.`));
  });
}

export default function DriverRideScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { token } = useAuth();
  const mapsClient = useMapsClient();
  const [ride, setRide] = useState<Ride | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [polyline, setPolyline] = useState<string | null>(null);
  const routeFetchedFor = useRef<string | null>(null);

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;

  const fetchRide = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/rides/${id}`);
      const json = await res.json();
      if (json.success) setRide(json.data);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchRide(); }, [fetchRide]);

  // One Routes call per ride, never per refresh — the road does not change mid-trip
  // and each call is billable.
  useEffect(() => {
    if (!ride || routeFetchedFor.current === ride.id) return;
    if (!ride.pickupLat || !ride.dropoffLat) return;

    routeFetchedFor.current = ride.id;
    mapsClient
      .route(
        { lat: ride.pickupLat, lng: ride.pickupLng },
        { lat: ride.dropoffLat, lng: ride.dropoffLng }
      )
      .then((r) => setPolyline(r.polyline))
      .catch(() => setPolyline(null));
  }, [ride, mapsClient]);

  const advance = async () => {
    if (!ride) return;
    const action = NEXT_ACTION[ride.status];
    if (!action) return;

    setUpdating(true);
    try {
      const body: Record<string, unknown> = { status: action.next };
      if (action.next === "COMPLETED") body.fareActual = ride.fareEstimate;
      const res = await fetch(`${API_URL}/api/rides/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed");
      await fetchRide();
      if (action.next === "COMPLETED") {
        Alert.alert("Trip complete!", `You earned R${ride.fareEstimate}`, [
          { text: "Done", onPress: () => router.replace("/(tabs)") },
        ]);
      }
    } catch (e: unknown) {
      Alert.alert("Update failed", e instanceof Error ? e.message : "Try again");
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loader}><ActivityIndicator size="large" color="#22c55e" /></View>
      </SafeAreaView>
    );
  }

  if (!ride) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loader}>
          <Text style={styles.errorText}>Ride not found</Text>
          <TouchableOpacity style={styles.homeBtn} onPress={() => router.replace("/(tabs)")}>
            <Text style={styles.homeBtnText}>Back to Dashboard</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const action = NEXT_ACTION[ride.status];
  const isDone = ride.status === "COMPLETED" || ride.status === "CANCELLED";

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Status */}
        <View style={styles.statusBar}>
          <Text style={styles.statusText}>{STATUS_LABEL[ride.status] ?? ride.status}</Text>
        </View>

        {/* Navigation view */}
        {ride.pickupLat && ride.dropoffLat && !isDone ? (
          <>
            <RouteMap
              style={styles.map}
              pickup={{ lat: ride.pickupLat, lng: ride.pickupLng }}
              dropoff={{ lat: ride.dropoffLat, lng: ride.dropoffLng }}
              polyline={polyline}
            />
            {/* Before the trip starts the driver is heading to the customer; after
                it starts, to the destination. */}
            <TouchableOpacity
              style={styles.navBtn}
              onPress={() =>
                ride.status === "IN_PROGRESS"
                  ? openNavigation(ride.dropoffLat, ride.dropoffLng, ride.dropoffAddress)
                  : openNavigation(ride.pickupLat, ride.pickupLng, ride.pickupAddress)
              }
              activeOpacity={0.85}
            >
              <Ionicons name="navigate" size={18} color="#0f172a" />
              <Text style={styles.navBtnText}>
                {ride.status === "IN_PROGRESS" ? "Navigate to dropoff" : "Navigate to pickup"}
              </Text>
            </TouchableOpacity>
          </>
        ) : null}

        {/* Customer */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Customer</Text>
          <View style={styles.custRow}>
            <View style={styles.custAvatar}>
              <Text style={styles.custAvatarText}>{ride.customer.name.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.custName}>{ride.customer.name}</Text>
              <Text style={styles.custPhone}>{ride.customer.phone}</Text>
            </View>
            <TouchableOpacity style={styles.callBtn} onPress={() => Linking.openURL(`tel:${ride.customer.phone}`)}>
              <Ionicons name="call" size={18} color="#22c55e" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Route */}
        <View style={styles.card}>
          <View style={styles.routeRow}>
            <View style={styles.dotGreen} />
            <View style={{ flex: 1 }}>
              <Text style={styles.routeLabel}>PICKUP</Text>
              <Text style={styles.routeText}>{ride.pickupAddress}</Text>
            </View>
          </View>
          <View style={styles.routeDivider} />
          <View style={styles.routeRow}>
            <View style={styles.dotRed} />
            <View style={{ flex: 1 }}>
              <Text style={styles.routeLabel}>DROPOFF</Text>
              <Text style={styles.routeText}>{ride.dropoffAddress}</Text>
            </View>
          </View>
        </View>

        {/* Fare */}
        <View style={styles.card}>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Fare</Text>
            <Text style={styles.fareAmount}>R{ride.fareActual ?? ride.fareEstimate}</Text>
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareSub}>Payment</Text>
            <Text style={styles.fareSub}>{ride.paymentMethod}</Text>
          </View>
          {ride.distanceKm > 0 ? (
            <View style={styles.fareRow}>
              <Text style={styles.fareSub}>Trip</Text>
              <Text style={styles.fareSub}>
                {ride.distanceKm.toFixed(1)} km
                {ride.durationMinutes ? ` · ${ride.durationMinutes} min` : ""}
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Action button */}
      {!isDone && action && (
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.actionBtn, updating && { opacity: 0.6 }]}
            onPress={advance}
            disabled={updating}
            activeOpacity={0.85}
          >
            {updating ? <ActivityIndicator color="#0f172a" /> : <Text style={styles.actionBtnText}>{action.label}</Text>}
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  map: { height: 240, marginHorizontal: 20, marginTop: 14, borderRadius: 16 },
  navBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginHorizontal: 20, marginTop: 12, marginBottom: 2,
    backgroundColor: "#22c55e", borderRadius: 14, paddingVertical: 14,
  },
  navBtnText: { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  container: { flex: 1, backgroundColor: "#0f172a" },
  loader: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  errorText: { fontSize: 16, color: "#475569" },
  statusBar: {
    backgroundColor: "#22c55e15", borderBottomWidth: 1, borderBottomColor: "#22c55e30",
    paddingVertical: 14, alignItems: "center",
  },
  statusText: { fontSize: 15, fontWeight: "700", color: "#22c55e" },
  card: {
    marginHorizontal: 20, marginTop: 14, backgroundColor: "#1e293b",
    borderRadius: 16, borderWidth: 1, borderColor: "#334155", padding: 16,
  },
  cardTitle: { fontSize: 12, fontWeight: "700", color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 },
  custRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  custAvatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: "#334155",
    alignItems: "center", justifyContent: "center",
  },
  custAvatarText: { fontSize: 18, fontWeight: "800", color: "#cbd5e1" },
  custName: { fontSize: 15, fontWeight: "700", color: "#f8fafc" },
  custPhone: { fontSize: 13, color: "#64748b", marginTop: 2 },
  callBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: "#22c55e20",
    borderWidth: 1, borderColor: "#22c55e40", alignItems: "center", justifyContent: "center",
  },
  routeRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 4 },
  dotGreen: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#22c55e", marginTop: 4 },
  dotRed: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#ef4444", marginTop: 4 },
  routeLabel: { fontSize: 10, fontWeight: "700", color: "#475569", letterSpacing: 0.5 },
  routeText: { fontSize: 14, color: "#f8fafc", marginTop: 2 },
  routeDivider: { height: 1, backgroundColor: "#0f172a", marginVertical: 10, marginLeft: 22 },
  fareRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5 },
  fareLabel: { fontSize: 15, fontWeight: "700", color: "#f8fafc" },
  fareAmount: { fontSize: 20, fontWeight: "800", color: "#22c55e" },
  fareSub: { fontSize: 13, color: "#64748b" },
  footer: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#0f172a", paddingHorizontal: 20, paddingVertical: 16,
    borderTopWidth: 1, borderTopColor: "#1e293b",
  },
  actionBtn: {
    backgroundColor: "#22c55e", borderRadius: 16, paddingVertical: 16, alignItems: "center",
  },
  actionBtnText: { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  homeBtn: { backgroundColor: "#22c55e", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  homeBtnText: { fontSize: 14, fontWeight: "700", color: "#0f172a" },
});
