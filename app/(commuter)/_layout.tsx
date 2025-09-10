import { HapticTab } from "@/components/HapticTab";
import { Colors } from "@/constants/Colors";
import { useAppTheme } from "@/contexts/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function CommuterTabs() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const hapticTabButton = (props: any) => <HapticTab {...props} />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[theme].tint,
        tabBarInactiveTintColor: Colors[theme].tabIconDefault,
        tabBarStyle: {
          paddingBottom: 8 + insets.bottom,
          paddingTop: 0,
          backgroundColor: Colors[theme].background,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          headerShown: false,
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "home" : "home-outline"}
              color={color}
              size={20}
            />
          ),
          tabBarButton: hapticTabButton,
        }}
      />
      <Tabs.Screen
        name="route"
        options={{
          headerShown: false,
          title: "Route",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "map" : "map-outline"}
              color={color}
              size={20}
            />
          ),
          tabBarButton: hapticTabButton,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          headerShown: false,
          title: "History",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "time" : "time-outline"}
              color={color}
              size={20}
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
            <Ionicons
              name={focused ? "person" : "person-outline"}
              color={color}
              size={20}
            />
          ),
          tabBarButton: hapticTabButton,
        }}
      />
    </Tabs>
  );
}
