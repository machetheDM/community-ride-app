import React, { useCallback, useState } from "react";
import { FlatList, Image, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { API_URL } from "@/constants/api";
import { api, sastDateTime } from "@/lib/request";
import { TRIP_STATUS, type MyTrip } from "@/lib/trips";

/** An upcoming event (GET /api/events). */
interface PublicEvent {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  ticketInfo: string | null;
  hasPoster: boolean;
  venue: { name: string; area: string | null };
}

/**
 * Events near you, and the group trips you have asked for (docs/PLAN.md Phase
 * 3). The list is public; your own trips need you signed in, which this app
 * always is.
 */
export default function EventsScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [trips, setTrips] = useState<MyTrip[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [ev, mine] = await Promise.all([api<PublicEvent[]>(null, "/api/events"), api<MyTrip[]>(token, "/api/trip-requests")]);
    if (ev.ok && ev.data) setEvents(ev.data);
    if (mine.ok && mine.data) setTrips(mine.data.filter((t) => !["COMPLETED", "CANCELLED", "DECLINED", "NO_SHOW"].includes(t.status)));
    setError(ev.ok ? null : ev.error);
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

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <FlatList
        data={events}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#f59e0b" />}
        ListHeaderComponent={
          <View>
            <Text style={styles.title}>Events</Text>
            <Text style={styles.subtitle}>Say what you can pay for a seat. Operators going your way take the trip.</Text>
            {trips.length > 0 && (
              <View style={{ marginTop: 16 }}>
                <Text style={styles.section}>My trips</Text>
                {trips.map((t) => {
                  const s = TRIP_STATUS[t.status] ?? { label: t.status, color: "#94a3b8" };
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={styles.tripCard}
                      onPress={() => router.push({ pathname: "/trip/[id]", params: { id: t.id } } as never)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.tripTitle}>
                          {t.direction === "TO_EVENT" ? "To" : "Back from"} {t.event.title}
                        </Text>
                        <Text style={styles.muted}>
                          {t.pickupPoint.name} · {t.seats} seat{t.seats === 1 ? "" : "s"} · R{t.pricePerSeat} each
                        </Text>
                      </View>
                      <Text style={[styles.badge, { color: s.color, borderColor: s.color }]}>{s.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            <Text style={[styles.section, { marginTop: 20 }]}>Coming up</Text>
            {error && <Text style={styles.error}>{error}</Text>}
          </View>
        }
        ListEmptyComponent={!error ? <Text style={styles.muted}>No events are listed yet.</Text> : null}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.eventCard}
            onPress={() => router.push({ pathname: "/event/[slug]", params: { slug: item.slug } } as never)}
          >
            {item.hasPoster ? (
              <Image source={{ uri: `${API_URL}/api/events/${item.slug}/poster` }} style={styles.poster} resizeMode="cover" />
            ) : (
              <View style={[styles.poster, styles.posterEmpty]}>
                <Ionicons name="calendar" size={28} color="#475569" />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.eventTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.when}>{sastDateTime(item.startsAt)}</Text>
              <Text style={styles.muted} numberOfLines={1}>
                {item.venue.name}
                {item.venue.area ? `, ${item.venue.area}` : ""}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#475569" />
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  list: { padding: 16, paddingBottom: 32 },
  title: { color: "#f8fafc", fontSize: 26, fontWeight: "800" },
  subtitle: { color: "#94a3b8", marginTop: 4, lineHeight: 20 },
  section: { color: "#cbd5e1", fontWeight: "700", fontSize: 13, textTransform: "uppercase", marginBottom: 8 },
  tripCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#1e293b",
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  tripTitle: { color: "#f8fafc", fontWeight: "700" },
  badge: { fontSize: 11, fontWeight: "700", borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, maxWidth: 130 },
  eventCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#1e293b",
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  poster: { width: 72, height: 96, borderRadius: 8, backgroundColor: "#0f172a" },
  posterEmpty: { alignItems: "center", justifyContent: "center" },
  eventTitle: { color: "#f8fafc", fontWeight: "700", fontSize: 16 },
  when: { color: "#f59e0b", fontWeight: "600", marginTop: 4 },
  muted: { color: "#94a3b8", fontSize: 13, marginTop: 2 },
  error: { color: "#f87171", marginBottom: 8 },
});
