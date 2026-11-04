import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  ActivityIndicator, Alert, Linking, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { RouteMap } from "@ride/maps-service/native";
import { useAuth } from "@/context/AuthContext";
import { useMapsClient } from "@/hooks/useMapsClient";
import { API_URL } from "@/constants/api";

const STAGES = ["REQUESTED", "ACCEPTED", "DRIVER_ARRIVED", "IN_PROGRESS", "COMPLETED"];

const STAGE_META: Record<string, { label: string; sub: string; icon: string }> = {
  REQUESTED:      { label: "Finding your driver", sub: "Connecting you with a nearby driver…", icon: "search" },
  ACCEPTED:       { label: "Driver on the way",    sub: "Your driver is heading to pickup",     icon: "car" },
  DRIVER_ARRIVED: { label: "Driver has arrived",   sub: "Meet your driver at the pickup point", icon: "location" },
  IN_PROGRESS:    { label: "On your way",          sub: "Enjoy your ride!",                     icon: "navigate" },
  COMPLETED:      { label: "Ride completed",       sub: "Thanks for riding with us",            icon: "checkmark-circle" },
  CANCELLED:      { label: "Ride cancelled",       sub: "This ride was cancelled",              icon: "close-circle" },
};

interface Vehicle { make: string; model: string; color: string; licensePlate: string }
interface RideDriver {
  user: { name: string; phone: string };
  vehicle: Vehicle | null;
  /** Driver's last reported position, used to show them moving on the map. */
  currentLat: number | null;
  currentLng: number | null;
}
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
  driver: RideDriver | null;
}

