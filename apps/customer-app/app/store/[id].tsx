import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, SectionList, TouchableOpacity,
  SafeAreaView, ActivityIndicator, RefreshControl,
  Modal, TextInput, KeyboardAvoidingView, Platform, ScrollView, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { API_URL } from "@/constants/api";
import { useAuth } from "@/context/AuthContext";

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: string;
  imageUrl: string | null;
  isAvailable: boolean;
}

interface Category {
  id: string;
  name: string;
  products: Product[];
}

interface StoreDetail {
  id: string;
  name: string;
  description: string | null;
  address: string;
  phone: string;
  isOpen: boolean;
  rating: number;
  deliveryFee: string;
  minimumOrder: string;
  openTime: string | null;
  closeTime: string | null;
  categories: Category[];
  _count: { products: number; orders: number };
}

interface CartItem {
  product: Product;
  qty: number;
}

export default function StoreDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { token } = useAuth();
  const [store, setStore] = useState<StoreDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "CARD">("CASH");
  const [placing, setPlacing] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);

  const fetchStore = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch(`${API_URL}/api/stores/${id}`);
      const json = await res.json();
      if (json.success) setStore(json.data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchStore(); }, [id]);

  const addToCart = (product: Product) => {
    setCart((prev) => ({
      ...prev,
      [product.id]: { product, qty: (prev[product.id]?.qty ?? 0) + 1 },
    }));
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => {
      const current = prev[productId];
      if (!current || current.qty <= 1) {
        const next = { ...prev };
        delete next[productId];
        return next;
      }
      return { ...prev, [productId]: { ...current, qty: current.qty - 1 } };
    });
  };

  const cartTotal = Object.values(cart).reduce(
    (sum, item) => sum + Number(item.product.price) * item.qty, 0
  );
  const cartCount = Object.values(cart).reduce((sum, item) => sum + item.qty, 0);
  const deliveryFee = store ? Number(store.deliveryFee) : 0;
  const orderTotal = cartTotal + deliveryFee;

  const placeOrder = async () => {
    if (!token) { Alert.alert("Please sign in first"); return; }
    if (!deliveryAddress.trim()) { Alert.alert("Enter your delivery address"); return; }
    if (!store) return;
    setPlacing(true);
    try {
      const res = await fetch(`${API_URL}/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          storeId: store.id,
          items: Object.values(cart).map((c) => ({ productId: c.product.id, quantity: c.qty })),
          deliveryAddress: deliveryAddress.trim(),
          deliveryLat: 0,
          deliveryLng: 0,
          paymentMethod,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed");
      setOrderSuccess(true);
      setCart({});
      setTimeout(() => {
        setCheckoutOpen(false);
        setOrderSuccess(false);
        setDeliveryAddress("");
        router.push("/(tabs)/orders" as never);
      }, 1800);
    } catch (e: unknown) {
      Alert.alert("Order failed", e instanceof Error ? e.message : "Please try again");
    } finally {
      setPlacing(false);
    }
  };

  const sections = store?.categories
    .filter((c) => c.products.length > 0)
    .map((c) => ({ title: c.name, data: c.products })) ?? [];

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loader}><ActivityIndicator size="large" color="#f59e0b" /></View>
      </SafeAreaView>
    );
  }

  if (!store) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loader}>
          <Ionicons name="storefront-outline" size={48} color="#334155" />
          <Text style={styles.errorText}>Store not found</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => fetchStore(true)} tintColor="#f59e0b" />
        }
        ListHeaderComponent={
          <View style={styles.storeHeader}>
            <View style={styles.heroLogo}>
              <Text style={styles.heroLogoText}>{store.name.charAt(0).toUpperCase()}</Text>
            </View>
            <Text style={styles.storeName}>{store.name}</Text>
            {store.description && <Text style={styles.storeDesc}>{store.description}</Text>}
            <View style={styles.metaRow}>
              <View style={[styles.badge, store.isOpen ? styles.badgeOpen : styles.badgeClosed]}>
                <Text style={[styles.badgeText, store.isOpen ? styles.badgeOpenText : styles.badgeClosedText]}>
                  {store.isOpen ? "Open Now" : "Closed"}
                  {store.openTime && store.closeTime ? ` · ${store.openTime}–${store.closeTime}` : ""}
                </Text>
              </View>
              <View style={styles.metaItem}>
                <Ionicons name="star" size={13} color="#f59e0b" />
                <Text style={styles.metaText}>{store.rating.toFixed(1)}</Text>
              </View>
              <Text style={styles.metaDot}>·</Text>
              <Text style={styles.metaText}>{store._count.orders} orders</Text>
            </View>
            <View style={styles.infoRow}>
              <View style={styles.infoItem}>
                <Ionicons name="bicycle-outline" size={16} color="#64748b" />
                <Text style={styles.infoText}>R{Number(store.deliveryFee).toFixed(0)} delivery</Text>
              </View>
              <View style={styles.infoItem}>
                <Ionicons name="cart-outline" size={16} color="#64748b" />
                <Text style={styles.infoText}>Min R{Number(store.minimumOrder).toFixed(0)}</Text>
              </View>
              <View style={styles.infoItem}>
                <Ionicons name="location-outline" size={16} color="#64748b" />
                <Text style={styles.infoText} numberOfLines={1}>{store.address}</Text>
              </View>
            </View>
            {sections.length > 0 && <Text style={styles.menuLabel}>Menu</Text>}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const qty = cart[item.id]?.qty ?? 0;
          return (
            <View style={styles.productCard}>
              <View style={styles.productInfo}>
                <Text style={styles.productName}>{item.name}</Text>
                {item.description && (
                  <Text style={styles.productDesc} numberOfLines={2}>{item.description}</Text>
                )}
                <Text style={styles.productPrice}>R{Number(item.price).toFixed(2)}</Text>
              </View>
              <View style={styles.qtyControl}>
                {qty > 0 ? (
                  <>
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => removeFromCart(item.id)}>
                      <Ionicons name="remove" size={16} color="#f59e0b" />
                    </TouchableOpacity>
                    <Text style={styles.qtyText}>{qty}</Text>
                  </>
                ) : null}
                <TouchableOpacity style={styles.addBtn} onPress={() => addToCart(item)}>
                  <Ionicons name="add" size={18} color="#0f172a" />
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyMenu}>
            <Ionicons name="fast-food-outline" size={48} color="#334155" />
            <Text style={styles.emptyText}>No products yet</Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: cartCount > 0 ? 100 : 24 }}
      />

      {cartCount > 0 && (
        <TouchableOpacity style={styles.cartBar} activeOpacity={0.85} onPress={() => setCheckoutOpen(true)}>
          <View style={styles.cartLeft}>
            <View style={styles.cartBadge}><Text style={styles.cartBadgeText}>{cartCount}</Text></View>
            <Text style={styles.cartBarText}>View Cart</Text>
          </View>
          <Text style={styles.cartTotal}>R{orderTotal.toFixed(2)}</Text>
        </TouchableOpacity>
      )}

      {/* ── Checkout Modal ── */}
      <Modal visible={checkoutOpen} animationType="slide" transparent onRequestClose={() => !placing && setCheckoutOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            {orderSuccess ? (
              <View style={styles.successBox}>
                <View style={styles.successIcon}>
                  <Ionicons name="checkmark" size={36} color="#10b981" />
                </View>
                <Text style={styles.successTitle}>Order Placed!</Text>
                <Text style={styles.successSub}>Taking you to your orders…</Text>
              </View>
            ) : (
              <>
                <View style={styles.sheetHandle} />
                <View style={styles.sheetHeader}>
                  <Text style={styles.sheetTitle}>Checkout</Text>
                  <TouchableOpacity onPress={() => setCheckoutOpen(false)} disabled={placing}>
                    <Ionicons name="close" size={22} color="#64748b" />
                  </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>
                  {/* Cart items */}
                  <Text style={styles.sectionLabel}>Your order</Text>
                  {Object.values(cart).map(({ product, qty }) => (
                    <View key={product.id} style={styles.cartLine}>
                      <Text style={styles.cartLineName} numberOfLines={1}>{qty}× {product.name}</Text>
                      <Text style={styles.cartLinePrice}>R{(Number(product.price) * qty).toFixed(2)}</Text>
                    </View>
                  ))}
                  <View style={styles.divider} />
                  <View style={styles.cartLine}>
                    <Text style={styles.cartLineSub}>Subtotal</Text>
                    <Text style={styles.cartLineSub}>R{cartTotal.toFixed(2)}</Text>
                  </View>
                  <View style={styles.cartLine}>
                    <Text style={styles.cartLineSub}>Delivery fee</Text>
                    <Text style={styles.cartLineSub}>R{deliveryFee.toFixed(2)}</Text>
                  </View>
                  <View style={styles.cartLine}>
                    <Text style={styles.cartLineTotal}>Total</Text>
                    <Text style={styles.cartLineTotal}>R{orderTotal.toFixed(2)}</Text>
                  </View>

                  {/* Delivery address */}
                  <Text style={styles.sectionLabel}>Delivery address</Text>
                  <View style={styles.inputBox}>
                    <Ionicons name="location-outline" size={16} color="#64748b" />
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. 12 Main St, Soweto"
                      placeholderTextColor="#475569"
                      value={deliveryAddress}
                      onChangeText={setDeliveryAddress}
                      returnKeyType="done"
                    />
                  </View>

                  {/* Payment method */}
                  <Text style={styles.sectionLabel}>Payment</Text>
                  <View style={styles.payRow}>
                    {(["CASH", "CARD"] as const).map((m) => (
                      <TouchableOpacity
                        key={m}
                        style={[styles.payOption, paymentMethod === m && styles.payOptionActive]}
                        onPress={() => setPaymentMethod(m)}
                      >
                        <Ionicons
                          name={m === "CASH" ? "cash-outline" : "card-outline"}
                          size={18}
                          color={paymentMethod === m ? "#f59e0b" : "#64748b"}
                        />
                        <Text style={[styles.payLabel, paymentMethod === m && styles.payLabelActive]}>{m}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>

                <TouchableOpacity
                  style={[styles.placeBtn, placing && { opacity: 0.6 }]}
                  onPress={placeOrder}
                  disabled={placing}
                >
                  {placing ? (
                    <ActivityIndicator color="#0f172a" />
                  ) : (
                    <Text style={styles.placeBtnText}>Place Order · R{orderTotal.toFixed(2)}</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  loader: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  errorText: { fontSize: 16, color: "#475569" },
  backBtn: { backgroundColor: "#1e293b", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  backBtnText: { color: "#f8fafc", fontWeight: "600" },
  storeHeader: { padding: 20, gap: 10 },
  heroLogo: {
    width: 72, height: 72, borderRadius: 20, backgroundColor: "#f59e0b20",
    borderWidth: 1, borderColor: "#f59e0b40", alignItems: "center", justifyContent: "center",
  },
  heroLogoText: { fontSize: 30, fontWeight: "800", color: "#f59e0b" },
  storeName: { fontSize: 22, fontWeight: "800", color: "#f8fafc" },
  storeDesc: { fontSize: 13, color: "#64748b", lineHeight: 18 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeOpen: { backgroundColor: "#10b98120" },
  badgeClosed: { backgroundColor: "#ef444420" },
  badgeText: { fontSize: 12, fontWeight: "700" },
  badgeOpenText: { color: "#10b981" },
  badgeClosedText: { color: "#ef4444" },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 13, color: "#94a3b8" },
  metaDot: { color: "#475569" },
  infoRow: { gap: 6 },
  infoItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  infoText: { fontSize: 13, color: "#64748b", flex: 1 },
  menuLabel: { fontSize: 18, fontWeight: "800", color: "#f8fafc", marginTop: 8 },
  sectionHeader: {
    backgroundColor: "#0f172a", paddingHorizontal: 20, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: "#1e293b",
  },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5 },
  productCard: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: "#1e293b", gap: 12,
  },
  productInfo: { flex: 1, gap: 3 },
  productName: { fontSize: 14, fontWeight: "600", color: "#f8fafc" },
  productDesc: { fontSize: 12, color: "#64748b", lineHeight: 16 },
  productPrice: { fontSize: 14, fontWeight: "700", color: "#f59e0b", marginTop: 2 },
  qtyControl: { flexDirection: "row", alignItems: "center", gap: 8 },
  qtyBtn: {
    width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: "#f59e0b60",
    alignItems: "center", justifyContent: "center",
  },
  qtyText: { fontSize: 14, fontWeight: "700", color: "#f8fafc", minWidth: 16, textAlign: "center" },
  addBtn: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: "#f59e0b",
    alignItems: "center", justifyContent: "center",
  },
  emptyMenu: { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyText: { fontSize: 15, color: "#475569" },
  cartBar: {
    position: "absolute", bottom: 16, left: 16, right: 16,
    backgroundColor: "#f59e0b", borderRadius: 16, paddingHorizontal: 20, paddingVertical: 14,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  cartLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  cartBadge: {
    backgroundColor: "#0f172a", width: 24, height: 24, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  cartBadgeText: { fontSize: 12, fontWeight: "800", color: "#f59e0b" },
  cartBarText: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  cartTotal: { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  modalSheet: {
    backgroundColor: "#1e293b", borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 36, maxHeight: "85%", paddingTop: 8,
  },
  sheetHandle: { width: 36, height: 4, backgroundColor: "#334155", borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: "#f8fafc" },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 16, marginBottom: 8 },
  cartLine: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  cartLineName: { flex: 1, fontSize: 14, color: "#f8fafc", marginRight: 8 },
  cartLinePrice: { fontSize: 14, fontWeight: "600", color: "#f8fafc" },
  cartLineSub: { fontSize: 13, color: "#64748b" },
  cartLineTotal: { fontSize: 15, fontWeight: "800", color: "#f59e0b" },
  divider: { height: 1, backgroundColor: "#334155", marginVertical: 8 },
  inputBox: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#0f172a", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: "#334155",
  },
  input: { flex: 1, color: "#f8fafc", fontSize: 14 },
  payRow: { flexDirection: "row", gap: 12, marginBottom: 8 },
  payOption: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#0f172a", borderRadius: 12, paddingVertical: 12,
    borderWidth: 1, borderColor: "#334155",
  },
  payOptionActive: { borderColor: "#f59e0b60", backgroundColor: "#f59e0b10" },
  payLabel: { fontSize: 14, fontWeight: "600", color: "#64748b" },
  payLabelActive: { color: "#f59e0b" },
  placeBtn: {
    backgroundColor: "#f59e0b", borderRadius: 16, paddingVertical: 16,
    alignItems: "center", marginTop: 20,
  },
  placeBtnText: { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  successBox: { alignItems: "center", paddingVertical: 48, gap: 12 },
  successIcon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: "#10b98120",
    borderWidth: 2, borderColor: "#10b98150", alignItems: "center", justifyContent: "center",
  },
  successTitle: { fontSize: 22, fontWeight: "800", color: "#f8fafc" },
  successSub: { fontSize: 14, color: "#64748b" },
});
