import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { API_URL } from "@/constants/api";
import { api, sastDateTime } from "@/lib/request";
import type { MyTrip } from "@/lib/trips";

/** One published event and where trips to it leave from (GET /api/events/{slug}). */
interface EventDetail {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  ticketInfo: string | null;
  hasPoster: boolean;
  venue: { name: string; address: string; area: string | null };
  pickupPoints: {
    id: string;
    name: string;
    address: string;
    distanceKm: number;
    price: { floor: number; suggestedLow: number; suggestedHigh: number };
  }[];
}

const MAX_SEATS = 6;

/**
 * An event, and a request for seats on a group trip to it (docs/PLAN.md 3.4).
 *
 * The passenger picks a pickup point, a direction, seats and what they can pay
 * a seat. The floor and suggested range are shown as the server computes them,
 * and the server checks the offer again: this screen only saves a wasted tap.
 * No total or fee is sent.
 */
export default function EventScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { token } = useAuth();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pointId, setPointId] = useState<string | null>(null);
  const [direction, setDirection] = useState<"TO_EVENT" | "FROM_EVENT">("TO_EVENT");
  const [seats, setSeats] = useState(1);
  const [price, setPrice] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await api<EventDetail>(null, `/api/events/${slug}`);
      if (res.ok && res.data) {
        setEvent(res.data);
        const first = res.data.pickupPoints[0];
        if (first) {
          setPointId(first.id);
          setPrice(String(first.price.suggestedLow));
        }
      } else {
        setLoadError(res.status === 404 ? "This event is no longer listed." : res.error);
      }
    })();
  }, [slug]);

  const point = useMemo(() => event?.pickupPoints.find((p) => p.id === pointId) ?? null, [event, pointId]);
  const offer = Number(price.replace(",", "."));
  const belowFloor = point !== null && Number.isFinite(offer) && offer > 0 && offer < point.price.floor;

  const choosePoint = (id: string) => {
    setPointId(id);
    const chosen = event?.pickupPoints.find((p) => p.id === id);
    if (chosen && (!offer || offer < chosen.price.floor)) setPrice(String(chosen.price.suggestedLow));
  };

  const send = async () => {
    if (!point || !Number.isFinite(offer) || offer <= 0) {
      setError("Choose a pickup point and say what you can pay a seat.");
      return;
    }
    setSending(true);
    setError(null);
    const res = await api<MyTrip>(token, `/api/events/${slug}/trip-requests`, {
      method: "POST",
      body: { pickupPointId: point.id, direction, seats, pricePerSeat: offer },
    });
    setSending(false);
    if (res.ok && res.data) {
      router.replace({ pathname: "/trip/[id]", params: { id: res.data.id } } as never);
    } else {
      setError(res.fields?.pricePerSeat?.[0] ?? res.error);
    }
  };

  if (loadError) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{loadError}</Text>
      </View>
    );
  }
  if (!event) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f59e0b" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {event.hasPoster && (
          <Image source={{ uri: `${API_URL}/api/events/${event.slug}/poster` }} style={styles.poster} resizeMode="contain" />
        )}
        <Text style={styles.title}>{event.title}</Text>
        <Text style={styles.when}>{sastDateTime(event.startsAt)}</Text>
        <Text style={styles.muted}>
          {event.venue.name} · {event.venue.address}
        </Text>
        {event.ticketInfo && <Text style={styles.muted}>Tickets: {event.ticketInfo}</Text>}
        {event.description && <Text style={styles.body}>{event.description}</Text>}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Get a seat on a group trip</Text>

          {event.pickupPoints.length === 0 ? (
            <Text style={styles.muted}>Pickup points for this event are still being arranged.</Text>
          ) : (
            <>
              <Text style={styles.label}>Trip</Text>
              <View style={styles.row}>
                {(["TO_EVENT", "FROM_EVENT"] as const).map((d) => (
                  <TouchableOpacity
                    key={d}
                    onPress={() => setDirection(d)}
                    style={[styles.chip, direction === d && styles.chipOn]}
                  >
                    <Text style={[styles.chipText, direction === d && styles.chipTextOn]}>
                      {d === "TO_EVENT" ? "There" : "Back home"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Leaving from</Text>
              {event.pickupPoints.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => choosePoint(p.id)}
                  style={[styles.point, pointId === p.id && styles.pointOn]}
                >
                  <Ionicons
                    name={pointId === p.id ? "radio-button-on" : "radio-button-off"}
                    size={18}
                    color={pointId === p.id ? "#f59e0b" : "#64748b"}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pointName}>{p.name}</Text>
                    <Text style={styles.muted}>
                      {p.distanceKm} km · from R{p.price.floor} a seat
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}

              <Text style={styles.label}>Seats</Text>
              <View style={styles.row}>
                <TouchableOpacity style={styles.step} onPress={() => setSeats((n) => Math.max(1, n - 1))} accessibilityLabel="One seat fewer">
                  <Ionicons name="remove" size={20} color="#f8fafc" />
                </TouchableOpacity>
                <Text style={styles.seats}>{seats}</Text>
                <TouchableOpacity style={styles.step} onPress={() => setSeats((n) => Math.min(MAX_SEATS, n + 1))} accessibilityLabel="One seat more">
                  <Ionicons name="add" size={20} color="#f8fafc" />
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>What you can pay a seat (R)</Text>
              <TextInput
                value={price}
                onChangeText={setPrice}
                keyboardType="decimal-pad"
                style={[styles.input, belowFloor && { borderColor: "#ef4444" }]}
                placeholder="e.g. 60"
                placeholderTextColor="#475569"
              />
              {point && (
                <Text style={[styles.hint, belowFloor && { color: "#f87171" }]}>
                  {belowFloor
                    ? `The least a seat from here can go for is R${point.price.floor}.`
                    : `Operators usually take R${point.price.suggestedLow} to R${point.price.suggestedHigh} a seat from here.`}
                </Text>
              )}
              {Number.isFinite(offer) && offer > 0 && (
                <Text style={styles.total}>You would pay R{(offer * seats).toFixed(2)} on the day, to the operator.</Text>
              )}

              {error && <Text style={styles.error}>{error}</Text>}

              <TouchableOpacity style={[styles.button, (sending || belowFloor) && { opacity: 0.6 }]} onPress={send} disabled={sending || belowFloor}>
                {sending ? <ActivityIndicator color="#0f172a" /> : <Text style={styles.buttonText}>Ask for {seats === 1 ? "a seat" : `${seats} seats`}</Text>}
              </TouchableOpacity>
              <Text style={styles.hint}>
                Nothing is charged now. When an operator takes the trip you see their vehicle and plate, and get a code to
                show when you board.
              </Text>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0f172a", padding: 24 },
  poster: { width: "100%", height: 360, borderRadius: 12, backgroundColor: "#1e293b", marginBottom: 16 },
  title: { color: "#f8fafc", fontSize: 24, fontWeight: "800" },
  when: { color: "#f59e0b", fontWeight: "700", marginTop: 6 },
  muted: { color: "#94a3b8", fontSize: 13, marginTop: 2 },
  body: { color: "#cbd5e1", marginTop: 12, lineHeight: 21 },
  card: { backgroundColor: "#1e293b", borderRadius: 14, padding: 16, marginTop: 20 },
  cardTitle: { color: "#f8fafc", fontSize: 18, fontWeight: "700" },
  label: { color: "#cbd5e1", fontWeight: "600", marginTop: 16, marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  chip: { borderWidth: 1, borderColor: "#334155", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { borderColor: "#f59e0b", backgroundColor: "#f59e0b22" },
  chipText: { color: "#94a3b8", fontWeight: "600" },
  chipTextOn: { color: "#f59e0b" },
  point: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: "#334155", marginBottom: 6 },
  pointOn: { borderColor: "#f59e0b" },
  pointName: { color: "#f8fafc", fontWeight: "600" },
  step: { backgroundColor: "#334155", borderRadius: 10, padding: 10 },
  seats: { color: "#f8fafc", fontSize: 22, fontWeight: "800", minWidth: 32, textAlign: "center" },
  input: { backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155", borderRadius: 10, padding: 12, color: "#f8fafc", fontSize: 18 },
  hint: { color: "#94a3b8", fontSize: 12, marginTop: 8, lineHeight: 18 },
  total: { color: "#f8fafc", marginTop: 10, fontWeight: "600" },
  error: { color: "#f87171", marginTop: 12 },
  button: { backgroundColor: "#f59e0b", borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 16 },
  buttonText: { color: "#0f172a", fontWeight: "800", fontSize: 16 },
});
