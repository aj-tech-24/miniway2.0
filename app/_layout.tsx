import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider, useAppTheme } from "@/contexts/ThemeContext";

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

function RootLayoutNav() {
  const { theme } = useAppTheme(); // <-- Use your context
  const { session, isLoading, role } = useAuth();
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
    if (!session && !inAuthGroup) {
      router.replace("/login");
    } else if (session && inAuthGroup) {
      const r = role || session?.user?.user_metadata?.role || "commuter";
      if (r === "driver") router.replace("/(driver)");
      else if (r === "conductor") router.replace("/(conductor)");
      else router.replace("/(commuter)");
    }
  }, [session, role, segments, isLoading, router]);

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
        <Stack.Screen name="(commuter)" />
        <Stack.Screen name="(driver)" />
        <Stack.Screen name="(conductor)" />
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
