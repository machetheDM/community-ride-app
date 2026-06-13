import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ScrollView, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";

const MENU_ITEMS = [
  { icon: "car-outline", label: "My Rides", color: "#f59e0b" },
  { icon: "bag-handle-outline", label: "Order History", color: "#3b82f6" },
  { icon: "wallet-outline", label: "Wallet", color: "#10b981" },
  { icon: "star-outline", label: "Ratings & Reviews", color: "#8b5cf6" },
  { icon: "notifications-outline", label: "Notifications", color: "#f97316" },
  { icon: "shield-checkmark-outline", label: "Privacy & Security", color: "#06b6d4" },
  { icon: "help-circle-outline", label: "Help & Support", color: "#6b7280" },
  { icon: "log-out-outline", label: "Sign Out", color: "#ef4444" },
];

export default function ProfileScreen() {
  const { user, signOut } = useAuth();

  const handleSignOut = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: signOut },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Profile</Text>
          </View>

        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={styles.avatarCircle}>
            {user ? (
              <Text style={styles.avatarInitial}>{user.name.charAt(0).toUpperCase()}</Text>
            ) : (
              <Ionicons name="person" size={40} color="#64748b" />
            )}
          </View>
          <Text style={styles.userName}>{user?.name ?? "Guest User"}</Text>
          <Text style={styles.userPhone}>{user?.phone ?? "Not signed in"}</Text>
        </View>

        {/* Menu */}
        <View style={styles.menu}>
          {MENU_ITEMS.map((item) => (
            <TouchableOpacity
              key={item.label}
              style={styles.menuItem}
              activeOpacity={0.7}
              onPress={item.label === "Sign Out" ? handleSignOut : undefined}
            >
              <View style={[styles.menuIcon, { backgroundColor: item.color + "20" }]}>
                <Ionicons name={item.icon as never} size={20} color={item.color} />
              </View>
              <Text style={[styles.menuLabel, item.label === "Sign Out" && { color: "#ef4444" }]}>
                {item.label}
              </Text>
              <Ionicons name="chevron-forward" size={16} color="#334155" />
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.version}>Community Ride v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  title: { fontSize: 22, fontWeight: "700", color: "#f8fafc" },
  avatarInitial: { fontSize: 32, fontWeight: "800", color: "#f59e0b" },
  avatarSection: {
    alignItems: "center",
    paddingVertical: 28,
    paddingHorizontal: 20,
    gap: 8,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#1e293b",
    borderWidth: 2,
    borderColor: "#334155",
    alignItems: "center",
    justifyContent: "center",
  },
  userName: { fontSize: 18, fontWeight: "700", color: "#f8fafc" },
  userPhone: { fontSize: 13, color: "#64748b" },
  signInBtn: {
    marginTop: 4,
    backgroundColor: "#f59e0b",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
  },
  signInText: { fontSize: 14, fontWeight: "700", color: "#0f172a" },
  menu: {
    marginHorizontal: 20,
    backgroundColor: "#1e293b",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#334155",
    overflow: "hidden",
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#0f172a",
  },
  menuIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  menuLabel: { flex: 1, fontSize: 14, color: "#cbd5e1", fontWeight: "500" },
  version: { textAlign: "center", color: "#334155", fontSize: 12, marginTop: 24, marginBottom: 16 },
});
