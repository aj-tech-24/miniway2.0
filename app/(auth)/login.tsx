import { supabase } from "@/lib/supabase";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import AuthForm from "../../components/auth/AuthForm";
import AuthLayout from "../../components/auth/AuthLayout";
import { useThemeColor } from "../../hooks/useThemeColor";
import { validateLoginForm } from "../../utils/authValidation";

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "error";
    text: string;
  } | null>(null);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const textColor = useThemeColor({}, "text");

  async function handleLogin() {
    setMessage(null);
    setErrors({});

    // Validate form
    const validation = validateLoginForm(email, password);
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: password,
      });

      if (error) {
        // Check if the error is related to email not being confirmed
        if (
          error.message.includes("Email not confirmed") ||
          error.message.includes("email_not_confirmed") ||
          error.message.includes("confirmation")
        ) {
          // Redirect to verification page with email parameter
          router.push({
            pathname: "/verify-email",
            params: { email: email.trim().toLowerCase() },
          });
          setIsLoading(false);
          return;
        }

        // Handle other login errors
        setMessage({ type: "error", text: error.message });
        setIsLoading(false);
        return;
      }

      // Check if user email is confirmed
      if (data.user && !data.user.email_confirmed_at) {
        // User exists but email is not confirmed, redirect to verification
        router.push({
          pathname: "/verify-email",
          params: { email: email.trim().toLowerCase() },
        });
        setIsLoading(false);
        return;
      }

      // On success, the onAuthStateChange listener will handle the redirect
      // We don't set isLoading to false here, so the spinner keeps showing until redirect.
    } catch (error) {
      console.error("Login error:", error);
      setMessage({
        type: "error",
        text: "An unexpected error occurred. Please try again.",
      });
      setIsLoading(false);
    }
  }

  const fields = [
    {
      name: "email",
      label: "Email Address",
      placeholder: "you@example.com",
      value: email,
      onChangeText: setEmail,
      keyboardType: "email-address" as const,
      autoCapitalize: "none" as const,
      error: errors.email,
    },
    {
      name: "password",
      label: "Password",
      placeholder: "Enter your password",
      value: password,
      onChangeText: setPassword,
      secureTextEntry: true,
      isPasswordField: true, // Add this line
      error: errors.password,
    },
  ];

  return (
    <AuthLayout>
      <AuthForm
        title="Welcome Back!"
        subtitle="Log in to your Miniway account"
        fields={fields}
        buttonText="Log In"
        onButtonPress={handleLogin}
        isLoading={isLoading}
        message={message}
        footerText="Don't have an account?"
        footerLinkText="Sign Up"
        onFooterLinkPress={() => router.push("/signup")}
        textColor={textColor}
      />
    </AuthLayout>
  );
}
