import React, { useState, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { API_URL } from "@/constants/api";

export default function LoginScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const handleSubmit = async () => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 9) {
      Alert.alert("Invalid number", "Please enter a valid South African phone number.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/request-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send OTP");

      router.push({ pathname: "/(auth)/verify", params: { phone, devCode: data.code } });
    } catch (err: unknown) {
      Alert.alert("Error", err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.inner} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.top}>
          <View style={styles.logo}>
            <Ionicons name="car-sport" size={32} color="#22c55e" />
          </View>
          <Text style={styles.title}>Driver Partner</Text>
          <Text style={styles.subtitle}>Sign in to start earning</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Phone Number</Text>
          <View style={styles.inputRow}>
            <View style={styles.prefix}>
              <Text style={styles.prefixText}>🇿🇦 +27</Text>
            </View>
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="82 000 0002"
              placeholderTextColor="#475569"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
              maxLength={15}
              autoFocus
            />
          </View>

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <>
                <Text style={styles.btnText}>Send OTP</Text>
                <Ionicons name="arrow-forward" size={18} color="#0f172a" />
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.hint}>
            Demo driver: use +27 82 000 0002 to sign in as the seeded driver account.
          </Text>
        </View>

        <Text style={styles.footer}>
          Driver partners must be approved before accepting rides.
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  inner: { flex: 1, paddingHorizontal: 24, justifyContent: "center", gap: 32 },
  top: { alignItems: "center", gap: 8 },
  logo: {
    width: 64, height: 64, borderRadius: 20,
    backgroundColor: "#22c55e20", borderWidth: 1, borderColor: "#22c55e40",
    alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: 26, fontWeight: "800", color: "#f8fafc" },
  subtitle: { fontSize: 14, color: "#64748b", textAlign: "center" },
  card: {
    backgroundColor: "#1e293b", borderRadius: 20,
    borderWidth: 1, borderColor: "#334155", padding: 24, gap: 16,
  },
  label: { fontSize: 13, fontWeight: "600", color: "#94a3b8" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  prefix: {
    backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155",
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 14,
  },
  prefixText: { color: "#f8fafc", fontSize: 15, fontWeight: "600" },
  input: {
    flex: 1, backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155",
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 14,
    color: "#f8fafc", fontSize: 17, fontWeight: "500",
  },
  btn: {
    backgroundColor: "#22c55e", borderRadius: 12, paddingVertical: 15,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  hint: { fontSize: 12, color: "#475569", textAlign: "center", lineHeight: 18 },
  footer: { fontSize: 12, color: "#475569", textAlign: "center" },
});
