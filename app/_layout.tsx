import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
} from "@react-navigation/native";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { ImageBackground, StyleSheet } from "react-native";
import "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider, useAppTheme } from "@/contexts/ThemeContext";

function RootLayoutNav() {
  const { theme } = useAppTheme(); // <-- Use your context
  const { session, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync();
    }
  }, [isLoading]);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";

    // --- The logic now checks for the presence of a session ---
    if (!session && !inAuthGroup) {
      // If the user is not signed in and not in the auth group,
      // redirect them to the login screen.
      router.replace("/login");
    } else if (session && inAuthGroup) {
      console.log("User is signed in, redirecting to main app...");
      // If the user is signed in and in the auth group (e.g., login page),
      // redirect them to the main app.
      router.replace("/(tabs)/commuter");
    }
  }, [session, segments, isLoading, router]); // Dependency array updated to 'session'

  if (isLoading) {
    return (
      <ImageBackground
        // IMPORTANT: Make sure this path matches your actual splash screen image.
        source={require("../assets/images/splash-icon.png")}
        style={styles.container}
        width={300}
        resizeMode="contain"
      ></ImageBackground>
    );
  }

  return (
    <NavigationThemeProvider
      value={theme === "dark" ? DarkTheme : DefaultTheme} // <-- Use app theme!
    >
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" />
      </Stack>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
    </NavigationThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ThemeProvider>
          <RootLayoutNav />
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
