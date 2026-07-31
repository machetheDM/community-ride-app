import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { AddressAutocomplete, RouteMap } from "@ride/maps-service/native";
import type { Address } from "@ride/maps-service/client";
import { useAuth } from "@/context/AuthContext";
import { useMapsClient } from "@/hooks/useMapsClient";
import { API_URL } from "@/constants/api";

const VEHICLES = [
  { type: "SEDAN",   label: "Sedan",   icon: "car-outline",       seats: 4 },
  { type: "MINIVAN", label: "Minivan", icon: "bus-outline",       seats: 8 },
  { type: "BAKKIE",  label: "Bakkie",  icon: "car-sport-outline", seats: 2 },
  { type: "SCOOTER", label: "Scooter", icon: "bicycle-outline",   seats: 1 },
  { type: "BICYCLE", label: "Bicycle", icon: "bicycle-outline",   seats: 1 },
];

const PAYMENT_METHODS = [
  { key: "CASH", label: "Cash", icon: "cash-outline" },
  { key: "CARD", label: "Card", icon: "card-outline" },
  { key: "WALLET", label: "Wallet", icon: "wallet-outline" },
] as const;

interface FareQuote {
  vehicleType: string;
  total: number;
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  minimumApplied: boolean;
}

interface QuoteResponse {
  distanceKm: number;
  durationMinutes: number;
  quotes: FareQuote[];
}

