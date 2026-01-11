import { HapticTab } from "@/components/HapticTab";
import { useAppTheme } from "@/contexts/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Tabs } from "expo-router";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Premium Tab Bar Icon Component with gradient background for focused state
const TabBarIcon = ({
  name,
  color,
  focused,
}: {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  focused: boolean;
}) => {
  if (focused) {
    return (
      <LinearGradient
        colors={["#3B82F6", "#2563EB"]}
        style={styles.focusedIconContainer}
      >
        <Ionicons name={name} color="#fff" size={22} />
      </LinearGradient>
    );
  }
  return (
    <View style={styles.iconContainer}>
      <Ionicons name={name} color={color} size={22} />
    </View>
  );
};

export default function DriverLayout() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const hapticTabButton = (props: any) => <HapticTab {...props} />;

  const isDark = theme === "dark";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: isDark ? "#60A5FA" : "#2563EB",
        tabBarInactiveTintColor: isDark ? "#6B7280" : "#9CA3AF",
        tabBarStyle: {
          position: "absolute",
          bottom: Platform.OS === "ios" ? 20 + insets.bottom / 2 : 8,
          left: 10,
          right: 10,
          height: 70,
          borderRadius: 24,
          backgroundColor: isDark
            ? "rgba(31, 41, 55, 0.95)"
            : "rgba(255, 255, 255, 0.98)",
          borderTopWidth: 0,
          shadowColor: isDark ? "#000" : "#F59E0B",
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: isDark ? 0.4 : 0.15,
          shadowRadius: 16,
          elevation: 12,
          paddingBottom: 0,
          paddingTop: 0,
          borderWidth: 1,
          borderColor: isDark
            ? "rgba(245, 158, 11, 0.2)"
            : "rgba(245, 158, 11, 0.1)",
        },
        tabBarItemStyle: {
          paddingVertical: 8,
          marginHorizontal: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
          marginTop: 4,
          letterSpacing: 0.2,
        },
        tabBarBackground: () =>
          isDark ? (
            <BlurView
              intensity={40}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          headerShown: false,
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon
              name={focused ? "home" : "home-outline"}
              color={color}
              focused={focused}
            />
          ),
          tabBarButton: hapticTabButton,
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          headerShown: false,
          title: "Trips",
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon
              name={focused ? "time" : "time-outline"}
              color={color}
              focused={focused}
            />
          ),
          tabBarButton: hapticTabButton,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          headerShown: false,
          title: "Profile",
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon
              name={focused ? "person" : "person-outline"}
              color={color}
              focused={focused}
            />
          ),
          tabBarButton: hapticTabButton,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  focusedIconContainer: {
    width: 42,
    height: 42,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#F59E0B",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  iconContainer: {
    width: 42,
    height: 42,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
});
