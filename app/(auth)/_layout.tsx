import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        // Set the animation for all screens in this stack to 'fade'
        animation: "fade",
        headerShown: false,
      }}
    >
      {/* The screen components no longer need individual options */}
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="verify-email" />
    </Stack>
  );
}
