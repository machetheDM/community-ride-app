import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/request";
import { DOCUMENT_LABELS, sastDateTime } from "@/lib/group-trips";

interface OperatorDocument {
  kind: string;
  referenceLast4: string;
  expiresOn: string | null;
  status: "PENDING" | "VERIFIED" | "REJECTED";
  note: string | null;
}

interface Documents {
  required: string[];
  missing: string[];
  documents: OperatorDocument[];
}

interface Statement {
  owed: number;
  limit: number;
  paused: boolean;
  entries: { id: string; kind: string; amount: number; sourceType: string; note: string | null; createdAt: string }[];
}

const STATUS_COLOR = { PENDING: "#f59e0b", VERIFIED: "#22c55e", REJECTED: "#ef4444" } as const;

/**
 * An operator's documents and fees (docs/PLAN.md 3.7, 3.8).
 *
 * Documents: the number goes to the server once and comes back as its last four
 * characters; an admin checks it against the original, and a changed document
 * is checked again. Fees: every fee and payment, and what is owed, worked out
 * from them. Riders see only their fees.
 */
export default function OperatorScreen() {
  const { token, user } = useAuth();
  const isDriver = user?.role === "DRIVER";
  const [docs, setDocs] = useState<Documents | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [expires, setExpires] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [d, s] = await Promise.all([
      isDriver ? api<Documents>(token, "/api/operators/me/documents") : Promise.resolve(null),
      api<Statement>(token, "/api/operators/me/statement"),
    ]);
    if (d?.ok && d.data) setDocs(d.data);
    if (s.ok && s.data) setStatement(s.data);
    setLoading(false);
  }, [token, isDriver]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (kind: string) => {
    if (reference.trim().length < 4) {
      Alert.alert("Document number", "Type the number as it appears on the document.");
      return;
    }
    if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) {
      Alert.alert("Expiry date", "Write it as 2027-03-31, or leave it empty.");
      return;
    }
    setSaving(true);
    const res = await api(token, "/api/operators/me/documents", {
      method: "POST",
      body: { kind, reference, ...(expires ? { expiresOn: expires } : {}) },
    });
    setSaving(false);
    if (!res.ok) {
      Alert.alert("Not sent", res.error ?? "Try again.");
      return;
    }
    setEditing(null);
    setReference("");
    setExpires("");
    Alert.alert("Sent for checking", "An admin will check it against the original. You can take event trips once all four are verified.");
    await load();
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f59e0b" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      {statement && (
        <View style={[styles.card, statement.paused && { borderColor: "#ef4444", borderWidth: 1 }]}>
          <Text style={styles.label}>Fees owed</Text>
          <Text style={[styles.owed, statement.paused && { color: "#f87171" }]}>R{statement.owed.toFixed(2)}</Text>
          <Text style={styles.muted}>
            {statement.paused
              ? `Over the R${statement.limit} limit: settle it to take new work.`
              : `New work pauses above R${statement.limit}. Pay by EFT or cash and give the reference to support.`}
          </Text>
          {statement.entries.slice(0, 15).map((e) => (
            <View key={e.id} style={styles.entry}>
              <Text style={styles.muted}>
                {sastDateTime(e.createdAt)} ·{" "}
                {e.kind === "FEE_DUE" ? `fee, ${e.sourceType.toLowerCase().replace("_", " ")}` : e.kind === "FEE_PAID" ? "paid" : "correction"}
              </Text>
              <Text style={{ color: e.kind === "FEE_PAID" ? "#22c55e" : "#f8fafc" }}>
                {e.kind === "FEE_PAID" ? "−" : ""}R{e.amount.toFixed(2)}
              </Text>
            </View>
          ))}
        </View>
      )}

      {isDriver && docs && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Documents for event trips</Text>
          <Text style={styles.muted}>All four must be checked by an admin before you see group trips.</Text>
          {docs.required.map((kind) => {
            const doc = docs.documents.find((d) => d.kind === kind);
            return (
              <View key={kind} style={styles.doc}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.value}>{DOCUMENT_LABELS[kind] ?? kind}</Text>
                    <Text style={styles.muted}>
                      {doc ? `ending ${doc.referenceLast4}${doc.expiresOn ? ` · expires ${doc.expiresOn.slice(0, 10)}` : ""}` : "Not sent"}
                    </Text>
                    {doc?.status === "REJECTED" && doc.note && <Text style={{ color: "#f87171", fontSize: 13 }}>{doc.note}</Text>}
                  </View>
                  {doc ? (
                    <Text style={{ color: STATUS_COLOR[doc.status], fontWeight: "700", fontSize: 12 }}>{doc.status.toLowerCase()}</Text>
                  ) : null}
                </View>
                {editing === kind ? (
                  <View style={{ marginTop: 8 }}>
                    <TextInput
                      value={reference}
                      onChangeText={setReference}
                      autoCapitalize="characters"
                      placeholder="Document number"
                      placeholderTextColor="#475569"
                      style={styles.input}
                    />
                    <TextInput
                      value={expires}
                      onChangeText={setExpires}
                      placeholder="Expires (2027-03-31), if it does"
                      placeholderTextColor="#475569"
                      style={[styles.input, { marginTop: 6 }]}
                    />
                    <TouchableOpacity style={styles.button} onPress={() => save(kind)} disabled={saving}>
                      <Text style={styles.buttonText}>{saving ? "Sending…" : "Send for checking"}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => setEditing(kind)}>
                    <Text style={styles.linkText}>{doc ? "Replace" : "Add"}</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0f172a" },
  card: { backgroundColor: "#1e293b", borderRadius: 14, padding: 16, marginBottom: 16 },
  cardTitle: { color: "#f8fafc", fontWeight: "700", fontSize: 16 },
  label: { color: "#64748b", fontSize: 11, textTransform: "uppercase", fontWeight: "700" },
  owed: { color: "#f8fafc", fontSize: 32, fontWeight: "900", marginVertical: 4 },
  muted: { color: "#94a3b8", fontSize: 13, marginTop: 2 },
  value: { color: "#f8fafc", fontWeight: "600" },
  entry: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#334155" },
  doc: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#334155" },
  input: { backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155", borderRadius: 10, padding: 10, color: "#f8fafc" },
  button: { backgroundColor: "#f59e0b", borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 8 },
  buttonText: { color: "#0f172a", fontWeight: "800" },
  linkText: { color: "#f59e0b", fontWeight: "600", marginTop: 6 },
});
