import { View, Text, StyleSheet, SafeAreaView, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function EarningsScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Earnings</Text>
        </View>

        {/* Summary */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>This Week</Text>
          <Text style={styles.summaryAmount}>R 0.00</Text>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Ionicons name="car" size={14} color="#64748b" />
              <Text style={styles.summaryItemText}>0 rides</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Ionicons name="time" size={14} color="#64748b" />
              <Text style={styles.summaryItemText}>0h online</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Ionicons name="trending-up" size={14} color="#64748b" />
              <Text style={styles.summaryItemText}>—% rate</Text>
            </View>
          </View>
        </View>

        {/* Breakdown */}
        {[
          { period: "Today", amount: "R 0.00", rides: 0 },
          { period: "Yesterday", amount: "R 0.00", rides: 0 },
          { period: "This Month", amount: "R 0.00", rides: 0 },
        ].map((item) => (
          <View key={item.period} style={styles.periodCard}>
            <View>
              <Text style={styles.periodLabel}>{item.period}</Text>
              <Text style={styles.periodRides}>{item.rides} rides</Text>
            </View>
            <Text style={styles.periodAmount}>{item.amount}</Text>
          </View>
        ))}

        <View style={styles.note}>
          <Ionicons name="information-circle-outline" size={16} color="#475569" />
          <Text style={styles.noteText}>Earnings are paid out weekly. Platform fee: 15%</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#1e293b" },
  title: { fontSize: 22, fontWeight: "700", color: "#f8fafc" },
  summaryCard: {
    margin: 20,
    backgroundColor: "#1e293b",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#334155",
  },
  summaryLabel: { fontSize: 13, color: "#64748b", fontWeight: "500" },
  summaryAmount: { fontSize: 36, fontWeight: "800", color: "#f59e0b" },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
  summaryItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  summaryItemText: { fontSize: 12, color: "#64748b" },
  summaryDivider: { width: 1, height: 12, backgroundColor: "#334155" },
  periodCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginHorizontal: 20,
    marginBottom: 10,
    backgroundColor: "#1e293b",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  periodLabel: { fontSize: 14, color: "#cbd5e1", fontWeight: "600" },
  periodRides: { fontSize: 12, color: "#475569", marginTop: 2 },
  periodAmount: { fontSize: 18, fontWeight: "700", color: "#f8fafc" },
  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 20,
    marginTop: 8,
    padding: 14,
    backgroundColor: "#1e293b",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
  },
  noteText: { fontSize: 12, color: "#475569", flex: 1, lineHeight: 18 },
});
