import { View, Text, StyleSheet, FlatList, SafeAreaView } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function HistoryScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Trip History</Text>
      </View>
      <FlatList
        data={[]}
        keyExtractor={(item) => String(item)}
        renderItem={null}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="time-outline" size={56} color="#334155" />
            <Text style={styles.emptyTitle}>No trips yet</Text>
            <Text style={styles.emptySub}>Your completed rides and deliveries will appear here</Text>
          </View>
        }
        contentContainerStyle={{ flexGrow: 1 }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#1e293b" },
  title: { fontSize: 22, fontWeight: "700", color: "#f8fafc" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: "#475569" },
  emptySub: { fontSize: 13, color: "#334155", textAlign: "center", lineHeight: 20 },
});
