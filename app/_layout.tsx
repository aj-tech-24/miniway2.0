import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider, useAppTheme } from "@/contexts/ThemeContext";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
} from "@react-navigation/native";
import * as Font from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";

import * as Notifications from "expo-notifications";
import React, { useEffect, useState } from "react";
import { ImageBackground, Platform, StyleSheet } from "react-native";
import "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";

import registerNNPushToken from "native-notify";

registerNNPushToken(32035, "C3YxvEGRY2D8OydDIV4Wvf"); // ← register device for broadcast

Notifications.addNotificationReceivedListener((n) => {
  console.log("RX notification content:", n.request?.content);
});
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});
if (Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("default", {
    name: "default",
    importance: Notifications.AndroidImportance.MAX,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    showBadge: true,
    enableVibrate: true,
  });
}

function RootLayoutNav() {
  const { theme } = useAppTheme(); // <-- Use your context
  const { session, isLoading, role } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [fontsLoaded, setFontsLoaded] = useState(false);

  useEffect(() => {
    const loadFonts = async () => {
      try {
        await Font.loadAsync({
          SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
        });
        setFontsLoaded(true);
      } catch (error) {
        console.warn("Font loading failed:", error);
        setFontsLoaded(true); // Continue even if fonts fail to load
      }
    };

    loadFonts();
  }, []);

  useEffect(() => {
    if (!isLoading && fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [isLoading, fontsLoaded]);

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

  if (isLoading || !fontsLoaded) {
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
