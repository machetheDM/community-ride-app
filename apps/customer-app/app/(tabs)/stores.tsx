import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  SafeAreaView, TextInput, RefreshControl, ActivityIndicator,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { API_URL } from "@/constants/api";

const CATEGORIES = ["All", "Food", "Grocery", "Pharmacy", "Fashion", "Hardware"];

interface Store {
  id: string;
  name: string;
  description: string | null;
  address: string;
  logoUrl: string | null;
  isOpen: boolean;
  rating: number;
  deliveryFee: string;
  minimumOrder: string;
  openTime: string | null;
  closeTime: string | null;
  categories: { id: string; name: string }[];
  _count: { products: number; orders: number };
}

export default function StoresScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchStores = useCallback(async (q: string, cat: string, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const params = new URLSearchParams({ ...(q ? { search: q } : {}), ...(cat !== "All" ? { category: cat } : {}) });
      const res = await fetch(`${API_URL}/api/stores?${params}`);
      const json = await res.json();
      if (json.success) setStores(json.data);
    } catch {
      setStores([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchStores(search, activeCategory), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, activeCategory, fetchStores]);

  const renderStore = ({ item }: { item: Store }) => (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.8}
      onPress={() => router.push({ pathname: "/store/[id]", params: { id: item.id } })}
    >
      <View style={styles.cardHeader}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>{item.name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.cardInfo}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.storeName} numberOfLines={1}>{item.name}</Text>
            <View style={[styles.badge, item.isOpen ? styles.badgeOpen : styles.badgeClosed]}>
              <Text style={[styles.badgeText, item.isOpen ? styles.badgeOpenText : styles.badgeClosedText]}>
                {item.isOpen ? "Open" : "Closed"}
              </Text>
            </View>
          </View>
          <Text style={styles.storeAddress} numberOfLines={1}>
            <Ionicons name="location-outline" size={11} color="#64748b" /> {item.address}
          </Text>
          <View style={styles.cardMeta}>
            <View style={styles.metaItem}>
              <Ionicons name="star" size={12} color="#f59e0b" />
              <Text style={styles.metaText}>{item.rating.toFixed(1)}</Text>
            </View>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>R{Number(item.deliveryFee).toFixed(0)} delivery</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>Min R{Number(item.minimumOrder).toFixed(0)}</Text>
          </View>
        </View>
      </View>
      {item.categories.length > 0 && (
        <View style={styles.catRow}>
          {item.categories.slice(0, 3).map((c) => (
            <View key={c.id} style={styles.catTag}>
              <Text style={styles.catTagText}>{c.name}</Text>
            </View>
          ))}
          <Text style={styles.productCount}>{item._count.products} items</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Local Stores</Text>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color="#64748b" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search stores or products..."
            placeholderTextColor="#475569"
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={16} color="#475569" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll} contentContainerStyle={styles.categories}>
        {CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat}
            style={[styles.catChip, activeCategory === cat && styles.catChipActive]}
            onPress={() => setActiveCategory(cat)}
          >
            <Text style={[styles.catText, activeCategory === cat && styles.catTextActive]}>{cat}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading && !refreshing ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#f59e0b" />
        </View>
      ) : (
        <FlatList
          data={stores}
          keyExtractor={(item) => item.id}
          renderItem={renderStore}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchStores(search, activeCategory, true)}
              tintColor="#f59e0b"
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="storefront-outline" size={56} color="#334155" />
              <Text style={styles.emptyTitle}>
                {search ? "No stores found" : "No stores yet"}
              </Text>
              <Text style={styles.emptySub}>
                {search ? `No results for "${search}"` : "Approved stores in your area will appear here"}
              </Text>
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
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, gap: 12 },
  title: { fontSize: 22, fontWeight: "700", color: "#f8fafc" },
  searchBar: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#1e293b",
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    borderWidth: 1, borderColor: "#334155",
  },
  searchInput: { flex: 1, color: "#f8fafc", fontSize: 14 },
  catScroll: { maxHeight: 48 },
  categories: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  catChip: {
    paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20,
    backgroundColor: "#1e293b", borderWidth: 1, borderColor: "#334155",
  },
  catChipActive: { backgroundColor: "#f59e0b20", borderColor: "#f59e0b60" },
  catText: { fontSize: 13, color: "#64748b", fontWeight: "500" },
  catTextActive: { color: "#f59e0b", fontWeight: "700" },
  loader: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: {
    marginHorizontal: 16, marginTop: 12, backgroundColor: "#1e293b",
    borderRadius: 16, borderWidth: 1, borderColor: "#334155", padding: 14, gap: 10,
  },
  cardHeader: { flexDirection: "row", gap: 12 },
  logo: {
    width: 52, height: 52, borderRadius: 14, backgroundColor: "#f59e0b20",
    borderWidth: 1, borderColor: "#f59e0b40", alignItems: "center", justifyContent: "center",
  },
  logoText: { fontSize: 22, fontWeight: "800", color: "#f59e0b" },
  cardInfo: { flex: 1, gap: 4 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  storeName: { flex: 1, fontSize: 15, fontWeight: "700", color: "#f8fafc" },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeOpen: { backgroundColor: "#10b98120" },
  badgeClosed: { backgroundColor: "#ef444420" },
  badgeText: { fontSize: 11, fontWeight: "700" },
  badgeOpenText: { color: "#10b981" },
  badgeClosedText: { color: "#ef4444" },
  storeAddress: { fontSize: 12, color: "#64748b" },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaText: { fontSize: 12, color: "#94a3b8" },
  metaDot: { color: "#475569", fontSize: 12 },
  catRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  catTag: { backgroundColor: "#0f172a", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  catTagText: { fontSize: 11, color: "#64748b" },
  productCount: { marginLeft: "auto" as never, fontSize: 11, color: "#475569" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 40, paddingTop: 80 },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: "#475569" },
  emptySub: { fontSize: 13, color: "#334155", textAlign: "center", lineHeight: 20 },
});
