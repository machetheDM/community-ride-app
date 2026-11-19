import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/request";
import { positionMessage, useReportPosition } from "@/hooks/useReportPosition";

interface RiderProfile {
  id: string;
  isOnline: boolean;
  isApproved: boolean;
  rating: number;
  totalDeliveries: number;
  user: { name: string };
  vehicle: { type: string; make: string; model: string; color: string; licensePlate: string; isApproved: boolean } | null;
}

/** A waiting delivery: the store, a suburb and distances. Nothing about the customer until it is accepted. */
interface AvailableDelivery {
  id: string;
  orderStatus: string;
  store: { name: string; address: string; complex: string | null };
  distanceToStoreKm: number;
  dropoffArea: string | null;
  storeToDropoffKm: number | null;
  itemCount: number;
  deliveryFee: string | number;
}

interface MyOrder {
  id: string;
  status: string;
  deliveryAddress: string;
  store: { name: string };
  delivery: { id: string; status: string } | null;
}

const ACTIVE = ["ASSIGNED", "PICKED_UP", "EN_ROUTE"];

const JOB_STAGE: Record<string, string> = {
  ASSIGNED: "Go to the store",
  PICKED_UP: "Collected",
  EN_ROUTE: "On the way to the customer",
};

/** What the store has done with the order, so a rider knows whether it will be waiting for them. */
const STORE_STAGE: Record<string, string> = {
  CONFIRMED: "Store has accepted it",
  PREPARING: "Being prepared",
  READY_FOR_PICKUP: "Ready to collect",
};

/**
 * The scooter rider's home (docs/PLAN.md Phase 2.3): go online, see deliveries
 * near you, take one. Shown in place of the driver's dashboard when the signed-in
 * operator is a rider.
 */
