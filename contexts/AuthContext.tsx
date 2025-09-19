import { supabase } from "@/lib/supabase";
import { Session } from "@supabase/supabase-js";
import { registerIndieID } from "native-notify";
import React, { createContext, useContext, useEffect, useState } from "react";

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

if (Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("default", {
    name: "default",
    importance: Notifications.AndroidImportance.MAX,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    showBadge: true,
    enableVibrate: true,
  });
}

async function ensureNotificationPermission() {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") {
    const { status: newStatus } = await Notifications.requestPermissionsAsync();
    if (newStatus !== "granted") {
      console.warn("Push permission not granted");
      return false;
    }
  }
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
    });
  }
  return true;
}

// The context now provides the session directly.
const AuthContext = createContext<{
  session: Session | null;
  signOut: () => void;
  isLoading: boolean;
  role: string | null;
}>({
  session: null,
  signOut: () => {},
  isLoading: true,
  role: null,
});

export const useAuth = () => {
  return useContext(AuthContext);
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);

  // Function to register for push notifications
  const registerForPushNotifications = async (userId: string) => {
    try {
      const appId = 32035;
      const appToken = "C3YxvEGRY2D8OydDIV4Wvf";

      if (appId && appToken) {
        await registerIndieID(userId, appId, appToken);
        console.log("Successfully registered for push notifications");
        return true;
      } else {
        console.warn("NativeNotify credentials not found in app config");
        return false;
      }
    } catch (error) {
      console.error("Failed to register for push notifications:", error);
      return false;
    }
  };

  useEffect(() => {
    const loadSession = async () => {
      setIsLoading(true);

      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
      setRole(data.session?.user?.user_metadata?.role ?? null);

      // Always register Indie ID when user is logged in (idempotent)
      if (data.session?.user?.id) {
        const granted = await ensureNotificationPermission();
        if (granted) {
          console.log("Registering IndieID for user:", data.session.user.id);
          await registerIndieID(
            data.session.user.id,
            32035,
            "C3YxvEGRY2D8OydDIV4Wvf"
          );
        }
      }

      setIsLoading(false);
    };

    loadSession();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log("Auth state changed:", event, session?.user?.email);
        setSession(session);
        setRole(session?.user?.user_metadata?.role ?? null);

        // Always register Indie ID on sign-in (idempotent)
        if (event === "SIGNED_IN" && session?.user?.id) {
          const granted = await ensureNotificationPermission();
          if (granted) {
            console.log(
              "Registering IndieID for user (SIGNED_IN):",
              session.user.id
            );
            await registerIndieID(
              session.user.id,
              32035,
              "C3YxvEGRY2D8OydDIV4Wvf"
            );
          }
        }
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  const signOut = () => {
    supabase.auth.signOut();
    setSession(null);
    setRole(null);
  };

  // The value now provides the session directly. The user object is inside it.
  return (
    <AuthContext.Provider
      value={{
        session,
        signOut,
        isLoading,
        role,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
