 import { supabase } from "@/lib/supabase";
import { Session } from "@supabase/supabase-js";
import { registerIndieID } from "native-notify";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";

import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";

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

// Generate a unique session token for this device
function generateSessionToken(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}-${Platform.OS}-${Device.modelName || 'unknown'}`;
}

// The context now provides the session directly.
const AuthContext = createContext<{
  session: Session | null;
  signOut: () => void;
  isLoading: boolean;
  role: string | null;
  sessionKicked: boolean;
  clearSessionKicked: () => void;
}>({
  session: null,
  signOut: () => { },
  isLoading: true,
  role: null,
  sessionKicked: false,
  clearSessionKicked: () => { },
});

export const useAuth = () => {
  return useContext(AuthContext);
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [sessionKicked, setSessionKicked] = useState(false);

  // Use refs to avoid stale closures in intervals and callbacks
  const sessionRef = useRef<Session | null>(null);
  const currentSessionToken = useRef<string | null>(null);
  const isValidating = useRef(false);

  // Keep sessionRef in sync with session state
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Function to register for push notifications
  const registerForPushNotifications = async (userId: string) => {
    try {
      const isHuaweiDevice =
        Device.brand?.toLowerCase().includes("huawei") ||
        Device.manufacturer?.toLowerCase().includes("huawei");

      if (isHuaweiDevice) {
        return false;
      }

      const appId = 32035;
      const appToken = "C3YxvEGRY2D8OydDIV4Wvf";

      if (appId && appToken) {
        await registerIndieID(userId, appId, appToken);
        return true;
      } else {
        return false;
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message?.includes("MISSING_INSTANCEID_SERVICE")
      ) {
        return false;
      }
      return false;
    }
  };

  // Update session token in the database
  const updateSessionToken = async (userId: string, token: string): Promise<boolean> => {
    try {

      const { error } = await supabase
        .from("users")
        .update({
          active_session_token: token,
          last_login_at: new Date().toISOString(),
          last_login_device: `${Device.brand || 'Unknown'} ${Device.modelName || ''} (${Platform.OS})`.trim()
        })
        .eq("id", userId);

      if (error) {
        return false;
      }

      currentSessionToken.current = token;
      return true;
    } catch (error) {
      return false;
    }
  };

  // Validate that the current session token matches the one in the database
  const validateSessionToken = async (userId: string): Promise<boolean> => {
    if (isValidating.current) {
      return true;
    }

    if (!currentSessionToken.current) {
      return true;
    }

    isValidating.current = true;

    try {

      const { data, error } = await supabase
        .from("users")
        .select("active_session_token")
        .eq("id", userId)
        .single();

      if (error) {
        isValidating.current = false;
        return true; // Allow on error to prevent lockout
      }

      const dbToken = data?.active_session_token;
      const localToken = currentSessionToken.current;



      // If we have a local token and DB has a different token, session was kicked
      if (localToken && dbToken && localToken !== dbToken) {
        isValidating.current = false;
        return false;
      }

      isValidating.current = false;
      return true;
    } catch (error) {
      isValidating.current = false;
      return true;
    }
  };

  // Handle kicking out the user
  const handleSessionKicked = async () => {
    setSessionKicked(true);
    currentSessionToken.current = null;
    await supabase.auth.signOut();
    setSession(null);
    setRole(null);
  };

  // Clear session token on sign out
  const clearSessionToken = async (userId: string) => {
    try {
      await supabase
        .from("users")
        .update({ active_session_token: null })
        .eq("id", userId);

      currentSessionToken.current = null;
    } catch (error) {
    }
  };

  // Initial session load and auth state listener
  useEffect(() => {
    const loadSession = async () => {
      setIsLoading(true);

      const { data } = await supabase.auth.getSession();
      const currentSession = data.session;

      setSession(currentSession ?? null);
      sessionRef.current = currentSession ?? null;
      setRole(currentSession?.user?.user_metadata?.role ?? null);

      // If user has a session, generate and update token
      if (currentSession?.user?.id) {
        const newToken = generateSessionToken();
        await updateSessionToken(currentSession.user.id, newToken);

        const granted = await ensureNotificationPermission();
        if (granted) {
          await registerIndieID(
            currentSession.user.id,
            32035,
            "C3YxvEGRY2D8OydDIV4Wvf"
          );
        }
      }

      setIsLoading(false);
    };

    loadSession();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {

        setSession(newSession);
        sessionRef.current = newSession;
        setRole(newSession?.user?.user_metadata?.role ?? null);

        // Handle sign-in event - generate new token
        if (event === "SIGNED_IN" && newSession?.user?.id) {
          const newToken = generateSessionToken();
          await updateSessionToken(newSession.user.id, newToken);

          const granted = await ensureNotificationPermission();
          if (granted) {
            await registerIndieID(
              newSession.user.id,
              32035,
              "C3YxvEGRY2D8OydDIV4Wvf"
            );
          }
        }

        // Handle sign-out event
        if (event === "SIGNED_OUT") {
          currentSessionToken.current = null;
        }
      }
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  // Periodic validation using refs to avoid stale closures
  useEffect(() => {
    const validationInterval = setInterval(async () => {
      const currentSession = sessionRef.current;
      const token = currentSessionToken.current;

      if (currentSession?.user?.id && token) {
        const isValid = await validateSessionToken(currentSession.user.id);
        if (!isValid) {
          await handleSessionKicked();
        }
      }
    }, 15000); // Check every 15 seconds

    return () => {
      clearInterval(validationInterval);
    };
  }, []);

  // Validate on app state change (when app comes to foreground)
  useEffect(() => {
    const subscription = AppState.addEventListener("change", async (nextAppState) => {
      if (nextAppState === "active") {
        const currentSession = sessionRef.current;
        const token = currentSessionToken.current;

        if (currentSession?.user?.id && token) {
          const isValid = await validateSessionToken(currentSession.user.id);
          if (!isValid) {
            await handleSessionKicked();
          }
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const signOut = async () => {
    const currentSession = sessionRef.current;
    if (currentSession?.user?.id) {
      await clearSessionToken(currentSession.user.id);
    }
    await supabase.auth.signOut();
    setSession(null);
    setRole(null);
  };

  const clearSessionKicked = () => {
    setSessionKicked(false);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        signOut,
        isLoading,
        role,
        sessionKicked,
        clearSessionKicked,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
