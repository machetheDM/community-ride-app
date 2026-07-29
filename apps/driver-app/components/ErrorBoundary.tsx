import { Component, ReactNode } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error("Driver app error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            {this.state.error?.message ?? "An unexpected error occurred."}
          </Text>
          <Pressable style={styles.button} onPress={() => this.setState({ hasError: false })}>
            <Text style={styles.buttonText}>Try Again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center", padding: 24 },
  title: { color: "#f8fafc", fontSize: 20, fontWeight: "700", marginBottom: 8 },
  message: { color: "#94a3b8", fontSize: 14, textAlign: "center", marginBottom: 24 },
  button: { backgroundColor: "#22c55e", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  buttonText: { color: "#0f172a", fontWeight: "700" },
});
