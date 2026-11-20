import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { api, openNavigation } from "@/lib/request";
import { sastDateTime, type OperatorTrip } from "@/lib/group-trips";

const PASSENGER_STATUS: Record<string, string> = {
  WAITING: "Agreed",
  CONFIRMING: "Deciding",
  BOOKED: "Not on board yet",
  BOARDED: "On board",
  COMPLETED: "Done",
  NO_SHOW: "Did not come",
};

/**
 * One group trip from the operator's side (docs/PLAN.md 3.9): who is coming,
 * by first name; boarding each passenger by the code on their phone; and
 * finishing the trip once it has left. Phone numbers and codes are never shown
 * here: the code is checked on the server.
 */
export default function GroupTripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { token } = useAuth();
  const [trip, setTrip] = useState<OperatorTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await api<OperatorTrip[]>(token, "/api/group-trips/mine");
    if (res.ok && res.data) setTrip(res.data.find((t) => t.id === id) ?? null);
    setLoading(false);
  }, [id, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const board = async () => {
    if (!/^\d{4}$/.test(code)) {
      setMessage({ ok: false, text: "The boarding code is 4 digits." });
      return;
    }
    setBusy(true);
    const res = await api<{ firstName: string; seats: number }>(token, `/api/group-trips/${id}/check-in`, {
      method: "POST",
      body: { code },
    });
    setBusy(false);
    setCode("");
    setMessage(
      res.ok && res.data
        ? { ok: true, text: `${res.data.firstName} is on board (${res.data.seats} seat${res.data.seats === 1 ? "" : "s"}).` }
        : { ok: false, text: res.error ?? "Try again." }
    );
    await load();
  };

  const finish = () =>
    Alert.alert(
      "Finish this trip?",
      "Passengers not on board are marked as not having come. Our fee on the fares of those who boarded is added to your statement.",
      [
        { text: "Not yet", style: "cancel" },
        {
          text: "Finish",
          onPress: async () => {
            setBusy(true);
            const res = await api<{ fares: number; fee: number }>(token, `/api/group-trips/${id}/complete`, { method: "POST" });
            setBusy(false);
            if (res.ok && res.data) {
              Alert.alert("Trip finished", `Fares R${res.data.fares.toFixed(2)}. Fee owed: R${res.data.fee.toFixed(2)}.`);
              router.back();
            } else {
              Alert.alert("Not finished", res.error ?? "Try again.");
            }
          },
        },
      ]
    );

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
        <Text style={styles.muted}>This trip is not yours, or it has finished.</Text>
      </View>
    );
  }

  const booked = trip.status === "BOOKED";
  const onBoard = trip.passengerList.filter((p) => p.status === "BOARDED").reduce((n, p) => n + p.seats, 0);
  const left = new Date(trip.departAt).getTime() <= Date.now();

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Text style={styles.title}>
        {trip.direction === "TO_EVENT" ? "To" : "Back from"} {trip.event.title}
      </Text>
      <Text style={styles.muted}>
        Leaves {sastDateTime(trip.departAt)} from {trip.pickupPoint.name}
      </Text>

      <TouchableOpacity
        style={styles.ghost}
        onPress={() => openNavigation({ lat: trip.pickupPoint.lat, lng: trip.pickupPoint.lng, label: trip.pickupPoint.address })}
      >
        <Ionicons name="navigate" size={18} color="#f59e0b" />
        <Text style={styles.ghostText}>Directions to the pickup point</Text>
      </TouchableOpacity>

      {trip.status === "COUNTERED" && (
        <Text style={styles.note}>
          Your counter of R{trip.counterPricePerSeat} a seat is with the passengers until{" "}
          {trip.counterExpiresAt ? sastDateTime(trip.counterExpiresAt) : "it lapses"}. The trip is yours if they agree.
        </Text>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          Passengers · {onBoard} of {trip.seats} seats on board
        </Text>
        {trip.passengerList.map((p) => (
          <View key={p.id} style={styles.passenger}>
            <Text style={styles.value}>
              {p.firstName} · {p.seats} seat{p.seats === 1 ? "" : "s"} · R{p.pricePerSeat}
            </Text>
            <Text style={[styles.muted, p.status === "BOARDED" && { color: "#22c55e" }]}>{PASSENGER_STATUS[p.status] ?? p.status}</Text>
          </View>
        ))}
      </View>

      {booked && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Board a passenger</Text>
          <Text style={styles.muted}>Type the 4-digit code on their phone.</Text>
          <View style={styles.row}>
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 4))}
              keyboardType="number-pad"
              maxLength={4}
              placeholder="0000"
              placeholderTextColor="#475569"
              style={styles.codeInput}
            />
            <TouchableOpacity style={styles.button} onPress={board} disabled={busy}>
              <Text style={styles.buttonText}>Board</Text>
            </TouchableOpacity>
          </View>
          {message && <Text style={{ color: message.ok ? "#22c55e" : "#f87171", marginTop: 8 }}>{message.text}</Text>}
        </View>
      )}

      {booked && (
        <TouchableOpacity style={[styles.button, { marginTop: 20 }, !left && { opacity: 0.5 }]} onPress={finish} disabled={busy || !left}>
          <Text style={styles.buttonText}>{left ? "Finish the trip" : "Finish (after departure)"}</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0f172a", padding: 24 },
  title: { color: "#f8fafc", fontSize: 22, fontWeight: "800" },
  muted: { color: "#94a3b8", fontSize: 13, marginTop: 2 },
  note: { color: "#7dd3fc", marginTop: 16, lineHeight: 20 },
  card: { backgroundColor: "#1e293b", borderRadius: 14, padding: 16, marginTop: 16 },
  cardTitle: { color: "#f8fafc", fontWeight: "700", fontSize: 16, marginBottom: 6 },
  passenger: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#334155" },
  value: { color: "#f8fafc" },
  row: { flexDirection: "row", gap: 8, marginTop: 10, alignItems: "center" },
  codeInput: {
    flex: 1,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 10,
    padding: 12,
    color: "#f8fafc",
    fontSize: 24,
    letterSpacing: 8,
    textAlign: "center",
  },
  button: { backgroundColor: "#f59e0b", borderRadius: 10, paddingVertical: 14, paddingHorizontal: 18, alignItems: "center" },
  buttonText: { color: "#0f172a", fontWeight: "800" },
  ghost: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#f59e0b",
    borderRadius: 10,
    paddingVertical: 10,
    marginTop: 14,
  },
  ghostText: { color: "#f59e0b", fontWeight: "700" },
});
