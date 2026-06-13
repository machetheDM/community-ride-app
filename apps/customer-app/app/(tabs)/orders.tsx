import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  SafeAreaView, RefreshControl, ActivityIndicator, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { API_URL } from "@/constants/api";

const STATUS_TABS = [
  { key: "ALL", label: "All" },
  { key: "PENDING,CONFIRMED,PREPARING,READY_FOR_PICKUP,OUT_FOR_DELIVERY", label: "Active" },
  { key: "DELIVERED", label: "Delivered" },
  { key: "CANCELLED", label: "Cancelled" },
];

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  PENDING:           { label: "Pending",        color: "#3b82f6", bg: "#3b82f620" },
  CONFIRMED:         { label: "Confirmed",       color: "#6366f1", bg: "#6366f120" },
  PREPARING:         { label: "Preparing",       color: "#f59e0b", bg: "#f59e0b20" },
  READY_FOR_PICKUP:  { label: "Ready",           color: "#f97316", bg: "#f9731620" },
  OUT_FOR_DELIVERY:  { label: "On the way",      color: "#f97316", bg: "#f9731620" },
  DELIVERED:         { label: "Delivered",       color: "#10b981", bg: "#10b98120" },
  CANCELLED:         { label: "Cancelled",       color: "#ef4444", bg: "#ef444420" },
};

interface OrderItem {
  id: string;
  quantity: number;
  unitPrice: string;
  product: { id: string; name: string };
}

interface Order {
  id: string;
  status: string;
  total: string;
  subtotal: string;
  deliveryFee: string;
  createdAt: string;
  store: { id: string; name: string; address: string };
  items: OrderItem[];
}

export default function OrdersScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState(0);

  const fetchOrders = useCallback(async (isRefresh = false) => {
    if (!token) { setLoading(false); return; }
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const tabKey = STATUS_TABS[activeTab].key;
      const params = tabKey !== "ALL" ? `?status=${tabKey.split(",")[0]}` : "";
      const res = await fetch(`${API_URL}/api/orders${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) {
        const allOrders: Order[] = json.data.items;
        if (tabKey === "ALL") {
          setOrders(allOrders);
        } else {
          const validStatuses = tabKey.split(",");
          setOrders(allOrders.filter((o) => validStatuses.includes(o.status)));
        }
      }
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, activeTab]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
  };

  const renderOrder = ({ item }: { item: Order }) => {
    const meta = STATUS_META[item.status] ?? { label: item.status, color: "#94a3b8", bg: "#94a3b820" };
    const itemSummary = item.items.slice(0, 2).map((i) => `${i.quantity}× ${i.product.name}`).join(", ");
    const extra = item.items.length > 2 ? ` +${item.items.length - 2} more` : "";

    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.8}>
        <View style={styles.cardTop}>
          <View style={styles.storeLogoBox}>
            <Text style={styles.storeLogoText}>{item.store.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.cardMain}>
            <Text style={styles.storeName} numberOfLines={1}>{item.store.name}</Text>
            <Text style={styles.orderDate}>{formatDate(item.createdAt)}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
            <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
          </View>
        </View>

        <Text style={styles.itemSummary} numberOfLines={1}>{itemSummary}{extra}</Text>

        <View style={styles.cardFooter}>
          <Text style={styles.totalLabel}>
            {item.items.length} item{item.items.length !== 1 ? "s" : ""}
          </Text>
          <Text style={styles.totalAmount}>R{Number(item.total).toFixed(2)}</Text>
        </View>

        {(item.status === "DELIVERED") && (
          <TouchableOpacity style={styles.reorderBtn}>
            <Ionicons name="refresh-outline" size={14} color="#f59e0b" />
            <Text style={styles.reorderText}>Reorder</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Orders</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabs}>
        {STATUS_TABS.map((tab, idx) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === idx && styles.tabActive]}
            onPress={() => setActiveTab(idx)}
          >
            <Text style={[styles.tabText, activeTab === idx && styles.tabTextActive]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading && !refreshing ? (
        <View style={styles.loader}><ActivityIndicator size="large" color="#f59e0b" /></View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          renderItem={renderOrder}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => fetchOrders(true)} tintColor="#f59e0b" />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="bag-handle-outline" size={56} color="#334155" />
              <Text style={styles.emptyTitle}>No orders yet</Text>
              <Text style={styles.emptySub}>Your orders from local stores will appear here</Text>
              <TouchableOpacity style={styles.shopBtn} onPress={() => router.push("/(tabs)/stores" as never)}>
                <Text style={styles.shopBtnText}>Browse Stores</Text>
              </TouchableOpacity>
            </View>
          }
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 20 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#1e293b" },
  title: { fontSize: 22, fontWeight: "700", color: "#f8fafc" },
  tabScroll: { maxHeight: 48 },
  tabs: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  tab: {
    paddingHorizontal: 18, paddingVertical: 7, borderRadius: 20,
    backgroundColor: "#1e293b", borderWidth: 1, borderColor: "#334155",
  },
  tabActive: { backgroundColor: "#f59e0b20", borderColor: "#f59e0b60" },
  tabText: { fontSize: 13, color: "#64748b", fontWeight: "500" },
  tabTextActive: { color: "#f59e0b", fontWeight: "700" },
  loader: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: {
    marginHorizontal: 16, marginTop: 12, backgroundColor: "#1e293b",
    borderRadius: 16, borderWidth: 1, borderColor: "#334155", padding: 14, gap: 8,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  storeLogoBox: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: "#f59e0b20",
    borderWidth: 1, borderColor: "#f59e0b40", alignItems: "center", justifyContent: "center",
  },
  storeLogoText: { fontSize: 16, fontWeight: "800", color: "#f59e0b" },
  cardMain: { flex: 1 },
  storeName: { fontSize: 14, fontWeight: "700", color: "#f8fafc" },
  orderDate: { fontSize: 12, color: "#475569", marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 11, fontWeight: "700" },
  itemSummary: { fontSize: 12, color: "#64748b" },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 2 },
  totalLabel: { fontSize: 12, color: "#475569" },
  totalAmount: { fontSize: 15, fontWeight: "800", color: "#f59e0b" },
  reorderBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    borderWidth: 1, borderColor: "#f59e0b40", borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6, marginTop: 2,
  },
  reorderText: { fontSize: 12, fontWeight: "700", color: "#f59e0b" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 40, paddingTop: 80 },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: "#475569" },
  emptySub: { fontSize: 13, color: "#334155", textAlign: "center", lineHeight: 20 },
  shopBtn: { marginTop: 8, backgroundColor: "#f59e0b", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  shopBtnText: { fontSize: 14, fontWeight: "700", color: "#0f172a" },
});
