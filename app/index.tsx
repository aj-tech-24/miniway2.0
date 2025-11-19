import { useAuth } from "@/contexts/AuthContext";
import { Redirect } from "expo-router";

export default function Index() {
  const { session, isLoading, role } = useAuth();

  // While auth is loading, render nothing (prevents flashing the login page)
  if (isLoading) return null;

  // Not authenticated -> go to auth flow
  if (!session) return <Redirect href="/(auth)/login" />;

  // Authenticated -> redirect based on role (fallback to commuter)
  const r = role || session?.user?.user_metadata?.role || "commuter";
  if (r === "driver") return <Redirect href="/(driver)" />;
  if (r === "conductor") return <Redirect href="/(conductor)" />;
  return <Redirect href="/(commuter)" />;
}