export default function BookRideScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const mapsClient = useMapsClient();

  const [pickupText, setPickupText] = useState("");
  const [dropoffText, setDropoffText] = useState("");
  const [pickup, setPickup] = useState<Address | null>(null);
  const [dropoff, setDropoff] = useState<Address | null>(null);

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [routePolyline, setRoutePolyline] = useState<string | null>(null);

  const [selectedVehicle, setSelectedVehicle] = useState(0);
  const [payment, setPayment] = useState<"CASH" | "CARD" | "WALLET">("CASH");
  const [loading, setLoading] = useState(false);

  const quoteAbort = useRef<AbortController | null>(null);

  const vehicle = VEHICLES[selectedVehicle];
  const selectedQuote = quote?.quotes.find((q) => q.vehicleType === vehicle.type) ?? null;

  /**
   * Prices the trip once both endpoints have coordinates.
   *
   * One call covers every vehicle type, so switching between Sedan and Minivan is
   * instant and costs no additional Maps quota — same road, different rate card.
   * The old screen computed this on-device from a hardcoded 5 km, so the number the
   * customer saw had no relationship to the trip they were booking.
   */
  const fetchQuote = useCallback(
    async (from: Address, to: Address) => {
      quoteAbort.current?.abort();
      const controller = new AbortController();
      quoteAbort.current = controller;

      setQuoting(true);
      setQuoteError(null);

      try {
        const [quoteRes, route] = await Promise.all([
          fetch(`${API_URL}/api/rides/quote`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              origin: { lat: from.lat, lng: from.lng },
              destination: { lat: to.lat, lng: to.lng },
            }),
            signal: controller.signal,
          }).then((r) => r.json()),
          // Geometry for the preview map. Failure here is cosmetic — the map falls
          // back to a straight line — so it must not fail the quote.
          mapsClient
            .route({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }, controller.signal)
            .catch(() => null),
        ]);

        if (controller.signal.aborted) return;

        if (!quoteRes?.success) throw new Error(quoteRes?.error ?? "Could not price this trip");

        setQuote(quoteRes.data as QuoteResponse);
        setRoutePolyline(route?.polyline ?? null);
      } catch (e: unknown) {
        if (controller.signal.aborted) return;
        setQuote(null);
        setQuoteError(e instanceof Error ? e.message : "Could not price this trip");
      } finally {
        if (!controller.signal.aborted) setQuoting(false);
      }
    },
    [token, mapsClient]
  );

  useEffect(() => {
    if (pickup && dropoff) fetchQuote(pickup, dropoff);
  }, [pickup, dropoff, fetchQuote]);

  useEffect(() => () => quoteAbort.current?.abort(), []);

  const requestRide = async () => {
    if (!pickup) { Alert.alert("Choose a pickup address"); return; }
    if (!dropoff) { Alert.alert("Choose a dropoff address"); return; }
    if (!token) { Alert.alert("Please sign in first"); return; }

    setLoading(true);
    try {
      // No fareEstimate in this payload — the server prices the ride from the
      // routed distance and PricingConfig. A client-supplied price is a
      // client-controlled price.
      const res = await fetch(`${API_URL}/api/rides`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          pickupAddress: pickup.formatted || pickupText.trim(),
          pickupLat: pickup.lat,
          pickupLng: pickup.lng,
          dropoffAddress: dropoff.formatted || dropoffText.trim(),
          dropoffLat: dropoff.lat,
          dropoffLng: dropoff.lng,
          vehicleType: vehicle.type,
          paymentMethod: payment,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed");

      router.replace({ pathname: "/ride/[id]", params: { id: json.data.id } });
    } catch (e: unknown) {
      Alert.alert("Could not request ride", e instanceof Error ? e.message : "Please try again");
    } finally {
      setLoading(false);
    }
  };

  const canRequest = Boolean(pickup && dropoff && selectedQuote && !quoting && !loading);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#f8fafc" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Book a Ride</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 140 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Route inputs */}
          <View style={styles.routeCard}>
            <View style={[styles.routeRow, { zIndex: 30 }]}>
              <View style={styles.dotGreen} />
              <AddressAutocomplete
                testID="pickup-input"
                client={mapsClient}
                placeholder="Pickup address"
                value={pickupText}
                onChangeText={(t) => { setPickupText(t); setPickup(null); }}
                onSelect={(addr) => { setPickup(addr); setPickupText(addr.formatted); }}
              />
            </View>
            <View style={styles.routeDivider} />
            <View style={[styles.routeRow, { zIndex: 20 }]}>
              <View style={styles.dotRed} />
              <AddressAutocomplete
                testID="dropoff-input"
                client={mapsClient}
                placeholder="Dropoff address"
                value={dropoffText}
                onChangeText={(t) => { setDropoffText(t); setDropoff(null); }}
                onSelect={(addr) => { setDropoff(addr); setDropoffText(addr.formatted); }}
                bias={pickup ? { center: { lat: pickup.lat, lng: pickup.lng }, radiusMeters: 30000 } : undefined}
              />
            </View>
          </View>

          {/* Route preview */}
          {pickup && dropoff ? (
            <RouteMap
              style={styles.map}
              pickup={{ lat: pickup.lat, lng: pickup.lng }}
              dropoff={{ lat: dropoff.lat, lng: dropoff.lng }}
              polyline={routePolyline}
            />
          ) : null}

          {/* Vehicle selector */}
          <Text style={styles.sectionLabel}>Choose ride type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.vehicleList}>
            {VEHICLES.map((v, idx) => {
              const q = quote?.quotes.find((x) => x.vehicleType === v.type);
              return (
                <TouchableOpacity
                  key={v.type}
                  style={[styles.vehicleCard, selectedVehicle === idx && styles.vehicleCardActive]}
                  onPress={() => setSelectedVehicle(idx)}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={v.icon as never}
                    size={28}
                    color={selectedVehicle === idx ? "#f59e0b" : "#64748b"}
                  />
                  <Text style={[styles.vehicleLabel, selectedVehicle === idx && styles.vehicleLabelActive]}>
                    {v.label}
                  </Text>
                  <Text style={styles.vehicleSeats}>{v.seats} seat{v.seats > 1 ? "s" : ""}</Text>
                  {/* Only a real quote shows a price. No placeholder figure stands
                      in for one — a made-up fare is worse than no fare. */}
                  <Text style={styles.vehiclePrice}>{q ? `R${q.total.toFixed(2)}` : "—"}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Fare */}
          <View style={styles.fareCard}>
            {quoting ? (
              <View style={styles.fareCentered}>
                <ActivityIndicator color="#f59e0b" />
                <Text style={styles.fareSub}>Calculating your route…</Text>
              </View>
            ) : quoteError ? (
              <View style={styles.fareCentered}>
                <Ionicons name="alert-circle-outline" size={20} color="#ef4444" />
                <Text style={styles.fareError}>{quoteError}</Text>
                {pickup && dropoff ? (
                  <TouchableOpacity onPress={() => fetchQuote(pickup, dropoff)}>
                    <Text style={styles.retryText}>Tap to retry</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : selectedQuote && quote ? (
              <>
                <View style={styles.fareRow}>
                  <View>
                    <Text style={styles.fareLabel}>Estimated fare</Text>
                    <Text style={styles.fareSub}>
                      {quote.distanceKm.toFixed(1)} km · {quote.durationMinutes} min
                    </Text>
                  </View>
                  <Text style={styles.fareAmount}>R{selectedQuote.total.toFixed(2)}</Text>
                </View>
                <View style={styles.fareBreakdown}>
                  <Text style={styles.fareBreakdownText}>
                    Base R{selectedQuote.baseFare.toFixed(2)} · Distance R
                    {selectedQuote.distanceFare.toFixed(2)} · Time R
                    {selectedQuote.timeFare.toFixed(2)}
                  </Text>
                </View>
                {selectedQuote.minimumApplied ? (
                  <Text style={styles.fareNote}>Minimum fare applied for short trips.</Text>
                ) : null}
              </>
            ) : (
              <View style={styles.fareCentered}>
                <Text style={styles.fareSub}>
                  Enter pickup and dropoff to see your fare.
                </Text>
              </View>
            )}
          </View>

          {/* Payment */}
          <Text style={styles.sectionLabel}>Payment method</Text>
          <View style={styles.payRow}>
            {PAYMENT_METHODS.map((m) => (
              <TouchableOpacity
                key={m.key}
                style={[styles.payOption, payment === m.key && styles.payOptionActive]}
                onPress={() => setPayment(m.key)}
              >
                <Ionicons name={m.icon as never} size={18} color={payment === m.key ? "#f59e0b" : "#64748b"} />
                <Text style={[styles.payLabel, payment === m.key && styles.payLabelActive]}>{m.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.requestBtn, !canRequest && styles.requestBtnDisabled]}
            onPress={requestRide}
            disabled={!canRequest}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <>
                <Text style={styles.requestBtnText}>Request {vehicle.label}</Text>
                <Text style={styles.requestBtnFare}>
                  {selectedQuote ? `R${selectedQuote.total.toFixed(2)}` : "—"}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#1e293b",
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: "#1e293b",
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 17, fontWeight: "700", color: "#f8fafc" },
  routeCard: {
    margin: 20, backgroundColor: "#1e293b", borderRadius: 16,
    borderWidth: 1, borderColor: "#334155",
  },
  routeRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  dotGreen: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#10b981" },
  dotRed: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#ef4444" },
  routeDivider: { height: 1, backgroundColor: "#0f172a", marginLeft: 40 },
  map: { height: 180, marginHorizontal: 20, marginBottom: 16, borderRadius: 16 },
  sectionLabel: {
    fontSize: 12, fontWeight: "700", color: "#64748b", textTransform: "uppercase",
    letterSpacing: 0.5, paddingHorizontal: 20, marginBottom: 10,
  },
  vehicleList: { paddingHorizontal: 16, gap: 10, paddingBottom: 4 },
  vehicleCard: {
    width: 92, alignItems: "center", gap: 4, padding: 14, borderRadius: 16,
    backgroundColor: "#1e293b", borderWidth: 1, borderColor: "#334155",
  },
  vehicleCardActive: { borderColor: "#f59e0b60", backgroundColor: "#f59e0b10" },
  vehicleLabel: { fontSize: 13, fontWeight: "600", color: "#64748b" },
  vehicleLabelActive: { color: "#f59e0b" },
  vehicleSeats: { fontSize: 11, color: "#475569" },
  vehiclePrice: { fontSize: 12, color: "#94a3b8", fontWeight: "700" },
  fareCard: {
    marginHorizontal: 20, marginVertical: 16, backgroundColor: "#1e293b",
    borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#334155", gap: 10,
    minHeight: 92, justifyContent: "center",
  },
  fareCentered: { alignItems: "center", gap: 8 },
  fareRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  fareLabel: { fontSize: 15, fontWeight: "700", color: "#f8fafc" },
  fareSub: { fontSize: 12, color: "#64748b", marginTop: 2 },
  fareError: { fontSize: 13, color: "#ef4444", textAlign: "center" },
  retryText: { fontSize: 13, color: "#f59e0b", fontWeight: "700" },
  fareAmount: { fontSize: 26, fontWeight: "800", color: "#f59e0b" },
  fareBreakdown: { flexDirection: "row", justifyContent: "space-between" },
  fareBreakdownText: { fontSize: 12, color: "#475569" },
  fareNote: { fontSize: 11, color: "#64748b", fontStyle: "italic" },
  payRow: { flexDirection: "row", gap: 10, paddingHorizontal: 20, marginBottom: 8 },
  payOption: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#1e293b", borderRadius: 12, paddingVertical: 12,
    borderWidth: 1, borderColor: "#334155",
  },
  payOptionActive: { borderColor: "#f59e0b60", backgroundColor: "#f59e0b10" },
  payLabel: { fontSize: 13, fontWeight: "600", color: "#64748b" },
  payLabelActive: { color: "#f59e0b" },
  footer: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#0f172a", paddingHorizontal: 20, paddingVertical: 16,
    borderTopWidth: 1, borderTopColor: "#1e293b",
  },
  requestBtn: {
    backgroundColor: "#f59e0b", borderRadius: 16, paddingVertical: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24,
  },
  requestBtnDisabled: { opacity: 0.5 },
  requestBtnText: { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  requestBtnFare: { fontSize: 16, fontWeight: "800", color: "#0f172a" },
});
