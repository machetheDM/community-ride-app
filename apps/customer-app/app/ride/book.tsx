import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  TextInput, ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { API_URL } from "@/constants/api";

const VEHICLES = [
  { type: "SEDAN",   label: "Sedan",   icon: "car-outline",         base: 15, perKm: 7,  seats: 4, eta: "3-5" },
  { type: "MINIVAN", label: "Minivan", icon: "bus-outline",          base: 20, perKm: 10, seats: 8, eta: "5-8" },
  { type: "BAKKIE",  label: "Bakkie",  icon: "car-sport-outline",    base: 25, perKm: 12, seats: 2, eta: "5-10" },
  { type: "SCOOTER", label: "Scooter", icon: "bicycle-outline",      base: 10, perKm: 5,  seats: 1, eta: "2-4" },
  { type: "BICYCLE", label: "Bicycle", icon: "bicycle-outline",      base: 8,  perKm: 3,  seats: 1, eta: "5-12" },
];

const PAYMENT_METHODS = [
  { key: "CASH", label: "Cash", icon: "cash-outline" },
  { key: "CARD", label: "Card", icon: "card-outline" },
  { key: "WALLET", label: "Wallet", icon: "wallet-outline" },
] as const;

export default function BookRideScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [selectedVehicle, setSelectedVehicle] = useState(0);
  const [payment, setPayment] = useState<"CASH" | "CARD" | "WALLET">("CASH");
  const [loading, setLoading] = useState(false);

  const vehicle = VEHICLES[selectedVehicle];
  const fareEstimate = vehicle.base + vehicle.perKm * 5;

  const requestRide = async () => {
    if (!pickup.trim()) { Alert.alert("Enter pickup address"); return; }
    if (!dropoff.trim()) { Alert.alert("Enter dropoff address"); return; }
    if (!token) { Alert.alert("Please sign in first"); return; }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/rides`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          pickupAddress: pickup.trim(),
          dropoffAddress: dropoff.trim(),
          vehicleType: vehicle.type,
          fareEstimate,
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

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#f8fafc" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Book a Ride</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
          {/* Route inputs */}
          <View style={styles.routeCard}>
            <View style={styles.routeRow}>
              <View style={styles.dotGreen} />
              <TextInput
                style={styles.routeInput}
                placeholder="Pickup address"
                placeholderTextColor="#475569"
                value={pickup}
                onChangeText={setPickup}
                returnKeyType="next"
              />
            </View>
            <View style={styles.routeDivider} />
            <View style={styles.routeRow}>
              <View style={styles.dotRed} />
              <TextInput
                style={styles.routeInput}
                placeholder="Dropoff address"
                placeholderTextColor="#475569"
                value={dropoff}
                onChangeText={setDropoff}
                returnKeyType="done"
              />
            </View>
          </View>

          {/* Vehicle selector */}
          <Text style={styles.sectionLabel}>Choose ride type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.vehicleList}>
            {VEHICLES.map((v, idx) => (
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
                <Text style={styles.vehicleEta}>{v.eta} min</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Fare estimate */}
          <View style={styles.fareCard}>
            <View style={styles.fareRow}>
              <View>
                <Text style={styles.fareLabel}>Estimated fare</Text>
                <Text style={styles.fareSub}>~5km · final fare may vary</Text>
              </View>
              <Text style={styles.fareAmount}>R{fareEstimate}</Text>
            </View>
            <View style={styles.fareBreakdown}>
              <Text style={styles.fareBreakdownText}>Base R{vehicle.base} + R{vehicle.perKm}/km</Text>
              <Text style={styles.fareBreakdownText}>ETA: {vehicle.eta} min</Text>
            </View>
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

        {/* Request button */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.requestBtn, loading && { opacity: 0.6 }]}
            onPress={requestRide}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <>
                <Text style={styles.requestBtnText}>Request {vehicle.label}</Text>
                <Text style={styles.requestBtnFare}>R{fareEstimate}</Text>
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
    borderWidth: 1, borderColor: "#334155", overflow: "hidden",
  },
  routeRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  dotGreen: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#10b981" },
  dotRed: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#ef4444" },
  routeInput: { flex: 1, color: "#f8fafc", fontSize: 15 },
  routeDivider: { height: 1, backgroundColor: "#0f172a", marginLeft: 40 },
  sectionLabel: {
    fontSize: 12, fontWeight: "700", color: "#64748b", textTransform: "uppercase",
    letterSpacing: 0.5, paddingHorizontal: 20, marginBottom: 10,
  },
  vehicleList: { paddingHorizontal: 16, gap: 10, paddingBottom: 4 },
  vehicleCard: {
    width: 90, alignItems: "center", gap: 4, padding: 14, borderRadius: 16,
    backgroundColor: "#1e293b", borderWidth: 1, borderColor: "#334155",
  },
  vehicleCardActive: { borderColor: "#f59e0b60", backgroundColor: "#f59e0b10" },
  vehicleLabel: { fontSize: 13, fontWeight: "600", color: "#64748b" },
  vehicleLabelActive: { color: "#f59e0b" },
  vehicleSeats: { fontSize: 11, color: "#475569" },
  vehicleEta: { fontSize: 11, color: "#475569" },
  fareCard: {
    marginHorizontal: 20, marginVertical: 16, backgroundColor: "#1e293b",
    borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#334155", gap: 10,
  },
  fareRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  fareLabel: { fontSize: 15, fontWeight: "700", color: "#f8fafc" },
  fareSub: { fontSize: 12, color: "#64748b", marginTop: 2 },
  fareAmount: { fontSize: 26, fontWeight: "800", color: "#f59e0b" },
  fareBreakdown: { flexDirection: "row", justifyContent: "space-between" },
  fareBreakdownText: { fontSize: 12, color: "#475569" },
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
  requestBtnText: { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  requestBtnFare: { fontSize: 16, fontWeight: "800", color: "#0f172a" },
});
