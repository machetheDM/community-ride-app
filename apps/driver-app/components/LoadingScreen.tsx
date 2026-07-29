import { View, ActivityIndicator, Text } from "react-native";

interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message = "Loading..." }: LoadingScreenProps) {
  return (
    <View style={{ flex: 1, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="large" color="#22c55e" />
      <Text style={{ marginTop: 16, color: "#94a3b8", fontSize: 14 }}>{message}</Text>
    </View>
  );
}
