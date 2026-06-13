import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import { API_URL } from "@/constants/api";

const OTP_LENGTH = 6;

export default function VerifyScreen() {
  const router = useRouter();
  const { phone, devCode } = useLocalSearchParams<{ phone: string; devCode?: string }>();
  const { signIn } = useAuth();

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(60);
  const inputs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    if (devCode) {
      const chars = devCode.split("").slice(0, OTP_LENGTH);
      setOtp([...chars, ...Array(OTP_LENGTH - chars.length).fill("")]);
    }
  }, [devCode]);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setTimeout(() => setResendTimer((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendTimer]);

  const handleChange = (text: string, idx: number) => {
    const char = text.replace(/\D/g, "").slice(-1);
    const next = [...otp];
    next[idx] = char;
    setOtp(next);
    if (char && idx < OTP_LENGTH - 1) inputs.current[idx + 1]?.focus();
  };

  const handleKeyPress = (key: string, idx: number) => {
    if (key === "Backspace" && !otp[idx] && idx > 0) inputs.current[idx - 1]?.focus();
  };

  const handleVerify = async () => {
    const code = otp.join("");
    if (code.length < OTP_LENGTH) {
      Alert.alert("Incomplete", "Please enter all 6 digits.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verification failed");

      await signIn(data.token, data.user);
      router.replace("/(tabs)");
    } catch (err: unknown) {
      Alert.alert("Invalid Code", err instanceof Error ? err.message : "Try again");
      setOtp(Array(OTP_LENGTH).fill(""));
      inputs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResendTimer(60);
    await fetch(`${API_URL}/api/auth/request-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
  };

  const maskedPhone = phone ? phone.replace(/(\+27|0)(\d{2})(\d{3})(\d{4})/, "+27 $2 $3 $4") : "";

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.inner} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#94a3b8" />
        </TouchableOpacity>

        <View style={styles.top}>
          <View style={styles.icon}>
            <Ionicons name="chatbubble-ellipses" size={28} color="#22c55e" />
          </View>
          <Text style={styles.title}>Verify your number</Text>
          <Text style={styles.subtitle}>
            We sent a 6-digit code to{"\n"}
            <Text style={styles.phone}>{maskedPhone}</Text>
          </Text>
          {devCode ? (
            <View style={styles.devBadge}>
              <Ionicons name="code-slash" size={12} color="#22c55e" />
              <Text style={styles.devText}>Dev mode — code pre-filled: {devCode}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.otpRow}>
          {otp.map((digit, idx) => (
            <TextInput
              key={idx}
              ref={(r) => { inputs.current[idx] = r; }}
              style={[styles.otpCell, digit ? styles.otpCellFilled : null]}
              value={digit}
              onChangeText={(t) => handleChange(t, idx)}
              onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, idx)}
              keyboardType="number-pad"
              maxLength={1}
              selectTextOnFocus
              autoFocus={idx === 0}
            />
          ))}
        </View>

        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={handleVerify}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? <ActivityIndicator color="#0f172a" /> : <Text style={styles.btnText}>Confirm</Text>}
        </TouchableOpacity>

        <View style={styles.resendRow}>
          <Text style={styles.resendLabel}>Didn't receive a code?</Text>
          {resendTimer > 0 ? (
            <Text style={styles.timer}>Resend in {resendTimer}s</Text>
          ) : (
            <TouchableOpacity onPress={handleResend}>
              <Text style={styles.resendBtn}>Resend</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  inner: { flex: 1, paddingHorizontal: 24, paddingTop: 16, gap: 28 },
  back: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  top: { alignItems: "center", gap: 10 },
  icon: {
    width: 60, height: 60, borderRadius: 18,
    backgroundColor: "#22c55e20", borderWidth: 1, borderColor: "#22c55e40",
    alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: 22, fontWeight: "800", color: "#f8fafc" },
  subtitle: { fontSize: 14, color: "#64748b", textAlign: "center", lineHeight: 20 },
  phone: { color: "#f8fafc", fontWeight: "600" },
  devBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#22c55e15", borderWidth: 1, borderColor: "#22c55e40",
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, marginTop: 4,
  },
  devText: { fontSize: 11, color: "#22c55e" },
  otpRow: { flexDirection: "row", justifyContent: "center", gap: 10 },
  otpCell: {
    width: 48, height: 56, borderRadius: 12, borderWidth: 1.5,
    borderColor: "#334155", backgroundColor: "#1e293b",
    color: "#f8fafc", fontSize: 22, fontWeight: "700", textAlign: "center",
  },
  otpCellFilled: { borderColor: "#22c55e" },
  btn: {
    backgroundColor: "#22c55e", borderRadius: 12, paddingVertical: 15,
    alignItems: "center", justifyContent: "center",
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  resendRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
  resendLabel: { fontSize: 13, color: "#64748b" },
  timer: { fontSize: 13, color: "#475569" },
  resendBtn: { fontSize: 13, color: "#22c55e", fontWeight: "700" },
});
