import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Switch,
  ScrollView, ActivityIndicator, RefreshControl, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { API_URL } from "@/constants/api";

interface DriverProfile {
  id: string;
  isOnline: boolean;
  isApproved: boolean;
  rating: number;
  totalRides: number;
  user: { name: string; phone: string };
  vehicle: { make: string; model: string; color: string; licensePlate: string } | null;
}

interface AvailableRide {
  id: string;
  pickupAddress: string;
  dropoffAddress: string;
  fareEstimate: number;
  vehicleType: string;
  status: string;
  customer: { name: string; phone: string };
}

export default function DriverDashboard() {
  const router = useRouter();
  const { user, token } = useAuth();
  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [rides, setRides] = useState<AvailableRide[]>([]);
  const [activeRide, setActiveRide] = useState<AvailableRide | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;

  const fetchDriver = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/drivers/me`, { headers: authHeaders });
      const json = await res.json();
      if (json.success) setDriver(json.data);
    } catch {
      setDriver(null);
    }
  }, [token]);

  const fetchRides = useCallback(async () => {
    if (!token) return;
    try {
      // Active ride this driver is already handling
      const activeRes = await fetch(`${API_URL}/api/rides?active=true`, { headers: authHeaders });
      const activeJson = await activeRes.json();
      const mine: AvailableRide[] = (activeJson.data?.items ?? []).filter(
        (r: AvailableRide) => r.status !== "REQUESTED"
      );
      setActiveRide(mine[0] ?? null);

      // Available unassigned requests
      const res = await fetch(`${API_URL}/api/rides/available`, { headers: authHeaders });
      const json = await res.json();
      if (json.success) setRides(json.data);
    } catch {
      setRides([]);
    }
  }, [token]);

  const loadAll = useCallback(async () => {
    await Promise.all([fetchDriver(), fetchRides()]);
    setLoading(false);
  }, [fetchDriver, fetchRides]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Poll for new requests while online.
  useEffect(() => {
    if (driver?.isOnline) {
      pollRef.current = setInterval(fetchRides, 6000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
  }, [driver?.isOnline, fetchRides]);

  const toggleOnline = async (value: boolean) => {
    if (!driver) return;
    setToggling(true);
    setDriver({ ...driver, isOnline: value });
    try {
      await fetch(`${API_URL}/api/drivers/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ isOnline: value }),
      });
      if (value) fetchRides();
    } catch {
      setDriver({ ...driver, isOnline: !value });
    } finally {
      setToggling(false);
    }
  };

  const acceptRide = async (rideId: string) => {
    try {
      const res = await fetch(`${API_URL}/api/rides/${rideId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ status: "ACCEPTED" }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed");
      router.push({ pathname: "/ride/[id]", params: { id: rideId } });
    } catch (e: unknown) {
      Alert.alert("Could not accept", e instanceof Error ? e.message : "Try again");
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loader}><ActivityIndicator size="large" color="#22c55e" /></View>
      </SafeAreaView>
    );
  }

  const notDriver = !driver;
  const isOnline = driver?.isOnline ?? false;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22c55e" />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Hi, {user?.name ?? "Driver"}</Text>
            <Text style={styles.sub}>{driver?.vehicle ? `${driver.vehicle.color} ${driver.vehicle.make} ${driver.vehicle.model}` : "Manage your rides & status"}</Text>
          </View>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user?.name?.charAt(0).toUpperCase() ?? "D"}</Text>
          </View>
        </View>

        {notDriver ? (
          <View style={styles.notDriverCard}>
            <Ionicons name="alert-circle-outline" size={40} color="#f59e0b" />
            <Text style={styles.notDriverTitle}>Not a registered driver</Text>
            <Text style={styles.notDriverSub}>This account isn't set up as a driver yet. Sign in with the demo driver number (+27 82 000 0002).</Text>
          </View>
        ) : (
          <>
            {/* Online Toggle */}
            <View style={[styles.onlineCard, isOnline && styles.onlineCardActive]}>
              <View style={styles.onlineLeft}>
                <View style={[styles.statusDot, isOnline && styles.statusDotActive]} />
                <View>
                  <Text style={styles.onlineTitle}>{isOnline ? "You are ONLINE" : "You are OFFLINE"}</Text>
                  <Text style={styles.onlineSub}>
                    {isOnline ? "Waiting for ride requests..." : "Go online to start accepting rides"}
                  </Text>
                </View>
              </View>
              <Switch
                value={isOnline}
                onValueChange={toggleOnline}
                disabled={toggling}
                trackColor={{ false: "#334155", true: "#22c55e40" }}
                thumbColor={isOnline ? "#22c55e" : "#64748b"}
              />
            </View>

            {/* Today's Stats */}
            <Text style={styles.sectionTitle}>Your Stats</Text>
            <View style={styles.statsGrid}>
              {[
                { label: "Total Rides", value: String(driver?.totalRides ?? 0), icon: "car", color: "#22c55e" },
                { label: "Rating", value: driver?.rating ? driver.rating.toFixed(1) : "—", icon: "star", color: "#f59e0b" },
                { label: "Status", value: driver?.isApproved ? "✓" : "Pending", icon: "shield-checkmark", color: "#3b82f6" },
              ].map((stat) => (
                <View key={stat.label} style={styles.statCard}>
                  <Ionicons name={stat.icon as never} size={20} color={stat.color} />
                  <Text style={styles.statValue}>{stat.value}</Text>
                  <Text style={styles.statLabel}>{stat.label}</Text>
                </View>
              ))}
            </View>

            {/* Active ride */}
            {activeRide && (
              <>
                <Text style={styles.sectionTitle}>Current Trip</Text>
                <TouchableOpacity
                  style={styles.activeCard}
                  activeOpacity={0.85}
                  onPress={() => router.push({ pathname: "/ride/[id]", params: { id: activeRide.id } })}
                >
                  <View style={styles.activeTop}>
                    <View style={styles.activeBadge}><Text style={styles.activeBadgeText}>IN PROGRESS</Text></View>
                    <Text style={styles.activeFare}>R{activeRide.fareEstimate}</Text>
                  </View>
                  <Text style={styles.activeRoute} numberOfLines={1}>→ {activeRide.dropoffAddress}</Text>
                  <Text style={styles.activeCustomer}>{activeRide.customer.name}</Text>
                </TouchableOpacity>
              </>
            )}

            {/* Ride Requests */}
            <Text style={styles.sectionTitle}>Ride Requests</Text>
            {!isOnline ? (
              <View style={styles.emptyRequests}>
                <Ionicons name="car-outline" size={48} color="#334155" />
                <Text style={styles.offlineText}>Go online to see requests</Text>
              </View>
            ) : rides.length === 0 ? (
              <View style={styles.emptyRequests}>
                <View style={styles.pulseDot} />
                <Text style={styles.waitingText}>Waiting for requests...</Text>
                <Text style={styles.waitingSub}>New ride requests will appear here</Text>
              </View>
            ) : (
              rides.map((ride) => (
                <View key={ride.id} style={styles.requestCard}>
                  <View style={styles.requestTop}>
                    <View style={styles.requestCustomer}>
                      <View style={styles.custAvatar}>
                        <Text style={styles.custAvatarText}>{ride.customer.name.charAt(0).toUpperCase()}</Text>
                      </View>
                      <View>
                        <Text style={styles.custName}>{ride.customer.name}</Text>
                        <Text style={styles.vehicleTag}>{ride.vehicleType}</Text>
                      </View>
                    </View>
                    <Text style={styles.requestFare}>R{ride.fareEstimate}</Text>
                  </View>
                  <View style={styles.routeBlock}>
                    <View style={styles.routeRow}>
                      <View style={styles.dotGreen} />
                      <Text style={styles.routeText} numberOfLines={1}>{ride.pickupAddress}</Text>
                    </View>
                    <View style={styles.routeRow}>
                      <View style={styles.dotRed} />
                      <Text style={styles.routeText} numberOfLines={1}>{ride.dropoffAddress}</Text>
                    </View>
                  </View>
                  <TouchableOpacity style={styles.acceptBtn} onPress={() => acceptRide(ride.id)} activeOpacity={0.85}>
                    <Text style={styles.acceptBtnText}>Accept Ride</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  greeting: { fontSize: 20, fontWeight: "700", color: "#f8fafc" },
  sub: { fontSize: 13, color: "#64748b", marginTop: 2 },
  loader: { flex: 1, alignItems: "center", justifyContent: "center" },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#22c55e20",
    borderWidth: 1,
    borderColor: "#22c55e40",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 16, fontWeight: "800", color: "#22c55e" },
  notDriverCard: {
    margin: 20, padding: 24, backgroundColor: "#1e293b", borderRadius: 16,
    borderWidth: 1, borderColor: "#334155", alignItems: "center", gap: 8,
  },
  notDriverTitle: { fontSize: 16, fontWeight: "700", color: "#f8fafc" },
  notDriverSub: { fontSize: 13, color: "#64748b", textAlign: "center", lineHeight: 19 },
  onlineCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1e293b",
    marginHorizontal: 20,
    marginTop: 16,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  onlineCardActive: { borderColor: "#22c55e60", backgroundColor: "#22c55e08" },
  onlineLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#475569",
  },
  statusDotActive: { backgroundColor: "#22c55e" },
  onlineTitle: { fontSize: 15, fontWeight: "700", color: "#f8fafc" },
  onlineSub: { fontSize: 12, color: "#64748b", marginTop: 2 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#f8fafc",
    paddingHorizontal: 20,
    marginTop: 20,
    marginBottom: 12,
  },
  statsGrid: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#1e293b",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#334155",
  },
  statValue: { fontSize: 18, fontWeight: "700", color: "#f8fafc" },
  statLabel: { fontSize: 11, color: "#64748b" },
  emptyRequests: {
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 20,
    paddingVertical: 40,
    backgroundColor: "#1e293b",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    gap: 8,
  },
  pulseDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#22c55e",
  },
  waitingText: { fontSize: 15, fontWeight: "600", color: "#cbd5e1" },
  waitingSub: { fontSize: 12, color: "#475569" },
  offlineText: { fontSize: 14, color: "#475569" },
  activeCard: {
    marginHorizontal: 20, backgroundColor: "#22c55e10", borderRadius: 16,
    borderWidth: 1, borderColor: "#22c55e40", padding: 16, gap: 6,
  },
  activeTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  activeBadge: { backgroundColor: "#22c55e20", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  activeBadgeText: { fontSize: 11, fontWeight: "700", color: "#22c55e" },
  activeFare: { fontSize: 18, fontWeight: "800", color: "#22c55e" },
  activeRoute: { fontSize: 14, color: "#f8fafc", fontWeight: "600" },
  activeCustomer: { fontSize: 12, color: "#64748b" },
  requestCard: {
    marginHorizontal: 20, marginBottom: 12, backgroundColor: "#1e293b", borderRadius: 16,
    borderWidth: 1, borderColor: "#334155", padding: 16, gap: 12,
  },
  requestTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  requestCustomer: { flexDirection: "row", alignItems: "center", gap: 10 },
  custAvatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: "#334155",
    alignItems: "center", justifyContent: "center",
  },
  custAvatarText: { fontSize: 16, fontWeight: "800", color: "#cbd5e1" },
  custName: { fontSize: 14, fontWeight: "700", color: "#f8fafc" },
  vehicleTag: { fontSize: 11, color: "#64748b", marginTop: 2 },
  requestFare: { fontSize: 20, fontWeight: "800", color: "#22c55e" },
  routeBlock: { gap: 8 },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dotGreen: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#22c55e" },
  dotRed: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#ef4444" },
  routeText: { flex: 1, fontSize: 13, color: "#cbd5e1" },
  acceptBtn: { backgroundColor: "#22c55e", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  acceptBtnText: { fontSize: 15, fontWeight: "800", color: "#0f172a" },
});
