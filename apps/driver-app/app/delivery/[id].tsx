import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { api, openNavigation } from "@/lib/request";

/** The order as its assigned rider sees it (GET /api/orders/{id}). */
interface RiderOrder {
  id: string;
  status: string;
  deliveryAddress: string;
  deliveryLat: number;
  deliveryLng: number;
  deliveryFee: string | number;
  total: string | number;
  paymentMethod: string;
  notes: string | null;
  store: { name: string; address: string; complex: string | null; lat?: number; lng?: number };
  /** The phone is present only while the delivery is this rider's and active. */
  customer: { name: string; phone?: string };
  items: { id: string; quantity: number; product: { name: string } }[];
  delivery: { id: string; status: string } | null;
}

const STAGE: Record<string, { title: string; hint: string }> = {
  ASSIGNED: { title: "Go to the store", hint: "Collect the order once the store has it ready." },
  PICKED_UP: { title: "Order collected", hint: "Tell the customer you are on your way." },
  EN_ROUTE: { title: "On the way", hint: "At the door, ask the customer for their 4-digit code." },
  DELIVERED: { title: "Delivered", hint: "Thank you. This delivery is complete." },
  FAILED: { title: "Not delivered", hint: "Support will follow up with the customer and the store." },
};

const STORE_STAGE: Record<string, string> = {
  CONFIRMED: "The store has accepted the order",
  PREPARING: "The store is preparing it",
  READY_FOR_PICKUP: "Ready to collect",
  OUT_FOR_DELIVERY: "Out for delivery",
};

/**
 * A scooter rider's delivery, step by step (docs/PLAN.md Phase 2.3 and 2.5).
 *
 * The server owns every rule: it refuses a pickup before the store marks the
 * order ready, and it refuses "delivered" without the customer's code. This
 * screen shows the server's own message when it does, so the rider reads why.
 */
