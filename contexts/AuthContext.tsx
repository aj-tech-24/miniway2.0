import { supabase } from "@/lib/supabase";
import { Session } from "@supabase/supabase-js";
import React, { createContext, useContext, useEffect, useState } from "react";

// The context now provides the session directly.
const AuthContext = createContext<{
  session: Session | null;
  signOut: () => void;
  isLoading: boolean;
}>({
  session: null,
  signOut: () => {},
  isLoading: true,
});

export const useAuth = () => {
  return useContext(AuthContext);
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadSession = async () => {
      setIsLoading(true);

      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);

      setIsLoading(false);
    };

    loadSession();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  const signOut = () => {
    supabase.auth.signOut();
    setSession(null);
  };

  // The value now provides the session directly. The user object is inside it.
  return (
    <AuthContext.Provider value={{ session, signOut, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}
