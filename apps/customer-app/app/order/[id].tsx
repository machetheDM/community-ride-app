import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { RouteMap } from "@ride/maps-service/native";
import { useAuth } from "@/context/AuthContext";
import { API_URL } from "@/constants/api";

/** The order as its customer sees it (GET /api/orders/{id}). */
interface CustomerOrder {
  id: string;
  status: string;
  subtotal: string;
  deliveryFee: string;
  total: string;
  deliveryAddress: string;
  deliveryLat: number;
  deliveryLng: number;
  paymentMethod: string;
  cancelReason: string | null;
  createdAt: string;
  store: { name: string; address: string; complex: string | null };
  items: { id: string; quantity: number; totalPrice: string; product: { name: string } }[];
  delivery: {
    id: string;
    status: string;
    /** The customer's own code, until the delivery is over. Nobody else is sent it. */
    handoverCode?: string | null;
    rider: {
      name: string;
      vehicle?: { type: string; color: string; licensePlate: string } | null;
      /** Only between pickup and handover. */
      location?: { lat: number; lng: number } | null;
    } | null;
  } | null;
}

const STEPS = ["PENDING", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY", "DELIVERED"] as const;

const STEP_LABEL: Record<string, string> = {
  PENDING: "Order placed",
  CONFIRMED: "Store accepted it",
  PREPARING: "Being prepared",
  READY_FOR_PICKUP: "Ready for the rider",
  OUT_FOR_DELIVERY: "On the way",
  DELIVERED: "Delivered",
};

function headline(order: CustomerOrder): string {
  if (order.status === "CANCELLED") return "Order cancelled";
  if (order.delivery?.status === "FAILED") return "We could not deliver this order";
  if (order.delivery?.status === "EN_ROUTE") return "Your rider is on the way";
  if (order.delivery?.status === "PICKED_UP") return "Your rider has your order";
  if (order.delivery?.status === "ASSIGNED" && order.status !== "DELIVERED") {
    return `${STEP_LABEL[order.status] ?? order.status} · a rider is assigned`;
  }
  return STEP_LABEL[order.status] ?? order.status;
}

/** Straight-line km between two points, for "about 1.2 km away". */
function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.sin(rad(b.lng - a.lng) / 2) ** 2 * Math.cos(rad(a.lat)) * Math.cos(rad(b.lat));
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * One order, followed to the door (docs/PLAN.md Phase 2.5 and 2.6): where it is
 * in the store, who is bringing it, where they are once they have it, and the
 * code to give them. The code is what makes "delivered" mean the customer has
 * the order, so it is shown large and explained.
 */
export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/orders/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const json = await res.json();
      if (json.success) setOrder(json.data);
    } catch {
      // Keep what is on screen; the next refresh tries again.
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const finished =
    order?.status === "DELIVERED" || order?.status === "CANCELLED" || order?.delivery?.status === "FAILED";

  useEffect(() => {
    if (!order || finished) return;
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [order, finished, load]);

  const cancel = () => {
    Alert.alert("Cancel this order?", "The store has not accepted it yet, so it can still be cancelled.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Cancel order",
        style: "destructive",
        onPress: async () => {
          setCancelling(true);
          try {
            const res = await fetch(`${API_URL}/api/orders/${id}/status`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: JSON.stringify({ status: "CANCELLED" }),
            });
            const json = await res.json();
            if (!res.ok || !json.success) Alert.alert("Could not cancel", json.error ?? "Try again.");
          } catch {
            Alert.alert("Could not cancel", "No connection. Try again.");
          } finally {
            setCancelling(false);
            await load();
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={{ flex: 1 }} color="#f59e0b" />
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Order not found</Text>
          <Text style={styles.muted}>Check your connection and open it again from My Orders.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const delivery = order.delivery;
  const rider = delivery?.rider ?? null;
  const riderAt = rider?.location ?? null;
  const dropoff =
    order.deliveryLat && order.deliveryLng ? { lat: order.deliveryLat, lng: order.deliveryLng } : null;
  const stepIndex = STEPS.indexOf(order.status as (typeof STEPS)[number]);
  const cancelled = order.status === "CANCELLED";

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.statusBar, cancelled && styles.statusBarOff]}>
          <Text style={[styles.statusTitle, cancelled && styles.statusTitleOff]}>{headline(order)}</Text>
          <Text style={styles.muted}>
            {order.store.name}
            {order.store.complex ? ` · ${order.store.complex}` : ""}
          </Text>
          {cancelled && order.cancelReason ? <Text style={styles.muted}>Reason: {order.cancelReason}</Text> : null}
        </View>

        {/* The code: what the rider needs from you at the door. */}
        {delivery?.handoverCode ? (
          <View style={styles.codeCard}>
            <Text style={styles.label}>Your delivery code</Text>
            <Text style={styles.code} testID="handover-code">
              {delivery.handoverCode.split("").join(" ")}
            </Text>
            <Text style={styles.muted}>
              Give this code to the rider when your order is in your hands. They cannot mark it delivered without it,
              so do not share it before then.
            </Text>
          </View>
        ) : null}

        {/* Where the rider is, once they have the order. */}
        {riderAt && dropoff ? (
          <View style={styles.mapCard}>
            <RouteMap style={styles.map} pickup={riderAt} dropoff={dropoff} driver={riderAt} />
            <Text style={styles.mapNote}>
              About {kmBetween(riderAt, dropoff).toFixed(1)} km away, in a straight line
            </Text>
          </View>
        ) : null}

        {rider ? (
          <View style={styles.card}>
            <Text style={styles.label}>Your rider</Text>
            <View style={styles.riderRow}>
              <View style={styles.avatar}>
                <Ionicons name="bicycle" size={18} color="#f59e0b" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{rider.name}</Text>
                {rider.vehicle ? (
                  <Text style={styles.muted}>
                    {rider.vehicle.color} {rider.vehicle.type.toLowerCase()} · {rider.vehicle.licensePlate}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        ) : null}

        {!cancelled ? (
          <View style={styles.card}>
            <Text style={styles.label}>Progress</Text>
            {STEPS.map((step, index) => {
              const done = stepIndex >= index;
              return (
                <View key={step} style={styles.stepRow}>
                  <Ionicons
                    name={done ? "checkmark-circle" : "ellipse-outline"}
                    size={18}
                    color={done ? "#22c55e" : "#475569"}
                  />
                  <Text style={[styles.stepText, done && styles.stepTextDone]}>{STEP_LABEL[step]}</Text>
                </View>
              );
            })}
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.label}>Order</Text>
          {order.items.map((item) => (
            <View key={item.id} style={styles.lineRow}>
              <Text style={styles.line}>
                {item.quantity} × {item.product.name}
              </Text>
              <Text style={styles.line}>R{Number(item.totalPrice).toFixed(2)}</Text>
            </View>
          ))}
          <View style={styles.lineRow}>
            <Text style={styles.muted}>Delivery</Text>
            <Text style={styles.muted}>R{Number(order.deliveryFee).toFixed(2)}</Text>
          </View>
          <View style={[styles.lineRow, styles.totalRow]}>
            <Text style={styles.total}>Total</Text>
            <Text style={styles.total}>R{Number(order.total).toFixed(2)}</Text>
          </View>
          <Text style={styles.muted}>
            {order.paymentMethod === "CASH" ? "Pay the rider in cash" : `Paid by ${order.paymentMethod.toLowerCase()}`}
          </Text>
          <Text style={styles.muted}>To: {order.deliveryAddress}</Text>
        </View>

        {order.status === "PENDING" ? (
          <TouchableOpacity style={[styles.cancelBtn, cancelling && { opacity: 0.5 }]} disabled={cancelling} onPress={cancel}>
            <Text style={styles.cancelText}>{cancelling ? "Cancelling…" : "Cancel order"}</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  scroll: { padding: 20, paddingBottom: 40, gap: 12 },
  statusBar: {
    backgroundColor: "#f59e0b12", borderRadius: 14, borderWidth: 1, borderColor: "#f59e0b40", padding: 16, gap: 4,
  },
  statusBarOff: { backgroundColor: "#ef444412", borderColor: "#ef444440" },
  statusTitle: { fontSize: 17, fontWeight: "800", color: "#f59e0b" },
  statusTitleOff: { color: "#f87171" },
  card: {
    backgroundColor: "#1e293b", borderRadius: 16, borderWidth: 1, borderColor: "#334155", padding: 16, gap: 6,
    marginHorizontal: 0,
  },
  codeCard: {
    backgroundColor: "#1e293b", borderRadius: 16, borderWidth: 1, borderColor: "#f59e0b60", padding: 18, gap: 8,
    alignItems: "center",
  },
  code: { fontSize: 40, fontWeight: "800", color: "#f8fafc", letterSpacing: 6 },
  label: { fontSize: 11, fontWeight: "700", color: "#64748b", textTransform: "uppercase", letterSpacing: 0.6 },
  cardTitle: { fontSize: 16, fontWeight: "700", color: "#f8fafc" },
  muted: { fontSize: 13, color: "#94a3b8", lineHeight: 19 },
  mapCard: { borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "#334155", backgroundColor: "#1e293b" },
  map: { height: 200 },
  mapNote: { color: "#cbd5e1", fontSize: 13, padding: 12 },
  riderRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: "#f59e0b15", borderWidth: 1, borderColor: "#f59e0b40",
    alignItems: "center", justifyContent: "center",
  },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 3 },
  stepText: { fontSize: 14, color: "#64748b" },
  stepTextDone: { color: "#e2e8f0" },
  lineRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  line: { fontSize: 14, color: "#e2e8f0" },
  totalRow: { marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#334155" },
  total: { fontSize: 16, fontWeight: "800", color: "#f8fafc" },
  cancelBtn: { borderRadius: 14, borderWidth: 1, borderColor: "#ef444480", paddingVertical: 14, alignItems: "center" },
  cancelText: { color: "#f87171", fontSize: 15, fontWeight: "700" },
});
