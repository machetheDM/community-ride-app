import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { API_URL } from "@/constants/api";
import { api, sastDateTime } from "@/lib/request";
import { TRIP_STATUS, type MyTrip } from "@/lib/trips";

/**
 * One group trip from the passenger's side (docs/PLAN.md 3.6 and 3.9): where it
 * stands, a counter-offer to answer, and once booked the vehicle, its plate,
 * the boarding code and a link to send to family.
 */
export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const [trip, setTrip] = useState<MyTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<MyTrip[]>(token, "/api/trip-requests");
    if (res.ok && res.data) setTrip(res.data.find((t) => t.id === id) ?? null);
    setLoading(false);
  }, [id, token]);

  useEffect(() => {
    void load();
  }, [load]);

  // While someone else's answer can still change it, look again every 15 seconds.
  const live = trip && ["WAITING", "CONFIRMING", "BOOKED"].includes(trip.status);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [live, load]);

  const act = async (path: string, body?: unknown) => {
    setBusy(true);
    const res = await api<MyTrip>(token, path, { method: "POST", body });
    setBusy(false);
    if (!res.ok) Alert.alert("That did not work", res.error ?? "Try again.");
    await load();
  };

  const answer = (accept: boolean) => act(`/api/trip-requests/${id}/respond`, { accept });

  const cancel = () =>
    Alert.alert("Cancel your seats?", "Your seats go back, and the operator is told.", [
      { text: "Keep them", style: "cancel" },
      { text: "Cancel", style: "destructive", onPress: () => void act(`/api/trip-requests/${id}/cancel`) },
    ]);

  const share = async () => {
    if (!trip?.sharePath || !trip.operator) return;
    const v = trip.operator.vehicle;
    await Share.share({
      message:
        `I'm taking a group trip to ${trip.event.title}, leaving ${trip.departAt ? sastDateTime(trip.departAt) : "soon"} ` +
        `from ${trip.pickupPoint.name}` +
        (v ? ` in a ${v.color} ${v.make} ${v.model}, plate ${v.licensePlate}` : "") +
        `. Details: ${API_URL}${trip.sharePath}`,
    });
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f59e0b" />
      </View>
    );
  }
  if (!trip) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>This trip is not one of yours.</Text>
      </View>
    );
  }

  const status = TRIP_STATUS[trip.status] ?? { label: trip.status, color: "#94a3b8" };
  const v = trip.operator?.vehicle ?? null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Text style={[styles.status, { color: status.color }]}>{status.label}</Text>
      <Text style={styles.title}>
        {trip.direction === "TO_EVENT" ? "To" : "Back from"} {trip.event.title}
      </Text>
      <Text style={styles.muted}>{trip.event.venue}</Text>

      <View style={styles.card}>
        <Row icon="location" label="Pickup" value={`${trip.pickupPoint.name}\n${trip.pickupPoint.address}`} />
        <Row icon="time" label="Leaves" value={trip.departAt ? sastDateTime(trip.departAt) : "When the trip is set"} />
        <Row icon="people" label="Seats" value={`${trip.seats} × R${trip.pricePerSeat} = R${trip.total.toFixed(2)}, paid to the operator`} />
      </View>

      {trip.status === "WAITING" && (
        <Text style={styles.note}>
          Your request is with the operators near your pickup point. Others leaving from there join the same trip.
        </Text>
      )}

      {trip.counter && (
        <View style={[styles.card, { borderColor: "#38bdf8", borderWidth: 1 }]}>
          <Text style={styles.cardTitle}>An operator offers R{trip.counter.pricePerSeat} a seat</Text>
          <Text style={styles.muted}>
            Everyone on this trip pays the same. Answer by {sastDateTime(trip.counter.expiresAt)}, or the offer lapses and
            your own price stands.
          </Text>
          <View style={[styles.row, { marginTop: 12 }]}>
            <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={() => answer(true)} disabled={busy}>
              <Text style={styles.buttonText}>Accept R{trip.counter.pricePerSeat}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.ghost, { flex: 1 }]} onPress={() => answer(false)} disabled={busy}>
              <Text style={styles.ghostText}>Decline</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {trip.operator && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your operator: {trip.operator.firstName}</Text>
          {v && (
            <>
              <Text style={styles.muted}>
                {v.color} {v.make} {v.model}
              </Text>
              <Text style={styles.plate}>{v.licensePlate}</Text>
              <Text style={styles.muted}>Only get into the vehicle with this plate.</Text>
            </>
          )}
        </View>
      )}

      {trip.checkInCode && (
        <View style={[styles.card, { alignItems: "center" }]}>
          <Text style={styles.muted}>Show this code when you board</Text>
          <Text style={styles.code} accessibilityLabel={`Boarding code ${trip.checkInCode.split("").join(" ")}`}>
            {trip.checkInCode}
          </Text>
          <Text style={[styles.muted, { textAlign: "center" }]}>The operator types it in. Do not send it to anyone.</Text>
        </View>
      )}

      {trip.sharePath && (
        <TouchableOpacity style={styles.ghost} onPress={share}>
          <Ionicons name="share-social" size={18} color="#f59e0b" />
          <Text style={styles.ghostText}>Send the trip details to family</Text>
        </TouchableOpacity>
      )}

      {["WAITING", "CONFIRMING", "BOOKED"].includes(trip.status) && (
        <TouchableOpacity onPress={cancel} disabled={busy} style={{ marginTop: 20, alignItems: "center" }}>
          <Text style={{ color: "#f87171", fontWeight: "600" }}>Cancel my seats</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

function Row({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={[styles.row, { alignItems: "flex-start", marginBottom: 10 }]}>
      <Ionicons name={icon} size={18} color="#f59e0b" style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0f172a", padding: 24 },
  status: { fontWeight: "800", textTransform: "uppercase", fontSize: 12 },
  title: { color: "#f8fafc", fontSize: 22, fontWeight: "800", marginTop: 4 },
  muted: { color: "#94a3b8", fontSize: 13, marginTop: 2 },
  note: { color: "#cbd5e1", marginTop: 12, lineHeight: 20 },
  card: { backgroundColor: "#1e293b", borderRadius: 14, padding: 16, marginTop: 16 },
  cardTitle: { color: "#f8fafc", fontSize: 17, fontWeight: "700", marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  label: { color: "#64748b", fontSize: 11, textTransform: "uppercase", fontWeight: "700" },
  value: { color: "#f8fafc", fontSize: 15, marginTop: 2 },
  plate: { color: "#f59e0b", fontSize: 28, fontWeight: "900", letterSpacing: 3, marginVertical: 6 },
  code: { color: "#f8fafc", fontSize: 48, fontWeight: "900", letterSpacing: 12, marginVertical: 8 },
  button: { backgroundColor: "#f59e0b", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  buttonText: { color: "#0f172a", fontWeight: "800" },
  ghost: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#f59e0b",
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 16,
  },
  ghostText: { color: "#f59e0b", fontWeight: "700" },
});
