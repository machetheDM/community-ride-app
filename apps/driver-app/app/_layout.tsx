import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LoadingScreen } from "@/components/LoadingScreen";

function NavigationGuard() {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    const inAuth = segments[0] === "(auth)";
    if (!user && !inAuth) router.replace("/(auth)/login");
    if (user && inAuth) router.replace("/(tabs)");
  }, [user, isLoading, segments]);

  if (isLoading) return <LoadingScreen message="Starting up..." />;
  return null;
}

function AppStack() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen
        name="ride/[id]"
        options={{
          headerShown: true,
          headerTitle: "Active Ride",
          headerStyle: { backgroundColor: "#0f172a" },
          headerTintColor: "#f8fafc",
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <AuthProvider>
          <NavigationGuard />
          <StatusBar style="light" />
          <AppStack />
        </AuthProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
