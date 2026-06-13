import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ScrollView, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";

export default function DriverProfileScreen() {
  const { user, signOut } = useAuth();

  const confirmSignOut = () => {
    Alert.alert("Sign out?", "You'll need to verify your number again to sign back in.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: () => signOut() },
    ]);
  };

  const menuItems = [
    { icon: "car-outline", label: "My Vehicle", color: "#22c55e", onPress: () => {} },
    { icon: "document-text-outline", label: "Documents", color: "#3b82f6", onPress: () => {} },
    { icon: "notifications-outline", label: "Notifications", color: "#f97316", onPress: () => {} },
    { icon: "help-circle-outline", label: "Help & Support", color: "#6b7280", onPress: () => {} },
    { icon: "log-out-outline", label: "Sign Out", color: "#ef4444", onPress: confirmSignOut },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>My Profile</Text>
        </View>

        <View style={styles.avatarSection}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>{user?.name?.charAt(0).toUpperCase() ?? "D"}</Text>
          </View>
          <Text style={styles.userName}>{user?.name ?? "Driver Account"}</Text>
          <Text style={styles.userPhone}>{user?.phone ?? "Not signed in"}</Text>
          <View style={styles.roleBadge}>
            <Ionicons name="car-sport" size={12} color="#22c55e" />
            <Text style={styles.roleText}>Driver Partner</Text>
          </View>
        </View>

        {/* Menu */}
        <View style={styles.menu}>
          {menuItems.map((item) => (
            <TouchableOpacity key={item.label} style={styles.menuItem} activeOpacity={0.7} onPress={item.onPress}>
              <View style={[styles.menuIcon, { backgroundColor: item.color + "20" }]}>
                <Ionicons name={item.icon as never} size={20} color={item.color} />
              </View>
              <Text style={styles.menuLabel}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={16} color="#334155" />
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.version}>Community Ride Driver v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#1e293b" },
  title: { fontSize: 22, fontWeight: "700", color: "#f8fafc" },
  avatarSection: { alignItems: "center", paddingVertical: 24, gap: 8 },
  avatarCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: "#22c55e20",
    borderWidth: 2, borderColor: "#22c55e40", alignItems: "center", justifyContent: "center",
  },
  avatarInitial: { fontSize: 32, fontWeight: "800", color: "#22c55e" },
  userName: { fontSize: 18, fontWeight: "700", color: "#f8fafc" },
  userPhone: { fontSize: 13, color: "#64748b" },
  roleBadge: {
    flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6,
    backgroundColor: "#22c55e15", borderWidth: 1, borderColor: "#22c55e40",
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20,
  },
  roleText: { fontSize: 12, fontWeight: "700", color: "#22c55e" },
  menu: { marginHorizontal: 20, backgroundColor: "#1e293b", borderRadius: 14, borderWidth: 1, borderColor: "#334155", overflow: "hidden" },
  menuItem: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: "#0f172a",
  },
  menuIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  menuLabel: { flex: 1, fontSize: 14, color: "#cbd5e1", fontWeight: "500" },
  version: { textAlign: "center", color: "#334155", fontSize: 12, marginTop: 24, marginBottom: 16 },
});
