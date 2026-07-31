import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  FlatList,
} from "react-native";
import type { Address, LatLng, AutocompleteSuggestion } from "../types";
import type { MapsClient } from "../client";
import { newSessionToken } from "../client";

export interface AddressAutocompleteProps {
  client: MapsClient;
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
  /** Fires when the user picks a suggestion and it resolves to coordinates. */
  onSelect: (address: Address) => void;
  /** Biases results toward the rider's current position. */
  bias?: { center: LatLng; radiusMeters: number };
  testID?: string;
}

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 3;

/**
 * Address input with Google Places autocomplete.
 *
 * Three things here are deliberate and worth not "simplifying" away:
 *
 * 1. **One session token per address entry.** Minted when typing starts and reused
 *    for every keystroke *and* the final resolve, then discarded. That is what puts
 *    the interaction on the Autocomplete Session SKU, which is free at unlimited
 *    volume, instead of Per Request.
 *
 * 2. **Debounce plus a minimum query length.** Fewer upstream calls, and a
 *    two-letter query returns noise anyway.
 *
 * 3. **In-flight requests are aborted.** Without this a slow response for "Soweto"
 *    can land after a fast one for "Sowet" and repopulate the list with stale
 *    suggestions.
 */
export function AddressAutocomplete({
  client,
  placeholder = "Enter an address",
  value,
  onChangeText,
  onSelect,
  bias,
  testID,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);

  const sessionToken = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set while applying a selection, so the resulting text change does not
  // immediately trigger a fresh search for the text we just filled in.
  const selectingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const search = useCallback(
    (query: string) => {
      abortRef.current?.abort();

      if (query.trim().length < MIN_QUERY_LENGTH) {
        setSuggestions([]);
        setLoading(false);
        return;
      }

      if (!sessionToken.current) sessionToken.current = newSessionToken();

      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);

      client
        .autocomplete(query, sessionToken.current, bias, controller.signal)
        .then((results) => {
          if (controller.signal.aborted) return;
          setSuggestions(results);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          // A failed lookup must not block booking — the customer can still type a
          // full address and let the server geocode it.
          setSuggestions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    },
    [client, bias]
  );

  const handleChange = useCallback(
    (text: string) => {
      onChangeText(text);

      if (selectingRef.current) {
        selectingRef.current = false;
        return;
      }

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => search(text), DEBOUNCE_MS);
    },
    [onChangeText, search]
  );

  const handleSelect = useCallback(
    async (suggestion: AutocompleteSuggestion) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();

      selectingRef.current = true;
      onChangeText(suggestion.text);
      setSuggestions([]);
      setLoading(true);

      try {
        const token = sessionToken.current ?? newSessionToken();
        const address = await client.resolvePlace(suggestion.placeId, token);
        onSelect(address);
      } catch {
        // Leave the text in place; the server geocodes it at booking time.
      } finally {
        // The session ends whether or not resolution succeeded. Reusing it past
        // this point would bill the next entry against the same session.
        sessionToken.current = null;
        setLoading(false);
      }
    },
    [client, onChangeText, onSelect]
  );

  const showList = focused && suggestions.length > 0;

  return (
    <View style={styles.wrapper}>
      <View style={styles.inputRow}>
        <TextInput
          testID={testID}
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor="#475569"
          value={value}
          onChangeText={handleChange}
          onFocus={() => setFocused(true)}
          // Delayed so a tap on a suggestion registers before the list unmounts.
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          autoCorrect={false}
          returnKeyType="search"
        />
        {loading ? <ActivityIndicator size="small" color="#f59e0b" /> : null}
      </View>

      {showList ? (
        <View style={styles.list}>
          <FlatList
            data={suggestions}
            keyExtractor={(item) => item.placeId}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.row}
                onPress={() => handleSelect(item)}
                activeOpacity={0.7}
              >
                <Text style={styles.mainText} numberOfLines={1}>
                  {item.mainText}
                </Text>
                {item.secondaryText ? (
                  <Text style={styles.secondaryText} numberOfLines={1}>
                    {item.secondaryText}
                  </Text>
                ) : null}
              </TouchableOpacity>
            )}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: "relative", flex: 1 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, color: "#f8fafc", fontSize: 15, paddingVertical: 2 },
  list: {
    position: "absolute",
    top: 34,
    left: 0,
    right: 0,
    maxHeight: 220,
    backgroundColor: "#1e293b",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    zIndex: 20,
    elevation: 6,
  },
  row: { paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#0f172a" },
  mainText: { color: "#f8fafc", fontSize: 14, fontWeight: "600" },
  secondaryText: { color: "#64748b", fontSize: 12, marginTop: 2 },
});
