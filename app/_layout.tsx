import NoInternetScreen from "@/components/NoInternetScreen";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { RouteProvider } from "@/contexts/RouteContext";
import { ThemeProvider, useAppTheme } from "@/contexts/ThemeContext";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
} from "@react-navigation/native";
import * as Font from "expo-font";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";

import { Ionicons } from "@expo/vector-icons";
import { useNetInfo } from "@react-native-community/netinfo";
import * as Notifications from "expo-notifications";
import registerNNPushToken from "native-notify";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  View
} from "react-native";
import "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";

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

// Custom Premium Dark Theme
const PremiumDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: "#3B82F6",
    background: "#111827",
    card: "#1F2937",
    text: "#F9FAFB",
    border: "#374151",
    notification: "#3B82F6",
  },
};

// Custom Premium Light Theme
const PremiumLightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: "#2563EB",
    background: "#F8FAFC",
    card: "#FFFFFF",
    text: "#111827",
    border: "#E5E7EB",
    notification: "#2563EB",
  },
};

function RootLayoutNav() {
  const { theme } = useAppTheme();
  const { session, isLoading, role, sessionKicked, clearSessionKicked } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const netInfo = useNetInfo();

  registerNNPushToken(32035, "C3YxvEGRY2D8OydDIV4Wvf");

  // Handle session kicked alert
  useEffect(() => {
    if (sessionKicked) {
      Alert.alert(
        "Session Expired",
        "You have been logged out because your account was accessed from another device. Only one active session is allowed per account.",
        [
          {
            text: "OK",
            onPress: () => {
              clearSessionKicked();
              router.replace("/login");
            },
          },
        ],
        { cancelable: false }
      );
    }
  }, [sessionKicked]);

  useEffect(() => {
    const loadFonts = async () => {
      try {
        await Font.loadAsync({
          SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
        });
        setFontsLoaded(true);
      } catch (error) {
        console.warn("Font loading failed:", error);
        setFontsLoaded(true);
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
    } else if (session) {
      const r = role || session?.user?.user_metadata?.role || "commuter";

      if (inAuthGroup) {
        if (r === "driver") router.replace("/(driver)");
        else if (r === "conductor") router.replace("/(conductor)");
        else router.replace("/(commuter)");
      } else {
        const currentSegment = segments[0];

        if (r === "driver") {
          if (
            currentSegment === "(commuter)" ||
            currentSegment === "(conductor)"
          ) {
            router.replace("/(driver)");
          }
        } else if (r === "conductor") {
          if (currentSegment === "(driver)" || currentSegment === "(commuter)") {
            router.replace("/(conductor)");
          }
        } else if (r === "commuter") {
          if (currentSegment === "(driver)" || currentSegment === "(conductor)") {
            router.replace("/(commuter)");
          }
        }
      }
    }
  }, [session, role, segments, isLoading, router]);

  // No internet screen
  if (netInfo.isConnected === false) {
    return (
      <NavigationThemeProvider
        value={theme === "dark" ? PremiumDarkTheme : PremiumLightTheme}
      >
        <NoInternetScreen />
        <StatusBar style={theme === "dark" ? "light" : "dark"} />
      </NavigationThemeProvider>
    );
  }

  // Premium Loading Screen
  if (isLoading || !fontsLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <LinearGradient
          colors={
            theme === "dark"
              ? ["#111827", "#1F2937", "#111827"]
              : ["#F8FAFC", "#EFF6FF", "#F8FAFC"]
          }
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.loadingContent}>
          <LinearGradient
            colors={["#3B82F6", "#2563EB", "#1D4ED8"]}
            style={styles.loadingIconContainer}
          >
            <Ionicons name="bus" size={48} color="#fff" />
          </LinearGradient>
          <Text
            style={[
              styles.loadingTitle,
              { color: theme === "dark" ? "#F9FAFB" : "#111827" },
            ]}
          >
            Miniway
          </Text>
          <Text
            style={[
              styles.loadingSubtitle,
              { color: theme === "dark" ? "#9CA3AF" : "#6B7280" },
            ]}
          >
            Smart Transit Companion
          </Text>
          <ActivityIndicator
            size="small"
            color={theme === "dark" ? "#60A5FA" : "#3B82F6"}
            style={styles.loadingIndicator}
          />
        </View>
        <StatusBar style={theme === "dark" ? "light" : "dark"} />
      </View>
    );
  }

  return (
    <NavigationThemeProvider
      value={theme === "dark" ? PremiumDarkTheme : PremiumLightTheme}
    >
      <NoInternetScreen />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: "fade",
          contentStyle: {
            backgroundColor:
              theme === "dark" ? "#111827" : "#F8FAFC",
          },
        }}
      >
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
        <RouteProvider>
          <ThemeProvider>
            <RootLayoutNav />
          </ThemeProvider>
        </RouteProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingContent: {
    alignItems: "center",
  },
  loadingIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
    shadowColor: "#3B82F6",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
  },
  loadingTitle: {
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  loadingSubtitle: {
    fontSize: 15,
    fontWeight: "500",
    letterSpacing: 0.3,
    marginBottom: 32,
  },
  loadingIndicator: {
    marginTop: 8,
  },
});