export default function RideDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { token } = useAuth();
  const mapsClient = useMapsClient();
  const [ride, setRide] = useState<Ride | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [polyline, setPolyline] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const routeFetchedFor = useRef<string | null>(null);

  const fetchRide = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/rides/${id}`);
      const json = await res.json();
      if (json.success) setRide(json.data);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchRide();
    pollRef.current = setInterval(fetchRide, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchRide]);

  useEffect(() => {
    if (ride && (ride.status === "COMPLETED" || ride.status === "CANCELLED") && pollRef.current) {
      clearInterval(pollRef.current);
    }
  }, [ride?.status]);

  /**
   * Fetches the route geometry exactly once per ride.
   *
   * The screen polls every 5 seconds; without the `routeFetchedFor` guard this
   * would bill a Routes call on every poll — around 720 an hour for one open ride,
   * which would burn the entire 10,000/month free tier in half a day. The road
   * between pickup and dropoff does not change while the ride is in progress, so
   * one fetch is correct as well as cheap.
   */
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
      // Cosmetic only — the map falls back to a straight line between the pins.
      .catch(() => setPolyline(null));
  }, [ride, mapsClient]);

  const cancelRide = () => {
    Alert.alert("Cancel ride?", "Are you sure you want to cancel this ride?", [
      { text: "No", style: "cancel" },
      {
        text: "Yes, cancel",
        style: "destructive",
        onPress: async () => {
          setCancelling(true);
          try {
            await fetch(`${API_URL}/api/rides/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: JSON.stringify({ status: "CANCELLED", cancelReason: "Cancelled by customer" }),
            });
            await fetchRide();
          } finally {
            setCancelling(false);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loader}><ActivityIndicator size="large" color="#f59e0b" /></View>
      </SafeAreaView>
    );
  }

  if (!ride) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loader}>
          <Text style={styles.errorText}>Ride not found</Text>
          <TouchableOpacity style={styles.homeBtn} onPress={() => router.replace("/(tabs)")}>
            <Text style={styles.homeBtnText}>Go Home</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const meta = STAGE_META[ride.status] ?? STAGE_META.REQUESTED;
  const currentStageIdx = STAGES.indexOf(ride.status);
  const isCancelled = ride.status === "CANCELLED";
  const canCancel = ride.status === "REQUESTED" || ride.status === "ACCEPTED";

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Live route. Hidden once the ride is over — a finished trip does not need
            a tracking map, and the driver marker would be stale. */}
        {ride.pickupLat && ride.dropoffLat && !isCancelled && ride.status !== "COMPLETED" ? (
          <RouteMap
            style={styles.map}
            pickup={{ lat: ride.pickupLat, lng: ride.pickupLng }}
            dropoff={{ lat: ride.dropoffLat, lng: ride.dropoffLng }}
            polyline={polyline}
            driver={
              ride.driver?.currentLat != null && ride.driver?.currentLng != null
                ? { lat: ride.driver.currentLat, lng: ride.driver.currentLng }
                : null
            }
          />
        ) : null}

        {/* Status hero */}
        <View style={[styles.hero, isCancelled && styles.heroCancelled]}>
          <View style={[styles.heroIcon, isCancelled && { backgroundColor: "#ef444420", borderColor: "#ef444450" }]}>
            <Ionicons name={meta.icon as never} size={32} color={isCancelled ? "#ef4444" : "#f59e0b"} />
          </View>
          <Text style={styles.heroTitle}>{meta.label}</Text>
          <Text style={styles.heroSub}>{meta.sub}</Text>
        </View>

        {/* Progress timeline */}
        {!isCancelled && (
          <View style={styles.timeline}>
            {STAGES.slice(0, 4).map((stage, idx) => {
              const done = idx <= currentStageIdx;
              const active = idx === currentStageIdx;
              return (
                <View key={stage} style={styles.timelineItem}>
                  <View style={[styles.timelineDot, done && styles.timelineDotDone, active && styles.timelineDotActive]}>
                    {done && <Ionicons name="checkmark" size={12} color="#0f172a" />}
                  </View>
                  {idx < 3 && <View style={[styles.timelineLine, done && styles.timelineLineDone]} />}
                </View>
              );
            })}
          </View>
        )}

        {/* Route card */}
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

        {/* Driver card */}
        {ride.driver ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Your Driver</Text>
            <View style={styles.driverRow}>
              <View style={styles.driverAvatar}>
                <Text style={styles.driverAvatarText}>{ride.driver.user.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.driverName}>{ride.driver.user.name}</Text>
                {ride.driver.vehicle && (
                  <Text style={styles.driverVehicle}>
                    {ride.driver.vehicle.color} {ride.driver.vehicle.make} {ride.driver.vehicle.model} · {ride.driver.vehicle.licensePlate}
                  </Text>
                )}
              </View>
              <TouchableOpacity
                style={styles.callBtn}
                onPress={() => Linking.openURL(`tel:${ride.driver?.user.phone}`)}
              >
                <Ionicons name="call" size={18} color="#10b981" />
              </TouchableOpacity>
            </View>
          </View>
        ) : !isCancelled && ride.status === "REQUESTED" ? (
          <View style={styles.card}>
            <View style={styles.searchingRow}>
              <ActivityIndicator color="#f59e0b" />
              <Text style={styles.searchingText}>Searching for a driver nearby…</Text>
            </View>
          </View>
        ) : null}

        {/* Fare card */}
        <View style={styles.card}>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>{ride.fareActual ? "Final fare" : "Estimated fare"}</Text>
            <Text style={styles.fareAmount}>R{ride.fareActual ?? ride.fareEstimate}</Text>
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareSub}>Payment</Text>
            <Text style={styles.fareSub}>{ride.paymentMethod}</Text>
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareSub}>Vehicle</Text>
            <Text style={styles.fareSub}>{ride.vehicleType}</Text>
          </View>
          {/* Real routed figures. Rendered only when present, so an older ride
              booked before routing existed shows nothing rather than "0 km". */}
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

        {/* Actions */}
        {canCancel && (
          <TouchableOpacity style={styles.cancelBtn} onPress={cancelRide} disabled={cancelling}>
            {cancelling ? <ActivityIndicator color="#ef4444" /> : <Text style={styles.cancelBtnText}>Cancel Ride</Text>}
          </TouchableOpacity>
        )}
        {(ride.status === "COMPLETED" || isCancelled) && (
          <TouchableOpacity style={styles.homeBtn} onPress={() => router.replace("/(tabs)")}>
            <Text style={styles.homeBtnText}>Back to Home</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  loader: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  errorText: { fontSize: 16, color: "#475569" },
  map: { height: 220, marginHorizontal: 20, marginTop: 16, borderRadius: 16 },
  hero: { alignItems: "center", paddingVertical: 28, gap: 8 },
  heroCancelled: {},
  heroIcon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: "#f59e0b20",
    borderWidth: 2, borderColor: "#f59e0b50", alignItems: "center", justifyContent: "center", marginBottom: 6,
  },
  heroTitle: { fontSize: 20, fontWeight: "800", color: "#f8fafc" },
  heroSub: { fontSize: 14, color: "#64748b", textAlign: "center", paddingHorizontal: 40 },
  timeline: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 40, marginBottom: 20 },
  timelineItem: { flexDirection: "row", alignItems: "center" },
  timelineDot: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: "#1e293b",
    borderWidth: 2, borderColor: "#334155", alignItems: "center", justifyContent: "center",
  },
  timelineDotDone: { backgroundColor: "#f59e0b", borderColor: "#f59e0b" },
  timelineDotActive: { borderColor: "#f59e0b", backgroundColor: "#f59e0b" },
  timelineLine: { width: 40, height: 2, backgroundColor: "#334155" },
  timelineLineDone: { backgroundColor: "#f59e0b" },
  card: {
    marginHorizontal: 20, marginBottom: 14, backgroundColor: "#1e293b",
    borderRadius: 16, borderWidth: 1, borderColor: "#334155", padding: 16,
  },
  cardTitle: { fontSize: 13, fontWeight: "700", color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 },
  routeRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 4 },
  dotGreen: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#10b981", marginTop: 4 },
  dotRed: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#ef4444", marginTop: 4 },
  routeLabel: { fontSize: 10, fontWeight: "700", color: "#475569", letterSpacing: 0.5 },
  routeText: { fontSize: 14, color: "#f8fafc", marginTop: 2 },
  routeDivider: { height: 1, backgroundColor: "#0f172a", marginVertical: 10, marginLeft: 22 },
  driverRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  driverAvatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: "#f59e0b20",
    borderWidth: 1, borderColor: "#f59e0b40", alignItems: "center", justifyContent: "center",
  },
  driverAvatarText: { fontSize: 18, fontWeight: "800", color: "#f59e0b" },
  driverName: { fontSize: 15, fontWeight: "700", color: "#f8fafc" },
  driverVehicle: { fontSize: 12, color: "#64748b", marginTop: 2 },
  callBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: "#10b98120",
    borderWidth: 1, borderColor: "#10b98140", alignItems: "center", justifyContent: "center",
  },
  searchingRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  searchingText: { fontSize: 14, color: "#94a3b8" },
  fareRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5 },
  fareLabel: { fontSize: 15, fontWeight: "700", color: "#f8fafc" },
  fareAmount: { fontSize: 20, fontWeight: "800", color: "#f59e0b" },
  fareSub: { fontSize: 13, color: "#64748b" },
  cancelBtn: {
    marginHorizontal: 20, marginTop: 6, borderRadius: 14, paddingVertical: 15,
    borderWidth: 1, borderColor: "#ef444450", alignItems: "center",
  },
  cancelBtnText: { fontSize: 15, fontWeight: "700", color: "#ef4444" },
  homeBtn: {
    marginHorizontal: 20, marginTop: 6, borderRadius: 14, paddingVertical: 15,
    backgroundColor: "#f59e0b", alignItems: "center",
  },
  homeBtnText: { fontSize: 15, fontWeight: "800", color: "#0f172a" },
});
