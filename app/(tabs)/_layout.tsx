import { HapticTab } from "@/components/HapticTab";
import { Colors } from "@/constants/Colors";
import { useAuth } from "@/contexts/AuthContext";
import { useAppTheme } from "@/contexts/ThemeContext";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
// ...

export default function TabLayout() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userRole = session?.user?.user_metadata?.role || "commuter";

  const hapticTabButton = (props: any) => <HapticTab {...props} />;

  const renderTabsForRole = () => {
    switch (userRole) {
      case "conductor":
        return [
          <Tabs.Screen
            key="conductor-index"
            name="conductor/index"
            options={{
              title: "Dashboard",
              tabBarAccessibilityLabel: "Conductor Dashboard",
              tabBarIcon: ({ color, size }) => (
                <MaterialIcons
                  name="dashboard"
                  color={color}
                  size={size ?? 28}
                />
              ),
              tabBarButton: hapticTabButton,
            }}
          />,
          // Add more conductor tabs here as needed
        ];
      case "driver":
        return [
          <Tabs.Screen
            key="driver-index"
            name="driver/index"
            options={{
              title: "Route",
              tabBarAccessibilityLabel: "Driver Route",
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="car-outline" color={color} size={size ?? 28} />
              ),
              tabBarButton: hapticTabButton,
            }}
          />,
          // Add more driver tabs here as needed
        ];
      case "commuter":
      default:
        return [
          <Tabs.Screen
            key="commuter-index"
            name="commuter/index"
            options={{
              headerShown: false,
              title: "Home",
              tabBarAccessibilityLabel: "Home",
              tabBarIcon: ({ color, size, focused }) => (
                <Ionicons
                  name={focused ? "home" : "home-outline"}
                  color={color}
                  size={20}
                />
              ),
              tabBarButton: hapticTabButton,
            }}
          />,
          <Tabs.Screen
            key="commuter-route"
            name="commuter/route"
            options={{
              headerShown: false,
              title: "Route",
              tabBarAccessibilityLabel: "Route",
              tabBarIcon: ({ color, size, focused }) => (
                <Ionicons
                  name={focused ? "map" : "map-outline"}
                  color={color}
                  size={20}
                />
              ),
              tabBarButton: hapticTabButton,
            }}
          />,
          <Tabs.Screen
            key="commuter-history"
            name="commuter/history"
            options={{
              headerShown: false,
              title: "History",
              tabBarAccessibilityLabel: "History",
              tabBarIcon: ({ color, size, focused }) => (
                <Ionicons
                  name={focused ? "time" : "time-outline"}
                  color={color}
                  size={20}
                />
              ),
              tabBarButton: hapticTabButton,
            }}
          />,
          <Tabs.Screen
            key="commuter-profile"
            name="commuter/profile"
            options={{
              headerShown: false,
              title: "Profile",
              tabBarAccessibilityLabel: "Profile",
              tabBarIcon: ({ color, size, focused }) => (
                <Ionicons
                  name={focused ? "person" : "person-outline"}
                  color={color}
                  size={20}
                />
              ),
              tabBarButton: hapticTabButton,
            }}
          />,
        ];
    }
  };

  return (
    <>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: Colors[theme].tint,
          tabBarInactiveTintColor: Colors[theme].tabIconDefault,
          tabBarStyle: {
            paddingBottom: 8 + insets.bottom,
            paddingTop: 0,
            backgroundColor: Colors[theme].background,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: "600",
          },
        }}
      >
        {renderTabsForRole()}
      </Tabs>
    </>
  );
}
