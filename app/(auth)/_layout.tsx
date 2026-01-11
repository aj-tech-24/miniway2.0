import { useAppTheme } from "@/contexts/ThemeContext";
import { Stack } from "expo-router";
import React from "react";

export default function AuthLayout() {
  const { theme } = useAppTheme();
  const isDark = theme === "dark";

  return (
    <Stack
      screenOptions={{
        // Premium slide animation for auth screens
        animation: "slide_from_right",
        headerShown: false,
        contentStyle: {
          backgroundColor: isDark ? "#111827" : "#F8FAFC",
        },
        // Smooth gesture-based navigation
        gestureEnabled: true,
        gestureDirection: "horizontal",
        // Custom animation configuration
        animationDuration: 250,
      }}
    >
      <Stack.Screen
        name="login"
        options={{
          animation: "fade",
        }}
      />
      <Stack.Screen
        name="signup"
        options={{
          animation: "slide_from_right",
        }}
      />
      <Stack.Screen
        name="verify-email"
        options={{
          animation: "slide_from_bottom",
        }}
      />
      <Stack.Screen
        name="role-request"
        options={{
          animation: "slide_from_right",
        }}
      />
    </Stack>
  );
}
