// hooks/usePushNotifications.ts
import { supabase } from "@/lib/supabase"; // Adjust the import path as needed
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

// This configures the notification handler for when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export const usePushNotifications = () => {
  const [expoPushToken, setExpoPushToken] = useState<string | undefined>();

  useEffect(() => {
    registerForPushNotificationsAsync().then((token) => {
      if (token) {
        setExpoPushToken(token);
        // Save the token to the user's profile in Supabase
        updateUserPushToken(token);
      }
    });
  }, []);

  return { expoPushToken };
};

async function registerForPushNotificationsAsync(): Promise<
  string | undefined
> {
  let token;
  if (Device.isDevice) {
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") {
      alert("Failed to get push token for push notification!");
      return;
    }
    // The project ID is found in your app.json or app.config.js
    token = (
      await Notifications.getExpoPushTokenAsync({
        projectId: "0d76cce1-1248-4a60-9dae-ee20ac792120",
      })
    ).data;
  } else {
    alert("Must use physical device for Push Notifications");
  }

  if (Platform.OS === "android") {
    Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  }

  return token;
}

async function updateUserPushToken(token: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { error } = await supabase
      .from("users")
      .update({ push_token: token })
      .eq("id", user.id);

    if (error) {
      console.error("Error updating push token:", error.message);
    }
  }
}
