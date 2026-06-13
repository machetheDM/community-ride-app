import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { useNotifications } from "@/hooks/useNotifications";

function NavigationGuard() {
  const { user, token, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  useNotifications(token);

  useEffect(() => {
    if (isLoading) return;
    const inAuth = segments[0] === "(auth)";
    if (!user && !inAuth) router.replace("/(auth)/login");
    if (user && inAuth) router.replace("/(tabs)");
  }, [user, isLoading, segments]);

  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <NavigationGuard />
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen
            name="ride/[id]"
            options={{
              headerShown: true,
              headerTitle: "Ride Details",
              headerStyle: { backgroundColor: "#0f172a" },
              headerTintColor: "#f8fafc",
            }}
          />
          <Stack.Screen
            name="store/[id]"
            options={{
              headerShown: true,
              headerTitle: "Store",
              headerStyle: { backgroundColor: "#0f172a" },
              headerTintColor: "#f8fafc",
            }}
          />
          <Stack.Screen
            name="ride/book"
            options={{ headerShown: false }}
          />
        </Stack>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
