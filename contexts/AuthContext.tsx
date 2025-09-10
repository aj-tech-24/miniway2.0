import { supabase } from "@/lib/supabase";
import { Session } from "@supabase/supabase-js";
import React, { createContext, useContext, useEffect, useState } from "react";

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

  useEffect(() => {
    const loadSession = async () => {
      setIsLoading(true);

      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
      setRole(data.session?.user?.user_metadata?.role ?? null);

      setIsLoading(false);
    };

    loadSession();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log("Auth state changed:", event, session?.user?.email);
        setSession(session);
        setRole(session?.user?.user_metadata?.role ?? null);
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