export default function RiderDeliveryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { token } = useAuth();
  const [order, setOrder] = useState<RiderOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    const res = await api<RiderOrder>(token, `/api/orders/${id}`);
    if (res.ok && res.data) setOrder(res.data);
    // The API answers 404 for an order that is not this rider's, the same as for
    // one that does not exist. A dropped connection keeps what is on screen.
    else if (res.status === 404) setMissing(true);
    setLoading(false);
  }, [id, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const status = order?.delivery?.status ?? "";
  const isActive = status === "ASSIGNED" || status === "PICKED_UP" || status === "EN_ROUTE";

  // The store's side changes while the rider waits (preparing, then ready).
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [isActive, load]);

  const move = async (body: { status: string; handoverCode?: string; failReason?: string }) => {
    if (!order?.delivery) return;
    setBusy(true);
    setMessage(null);
    const res = await api(token, `/api/deliveries/${order.delivery.id}/status`, { method: "PATCH", body });
    setBusy(false);
    if (!res.ok) {
      setMessage(res.error);
      await load();
      return;
    }
    setCode("");
    setReporting(false);
    setReason("");
    await load();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={{ flex: 1 }} color="#22c55e" />
      </SafeAreaView>
    );
  }

  if (missing || !order || !order.delivery) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Delivery not found</Text>
          <Text style={styles.muted}>It may have been cancelled, or taken by another rider.</Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace("/(tabs)")}>
            <Text style={styles.secondaryText}>Back to deliveries</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const stage = STAGE[status] ?? { title: status, hint: "" };
  const toStore = status === "ASSIGNED";
  const waitingForStore = toStore && order.status !== "READY_FOR_PICKUP";

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.stageBar}>
            <Text style={styles.stageTitle}>{stage.title}</Text>
            <Text style={styles.stageHint}>{stage.hint}</Text>
          </View>

          {/* Collect from */}
          <View style={styles.card}>
            <Text style={styles.label}>Collect from</Text>
            <Text style={styles.cardTitle}>{order.store.name}</Text>
            <Text style={styles.muted}>
              {order.store.complex ? `${order.store.complex} · ` : ""}{order.store.address}
            </Text>
            {isActive ? (
              <Text style={[styles.storeStage, order.status === "READY_FOR_PICKUP" && styles.storeStageReady]}>
                {STORE_STAGE[order.status] ?? order.status}
              </Text>
            ) : null}
            {toStore ? (
              <TouchableOpacity
                style={styles.navBtn}
                onPress={() => openNavigation({ lat: order.store.lat, lng: order.store.lng, label: order.store.address })}
              >
                <Ionicons name="navigate" size={16} color="#22c55e" />
                <Text style={styles.navText}>Navigate to the store</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Deliver to */}
          <View style={styles.card}>
            <Text style={styles.label}>Deliver to</Text>
            <View style={styles.customerRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{order.customer.name}</Text>
                <Text style={styles.muted}>{order.deliveryAddress}</Text>
              </View>
              {order.customer.phone ? (
                <TouchableOpacity
                  style={styles.callBtn}
                  onPress={() => Linking.openURL(`tel:${order.customer.phone}`)}
                  accessibilityLabel="Call the customer"
                >
                  <Ionicons name="call" size={18} color="#22c55e" />
                </TouchableOpacity>
              ) : null}
            </View>
            {order.notes ? <Text style={styles.notes}>Note: {order.notes}</Text> : null}
            {status === "PICKED_UP" || status === "EN_ROUTE" ? (
              <TouchableOpacity
                style={styles.navBtn}
                onPress={() =>
                  openNavigation({ lat: order.deliveryLat, lng: order.deliveryLng, label: order.deliveryAddress })
                }
              >
                <Ionicons name="navigate" size={16} color="#22c55e" />
                <Text style={styles.navText}>Navigate to the customer</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* What is in the bag */}
          <View style={styles.card}>
            <Text style={styles.label}>Order</Text>
            {order.items.map((item) => (
              <Text key={item.id} style={styles.item}>
                {item.quantity} × {item.product.name}
              </Text>
            ))}
            <View style={styles.totalRow}>
              <Text style={styles.muted}>
                {order.paymentMethod === "CASH" ? "Collect in cash" : `Paid by ${order.paymentMethod.toLowerCase()}`}
              </Text>
              <Text style={styles.total}>R{Number(order.total).toFixed(2)}</Text>
            </View>
            <Text style={styles.muted}>Delivery fee R{Number(order.deliveryFee).toFixed(2)}</Text>
          </View>

          {message ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{message}</Text>
            </View>
          ) : null}

          {/* The one next step */}
          {status === "ASSIGNED" ? (
            <TouchableOpacity
              style={[styles.primaryBtn, (busy || waitingForStore) && styles.btnDisabled]}
              disabled={busy || waitingForStore}
              onPress={() => move({ status: "PICKED_UP" })}
            >
              <Text style={styles.primaryText}>
                {waitingForStore ? "Waiting for the store" : busy ? "Saving…" : "I have collected the order"}
              </Text>
            </TouchableOpacity>
          ) : null}

          {status === "PICKED_UP" ? (
            <TouchableOpacity
              style={[styles.primaryBtn, busy && styles.btnDisabled]}
              disabled={busy}
              onPress={() => move({ status: "EN_ROUTE" })}
            >
              <Text style={styles.primaryText}>{busy ? "Saving…" : "I am on my way"}</Text>
            </TouchableOpacity>
          ) : null}

          {status === "EN_ROUTE" ? (
            <View style={styles.card}>
              <Text style={styles.label}>Customer's code</Text>
              <Text style={styles.muted}>
                The customer has a 4-digit code in their app. Ask for it at the door; the delivery cannot be completed
                without it.
              </Text>
              <TextInput
                style={styles.codeInput}
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 4))}
                keyboardType="number-pad"
                maxLength={4}
                placeholder="• • • •"
                placeholderTextColor="#475569"
                testID="handover-code-input"
              />
              <TouchableOpacity
                style={[styles.primaryBtn, styles.inCard, (busy || code.length !== 4) && styles.btnDisabled]}
                disabled={busy || code.length !== 4}
                onPress={() => move({ status: "DELIVERED", handoverCode: code })}
              >
                <Text style={styles.primaryText}>{busy ? "Checking…" : "Complete delivery"}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Something went wrong on the road */}
          {status === "PICKED_UP" || status === "EN_ROUTE" ? (
            reporting ? (
              <View style={styles.card}>
                <Text style={styles.label}>What happened?</Text>
                <TextInput
                  style={styles.reasonInput}
                  value={reason}
                  onChangeText={setReason}
                  placeholder="e.g. nobody at the address, phone off"
                  placeholderTextColor="#475569"
                  multiline
                  maxLength={300}
                />
                <TouchableOpacity
                  style={[styles.dangerBtn, (busy || reason.trim().length < 3) && styles.btnDisabled]}
                  disabled={busy || reason.trim().length < 3}
                  onPress={() =>
                    Alert.alert("Mark as not delivered?", "Support will follow up. This cannot be undone.", [
                      { text: "Go back", style: "cancel" },
                      { text: "Not delivered", style: "destructive", onPress: () => move({ status: "FAILED", failReason: reason.trim() }) },
                    ])
                  }
                >
                  <Text style={styles.dangerText}>Mark as not delivered</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setReporting(false)}>
                  <Text style={styles.link}>Never mind</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setReporting(true)}>
                <Text style={styles.link}>I could not deliver this order</Text>
              </TouchableOpacity>
            )
          ) : null}

          {!isActive ? (
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace("/(tabs)")}>
              <Text style={styles.secondaryText}>Back to deliveries</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  scroll: { padding: 20, paddingBottom: 40, gap: 12 },
  stageBar: {
    backgroundColor: "#22c55e12", borderRadius: 14, borderWidth: 1, borderColor: "#22c55e40", padding: 16,
  },
  stageTitle: { fontSize: 17, fontWeight: "800", color: "#22c55e" },
  stageHint: { fontSize: 13, color: "#94a3b8", marginTop: 4, lineHeight: 18 },
  card: {
    backgroundColor: "#1e293b", borderRadius: 16, borderWidth: 1, borderColor: "#334155", padding: 16, gap: 6,
  },
  label: { fontSize: 11, fontWeight: "700", color: "#64748b", textTransform: "uppercase", letterSpacing: 0.6 },
  cardTitle: { fontSize: 16, fontWeight: "700", color: "#f8fafc" },
  muted: { fontSize: 13, color: "#94a3b8", lineHeight: 19 },
  storeStage: { fontSize: 13, color: "#fbbf24", fontWeight: "600", marginTop: 4 },
  storeStageReady: { color: "#22c55e" },
  navBtn: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, paddingVertical: 6 },
  navText: { color: "#22c55e", fontSize: 14, fontWeight: "600" },
  customerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  callBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: "#22c55e15", borderWidth: 1, borderColor: "#22c55e40",
    alignItems: "center", justifyContent: "center",
  },
  notes: { fontSize: 13, color: "#cbd5e1", fontStyle: "italic", marginTop: 4 },
  item: { fontSize: 14, color: "#e2e8f0" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  total: { fontSize: 18, fontWeight: "800", color: "#f8fafc" },
  errorBox: { backgroundColor: "#ef444415", borderRadius: 12, borderWidth: 1, borderColor: "#ef444450", padding: 12 },
  errorText: { color: "#fca5a5", fontSize: 14, lineHeight: 20 },
  primaryBtn: { backgroundColor: "#22c55e", borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  inCard: { marginTop: 8 },
  primaryText: { color: "#052e16", fontSize: 16, fontWeight: "800" },
  btnDisabled: { opacity: 0.5 },
  codeInput: {
    marginTop: 8, backgroundColor: "#0f172a", borderRadius: 12, borderWidth: 1, borderColor: "#334155",
    color: "#f8fafc", fontSize: 28, fontWeight: "800", letterSpacing: 12, textAlign: "center", paddingVertical: 12,
  },
  reasonInput: {
    backgroundColor: "#0f172a", borderRadius: 12, borderWidth: 1, borderColor: "#334155", color: "#f8fafc",
    fontSize: 14, padding: 12, minHeight: 70, textAlignVertical: "top",
  },
  dangerBtn: {
    marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: "#ef444480", paddingVertical: 12, alignItems: "center",
  },
  dangerText: { color: "#f87171", fontSize: 14, fontWeight: "700" },
  link: { color: "#94a3b8", fontSize: 13, textAlign: "center", paddingVertical: 10, textDecorationLine: "underline" },
  secondaryBtn: {
    borderRadius: 14, borderWidth: 1, borderColor: "#334155", paddingVertical: 14, alignItems: "center", marginTop: 8,
  },
  secondaryText: { color: "#f8fafc", fontSize: 15, fontWeight: "600" },
});
