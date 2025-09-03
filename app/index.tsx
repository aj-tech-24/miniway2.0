import { Redirect } from "expo-router";

export default function Index() {
  // Always redirect to auth handling in _layout
  return <Redirect href="/(auth)/login" />;
}