export function RiderHome() {
  const router = useRouter();
  const { user, token } = useAuth();
  const [rider, setRider] = useState<RiderProfile | null>(null);
  const [jobs, setJobs] = useState<AvailableDelivery[]>([]);
  const [active, setActive] = useState<MyOrder | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);

  const online = Boolean(rider?.isOnline);
  const { state: positionState } = useReportPosition("/api/riders/me", token, online);

  const loadRider = useCallback(async () => {
    const res = await api<RiderProfile>(token, "/api/riders/me");
    setRider(res.ok ? res.data : null);
    return res.ok ? res.data : null;
  }, [token]);

  const loadWork = useCallback(
    async (isOnline: boolean) => {
      const mine = await api<{ items: MyOrder[] }>(token, "/api/orders?pageSize=20");
      const current = mine.data?.items.find((o) => o.delivery && ACTIVE.includes(o.delivery.status)) ?? null;
      setActive(current);

      if (!isOnline || current) {
        setJobs([]);
        setNotice(null);
        return;
      }
      const list = await api<AvailableDelivery[]>(token, "/api/deliveries/available");
      setJobs(list.ok ? (list.data ?? []) : []);
      // 403 and 409 carry the reason (not approved yet, no location yet); show it as it is.
      setNotice(list.ok ? null : list.error);
    },
    [token]
  );

  const loadAll = useCallback(async () => {
    const profile = await loadRider();
    await loadWork(Boolean(profile?.isOnline));
    setLoading(false);
  }, [loadRider, loadWork]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Refresh while online. A push arrives when a store confirms an order nearby;
  // this covers a phone with notifications off.
  useEffect(() => {
    if (!online) return;
    const timer = setInterval(() => void loadWork(true), 8000);
    return () => clearInterval(timer);
  }, [online, loadWork]);

  const toggleOnline = async (value: boolean) => {
    if (!rider) return;
    setToggling(true);
    const res = await api<RiderProfile>(token, "/api/riders/me", { method: "PATCH", body: { isOnline: value } });
    setToggling(false);
    if (!res.ok || !res.data) {
      Alert.alert(value ? "You cannot go online yet" : "Could not go offline", res.error ?? "Try again.");
      return;
    }
    setRider(res.data);
    await loadWork(res.data.isOnline);
  };

  const accept = async (deliveryId: string) => {
    setAccepting(deliveryId);
    const res = await api<{ id: string }>(token, `/api/deliveries/${deliveryId}/accept`, { method: "POST" });
    setAccepting(null);
    if (!res.ok || !res.data) {
      Alert.alert("Could not take this delivery", res.error ?? "Try again.");
      await loadWork(true);
      return;
    }
    // Cast: expo-router's generated route types are a local, uncommitted file.
    router.push(`/delivery/${res.data.id}` as never);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={styles.loader} color="#22c55e" />
      </SafeAreaView>
    );
  }

  const locationNote = online ? positionMessage(positionState) : null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor="#22c55e"
            onRefresh={async () => {
              setRefreshing(true);
              await loadAll();
              setRefreshing(false);
            }}
          />
        }
        contentContainerStyle={styles.scroll}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Hi, {(rider?.user.name ?? user?.name ?? "Rider").split(" ")[0]}</Text>
            <Text style={styles.sub}>
              {rider?.vehicle
                ? `${rider.vehicle.color} ${rider.vehicle.make} ${rider.vehicle.model} · ${rider.vehicle.licensePlate}`
                : "Scooter deliveries"}
            </Text>
          </View>
          <View style={styles.statPill}>
            <Ionicons name="bicycle" size={14} color="#22c55e" />
            <Text style={styles.statPillText}>{rider?.totalDeliveries ?? 0} delivered</Text>
          </View>
        </View>

        {!rider ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>No rider profile yet</Text>
            <Text style={styles.cardSub}>
              This number is not registered as a scooter rider. Ask the platform admin to set you up.
            </Text>
          </View>
        ) : (
          <>
            <View style={[styles.onlineCard, online && styles.onlineCardActive]}>
              <View style={styles.onlineLeft}>
                <View style={[styles.dot, online && styles.dotActive]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.onlineTitle}>{online ? "You are online" : "You are offline"}</Text>
                  <Text style={styles.cardSub}>
                    {online ? "Deliveries near you will appear below" : "Go online to see deliveries near you"}
                  </Text>
                </View>
              </View>
              <Switch
                value={online}
                onValueChange={toggleOnline}
                disabled={toggling}
                trackColor={{ false: "#334155", true: "#22c55e80" }}
                thumbColor={online ? "#22c55e" : "#94a3b8"}
              />
            </View>

            {locationNote ? (
              <View style={styles.warning}>
                <Ionicons name="location-outline" size={16} color="#f59e0b" />
                <Text style={styles.warningText}>{locationNote}</Text>
              </View>
            ) : null}

            {active?.delivery ? (
              <>
                <Text style={styles.sectionTitle}>Your delivery</Text>
                <TouchableOpacity
                  style={styles.activeCard}
                  activeOpacity={0.85}
                  onPress={() => router.push(`/delivery/${active.id}` as never)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.activeStage}>{JOB_STAGE[active.delivery.status] ?? active.delivery.status}</Text>
                    <Text style={styles.cardTitle} numberOfLines={1}>{active.store.name}</Text>
                    <Text style={styles.cardSub} numberOfLines={1}>→ {active.deliveryAddress}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#22c55e" />
                </TouchableOpacity>
              </>
            ) : online ? (
              <>
                <Text style={styles.sectionTitle}>Deliveries near you</Text>
                {notice ? (
                  <View style={styles.card}>
                    <Text style={styles.cardSub}>{notice}</Text>
                  </View>
                ) : jobs.length === 0 ? (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Nothing waiting right now</Text>
                    <Text style={styles.cardSub}>
                      New deliveries within 10 km appear here, and you get a notification when a store confirms one.
                    </Text>
                  </View>
                ) : (
                  jobs.map((job) => (
                    <View key={job.id} style={styles.jobCard}>
                      <View style={styles.jobTop}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.cardTitle} numberOfLines={1}>{job.store.name}</Text>
                          <Text style={styles.cardSub} numberOfLines={1}>
                            {job.store.complex ? `${job.store.complex} · ` : ""}{job.store.address}
                          </Text>
                        </View>
                        <Text style={styles.fee}>R{Number(job.deliveryFee).toFixed(2)}</Text>
                      </View>
                      <View style={styles.jobFacts}>
                        <Text style={styles.fact}>{job.distanceToStoreKm} km to the store</Text>
                        <Text style={styles.fact}>
                          {job.dropoffArea ?? "Drop-off area not shown"}
                          {job.storeToDropoffKm !== null ? ` · about ${job.storeToDropoffKm} km` : ""}
                        </Text>
                        <Text style={styles.fact}>
                          {job.itemCount} item{job.itemCount === 1 ? "" : "s"} · {STORE_STAGE[job.orderStatus] ?? job.orderStatus}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.acceptBtn, accepting === job.id && styles.acceptBtnBusy]}
                        disabled={accepting !== null}
                        onPress={() => accept(job.id)}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.acceptText}>{accepting === job.id ? "Taking it…" : "Take this delivery"}</Text>
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  scroll: { paddingBottom: 32 },
  loader: { flex: 1 },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingTop: 16,
  },
  greeting: { fontSize: 20, fontWeight: "700", color: "#f8fafc" },
  sub: { fontSize: 13, color: "#64748b", marginTop: 2 },
  statPill: {
    flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#22c55e15",
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
  },
  statPillText: { color: "#22c55e", fontSize: 12, fontWeight: "600" },
  card: {
    marginHorizontal: 20, marginTop: 12, padding: 18, backgroundColor: "#1e293b",
    borderRadius: 16, borderWidth: 1, borderColor: "#334155", gap: 6,
  },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#f8fafc" },
  cardSub: { fontSize: 13, color: "#94a3b8", lineHeight: 19 },
  onlineCard: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#1e293b", marginHorizontal: 20, marginTop: 16, padding: 18,
    borderRadius: 16, borderWidth: 1, borderColor: "#334155",
  },
  onlineCardActive: { borderColor: "#22c55e60", backgroundColor: "#22c55e08" },
  onlineLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  onlineTitle: { fontSize: 15, fontWeight: "700", color: "#f8fafc" },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: "#475569" },
  dotActive: { backgroundColor: "#22c55e" },
  warning: {
    flexDirection: "row", gap: 8, alignItems: "flex-start", marginHorizontal: 20, marginTop: 12,
    padding: 12, borderRadius: 12, backgroundColor: "#f59e0b12", borderWidth: 1, borderColor: "#f59e0b40",
  },
  warningText: { flex: 1, color: "#fbbf24", fontSize: 13, lineHeight: 18 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: "#f8fafc", marginHorizontal: 20, marginTop: 24 },
  activeCard: {
    flexDirection: "row", alignItems: "center", marginHorizontal: 20, marginTop: 12, padding: 18,
    backgroundColor: "#22c55e10", borderRadius: 16, borderWidth: 1, borderColor: "#22c55e60",
  },
  activeStage: { color: "#22c55e", fontSize: 12, fontWeight: "700", marginBottom: 4 },
  jobCard: {
    marginHorizontal: 20, marginTop: 12, padding: 16, backgroundColor: "#1e293b",
    borderRadius: 16, borderWidth: 1, borderColor: "#334155",
  },
  jobTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  fee: { color: "#22c55e", fontSize: 18, fontWeight: "800" },
  jobFacts: { marginTop: 10, gap: 4 },
  fact: { color: "#cbd5e1", fontSize: 13 },
  acceptBtn: {
    marginTop: 14, backgroundColor: "#22c55e", borderRadius: 12, paddingVertical: 12, alignItems: "center",
  },
  acceptBtnBusy: { opacity: 0.6 },
  acceptText: { color: "#052e16", fontSize: 15, fontWeight: "700" },
});
