import React, { useCallback, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/request";
import { sastDateTime, type OperatorTrip, type Standing, type TripOffer } from "@/lib/group-trips";

/**
 * Group trips to events, for drivers (docs/PLAN.md 3.6, 3.7).
 *
 * Open trips the operator could take, with what the passengers offered. Take
 * one as it is, or counter once with a price per seat for everyone. Until an
 * admin has verified their documents (or while they owe over the limit) they
 * see why, and no trips.
 */
export default function TripsScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [standing, setStanding] = useState<Standing | null>(null);
  const [offers, setOffers] = useState<TripOffer[]>([]);
  const [mine, setMine] = useState<OperatorTrip[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [counterFor, setCounterFor] = useState<string | null>(null);
  const [counterPrice, setCounterPrice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [available, own] = await Promise.all([
      api<{ standing: Standing; trips: TripOffer[] }>(token, "/api/group-trips/available"),
      api<OperatorTrip[]>(token, "/api/group-trips/mine"),
    ]);
    if (available.ok && available.data) {
      setStanding(available.data.standing);
      setOffers(available.data.trips);
    }
    if (own.ok && own.data) setMine(own.data.filter((t) => t.status !== "COMPLETED"));
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const take = (offer: TripOffer) =>
    Alert.alert(
      "Take this trip?",
      `${offer.seats} passengers, R${offer.total.toFixed(2)} in fares, paid to you in cash. Our fee is recorded when you complete it.`,
      [
        { text: "Not yet", style: "cancel" },
        {
          text: "Take it",
          onPress: async () => {
            setBusy(offer.id);
            const res = await api<OperatorTrip>(token, `/api/group-trips/${offer.id}/accept`, { method: "POST" });
            setBusy(null);
            if (res.ok) router.push({ pathname: "/group-trip/[id]", params: { id: offer.id } } as never);
            else Alert.alert("Not taken", res.error ?? "Try again.");
            await load();
          },
        },
      ]
    );

  const sendCounter = async (offer: TripOffer) => {
    const price = Number(counterPrice.replace(",", "."));
    if (!Number.isFinite(price) || price <= 0) {
      Alert.alert("Price per seat", "Say what you would take a seat, in rands.");
      return;
    }
    setBusy(offer.id);
    const res = await api<OperatorTrip>(token, `/api/group-trips/${offer.id}/counter`, { method: "POST", body: { pricePerSeat: price } });
    setBusy(null);
    if (res.ok) {
      setCounterFor(null);
      setCounterPrice("");
      Alert.alert("Counter sent", "The passengers have 30 minutes to answer. The trip is held for you until then.");
    } else {
      Alert.alert("Counter not sent", res.error ?? "Try again.");
    }
    await load();
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#f59e0b" />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Event trips</Text>
          <TouchableOpacity onPress={() => router.push("/operator" as never)} style={styles.link}>
            <Ionicons name="document-text" size={16} color="#f59e0b" />
            <Text style={styles.linkText}>Documents and fees</Text>
          </TouchableOpacity>
        </View>

        {standing?.refusal && (
          <TouchableOpacity style={styles.warning} onPress={() => router.push("/operator" as never)}>
            <Ionicons name="alert-circle" size={20} color="#f59e0b" />
            <Text style={styles.warningText}>{standing.refusal}</Text>
          </TouchableOpacity>
        )}

        {mine.length > 0 && (
          <>
            <Text style={styles.section}>Your trips</Text>
            {mine.map((t) => (
              <TouchableOpacity
                key={t.id}
                style={styles.card}
                onPress={() => router.push({ pathname: "/group-trip/[id]", params: { id: t.id } } as never)}
              >
                <Text style={styles.cardTitle}>{t.event.title}</Text>
                <Text style={styles.muted}>
                  {sastDateTime(t.departAt)} · {t.pickupPoint.name} · {t.seats} seats
                </Text>
                <Text style={[styles.badge, { color: t.status === "COUNTERED" ? "#38bdf8" : "#22c55e" }]}>
                  {t.status === "COUNTERED" ? `Your counter: R${t.counterPricePerSeat} a seat, waiting for answers` : "Booked to you"}
                </Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        <Text style={styles.section}>Open trips</Text>
        {!standing?.refusal && offers.length === 0 && <Text style={styles.muted}>No open trips your vehicle can take right now.</Text>}
        {offers.map((o) => (
          <View key={o.id} style={styles.card}>
            <Text style={styles.cardTitle}>
              {o.direction === "TO_EVENT" ? "To" : "Back from"} {o.event.title}
            </Text>
            <Text style={styles.muted}>{o.event.venue}</Text>
            <View style={styles.facts}>
              <Fact label="Leaves" value={sastDateTime(o.departAt)} />
              <Fact label="From" value={`${o.pickupPoint.name} (${o.distanceKm} km)`} />
              <Fact label="Passengers" value={`${o.passengers} · ${o.seats} seats`} />
              <Fact label="Fares" value={`R${o.total.toFixed(2)} (lowest R${o.lowestPerSeat ?? "-"} a seat)`} />
            </View>
            {counterFor === o.id ? (
              <View style={styles.row}>
                <TextInput
                  value={counterPrice}
                  onChangeText={setCounterPrice}
                  keyboardType="decimal-pad"
                  placeholder={`More than R${o.lowestPerSeat ?? o.floorPerSeat}`}
                  placeholderTextColor="#475569"
                  style={styles.input}
                />
                <TouchableOpacity style={styles.button} onPress={() => sendCounter(o)} disabled={busy === o.id}>
                  <Text style={styles.buttonText}>Send</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.row}>
                <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={() => take(o)} disabled={busy === o.id}>
                  <Text style={styles.buttonText}>Take for R{o.total.toFixed(0)}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.ghost, { flex: 1 }]} onPress={() => setCounterFor(o.id)}>
                  <Text style={styles.ghostText}>Counter</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: "50%", marginBottom: 8 }}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: "#f8fafc", fontSize: 26, fontWeight: "800" },
  link: { flexDirection: "row", gap: 6, alignItems: "center" },
  linkText: { color: "#f59e0b", fontWeight: "600" },
  warning: { flexDirection: "row", gap: 10, backgroundColor: "#f59e0b1a", borderRadius: 12, padding: 14, marginTop: 16 },
  warningText: { color: "#fcd34d", flex: 1, lineHeight: 20 },
  section: { color: "#cbd5e1", fontWeight: "700", fontSize: 13, textTransform: "uppercase", marginTop: 20, marginBottom: 8 },
  card: { backgroundColor: "#1e293b", borderRadius: 14, padding: 14, marginBottom: 10 },
  cardTitle: { color: "#f8fafc", fontWeight: "700", fontSize: 16 },
  muted: { color: "#94a3b8", fontSize: 13, marginTop: 2 },
  badge: { fontWeight: "700", fontSize: 12, marginTop: 8 },
  facts: { flexDirection: "row", flexWrap: "wrap", marginTop: 12 },
  label: { color: "#64748b", fontSize: 11, textTransform: "uppercase", fontWeight: "700" },
  value: { color: "#f8fafc", fontSize: 14, marginTop: 2 },
  row: { flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center" },
  input: { flex: 1, backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155", borderRadius: 10, padding: 10, color: "#f8fafc" },
  button: { backgroundColor: "#f59e0b", borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: "center" },
  buttonText: { color: "#0f172a", fontWeight: "800" },
  ghost: { borderWidth: 1, borderColor: "#f59e0b", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  ghostText: { color: "#f59e0b", fontWeight: "700" },
});
