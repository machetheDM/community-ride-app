import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView,
  RefreshControl, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { API_URL } from "@/constants/api";

const QUICK_ACTIONS = [
  { id: "ride",     label: "Book a Ride", icon: "car",        color: "#f59e0b", bg: "#f59e0b20", route: "/ride/book" },
  { id: "food",     label: "Order Food",  icon: "fast-food",  color: "#3b82f6", bg: "#3b82f620", route: "/(tabs)/stores" },
  { id: "grocery",  label: "Groceries",   icon: "basket",     color: "#10b981", bg: "#10b98120", route: "/(tabs)/stores" },
  { id: "orders",   label: "My Orders",   icon: "bag-handle", color: "#8b5cf6", bg: "#8b5cf620", route: "/(tabs)/orders" },
];

const RIDE_STATUS_LABEL: Record<string, string> = {
  REQUESTED:      "Looking for a driver…",
  ACCEPTED:       "Driver accepted your ride",
  DRIVER_ARRIVED: "Driver has arrived!",
  IN_PROGRESS:    "Ride in progress",
};

interface ActiveRide {
  id: string;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  fareEstimate: number;
  driver?: { user: { name: string } } | null;
}

export default function HomeScreen() {
  const router = useRouter();
  const { user, token } = useAuth();
  const [activeRide, setActiveRide] = useState<ActiveRide | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  };

  const fetchActiveRide = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/rides?active=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      const rides: ActiveRide[] = json.data?.items ?? [];
      setActiveRide(rides[0] ?? null);
    } catch {
      setActiveRide(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchActiveRide(); }, [fetchActiveRide]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchActiveRide();
    setRefreshing(false);
  }, [fetchActiveRide]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#f59e0b" />
          <Text style={styles.loaderText}>Loading your ride…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f59e0b" />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{getGreeting()} 👋</Text>
            <Text style={styles.subGreeting}>{user?.name ?? "Welcome back"}</Text>
          </View>
          <TouchableOpacity style={styles.avatar} onPress={() => router.push("/(tabs)/profile" as never)}>
            <Text style={styles.avatarText}>{user?.name?.charAt(0).toUpperCase() ?? "?"}</Text>
          </TouchableOpacity>
        </View>

        {/* Search Bar */}
        <TouchableOpacity style={styles.searchBar} onPress={() => router.push("/ride/book" as never)} activeOpacity={0.8}>
          <Ionicons name="search" size={18} color="#64748b" />
          <Text style={styles.searchPlaceholder}>Search destination or store...</Text>
        </TouchableOpacity>

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.quickActionsGrid}>
          {QUICK_ACTIONS.map((action) => (
            <TouchableOpacity
              key={action.id}
              style={[styles.actionCard, { backgroundColor: action.bg, borderColor: action.color + "40" }]}
              activeOpacity={0.75}
              onPress={() => router.push(action.route as never)}
            >
              <Ionicons name={action.icon as never} size={28} color={action.color} />
              <Text style={[styles.actionLabel, { color: action.color }]}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Active Ride Banner */}
        {activeRide ? (
          <TouchableOpacity
            style={[styles.activeBanner, styles.activeBannerLive]}
            activeOpacity={0.85}
            onPress={() => router.push({ pathname: "/ride/[id]", params: { id: activeRide.id } })}
          >
            <View style={styles.activeBannerLeft}>
              <View style={styles.activeDotLive} />
              <View style={{ flex: 1 }}>
                <Text style={styles.activeBannerTitle}>
                  {RIDE_STATUS_LABEL[activeRide.status] ?? activeRide.status}
                </Text>
                <Text style={styles.activeBannerSub} numberOfLines={1}>
                  To: {activeRide.dropoffAddress}
                </Text>
                {activeRide.driver && (
                  <Text style={styles.activeBannerDriver}>Driver: {activeRide.driver.user.name}</Text>
                )}
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#f59e0b" />
          </TouchableOpacity>
        ) : (
          <View style={styles.activeBanner}>
            <View style={styles.activeBannerLeft}>
              <View style={styles.activeDot} />
              <View>
                <Text style={styles.activeBannerTitle}>No active ride</Text>
                <Text style={styles.activeBannerSub}>Book a ride to get started</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.bookNowBtn} onPress={() => router.push("/ride/book" as never)}>
              <Text style={styles.bookNowText}>Book Now</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Nearby Stores */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Nearby Stores</Text>
          <TouchableOpacity onPress={() => router.push("/(tabs)/stores" as never)}>
            <Text style={styles.seeAll}>See all</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.emptyStores}>
          <Ionicons name="storefront-outline" size={40} color="#334155" />
          <Text style={styles.emptyText}>Pull down to refresh</Text>
          <Text style={styles.emptySubText}>Or tap See all to browse stores</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  loader: { flex: 1, alignItems: "center", justifyContent: "center" },
  loaderText: { marginTop: 16, color: "#94a3b8", fontSize: 14 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  greeting: { fontSize: 22, fontWeight: "700", color: "#f8fafc" },
  subGreeting: { fontSize: 14, color: "#64748b", marginTop: 2 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#f59e0b20",
    borderWidth: 1,
    borderColor: "#f59e0b40",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 16, fontWeight: "800", color: "#f59e0b" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#1e293b",
    marginHorizontal: 20,
    marginVertical: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },
  searchPlaceholder: { color: "#475569", fontSize: 14, flex: 1 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#f8fafc",
    paddingHorizontal: 20,
    marginTop: 16,
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingRight: 20,
  },
  seeAll: { fontSize: 13, color: "#f59e0b", fontWeight: "600" },
  quickActionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 16,
    gap: 10,
  },
  actionCard: {
    width: "47%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 20,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
  },
  actionLabel: { fontSize: 13, fontWeight: "600" },
  activeBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1e293b",
    marginHorizontal: 20,
    marginTop: 20,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#334155",
  },
  activeBannerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  activeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#475569" },
  activeDotLive: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#10b981" },
  activeBannerLive: { borderColor: "#10b98140", backgroundColor: "#10b98108" },
  activeBannerTitle: { fontSize: 14, fontWeight: "600", color: "#cbd5e1" },
  activeBannerSub: { fontSize: 12, color: "#475569", marginTop: 2 },
  activeBannerDriver: { fontSize: 11, color: "#10b981", marginTop: 2 },
  bookNowBtn: {
    backgroundColor: "#f59e0b",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  bookNowText: { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  emptyStores: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 8,
  },
  emptyText: { fontSize: 15, color: "#475569", fontWeight: "600" },
  emptySubText: { fontSize: 12, color: "#334155" },
});
