import { supabase } from "@/lib/supabase";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import AuthForm from "../../components/auth/AuthForm";
import AuthLayout from "../../components/auth/AuthLayout";
import { useThemeColor } from "../../hooks/useThemeColor";
import { validateSignupForm } from "../../utils/authValidation";

export default function SignupScreen() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const textColor = useThemeColor({}, "text");

  async function handleSignup() {
    setMessage(null);
    setErrors({});

    // Validate form with email duplicate check
    const validation = await validateSignupForm(
      fullName,
      email,
      password,
      confirmPassword
    );
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    setIsLoading(true);

    try {
      // Clean the email input
      const cleanEmail = email.trim().toLowerCase();

      console.log("Attempting signup with email:", cleanEmail);

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: password,
        options: {
          data: {
            full_name: fullName,
            role: "commuter",
          },
        },
      });

      console.log("SIGNUP RESPONSE:", { data, error });
      console.log(
        "Error details:",
        error
          ? {
              message: error.message,
              status: error.status,
              name: error.name,
            }
          : "No error"
      );

      if (error) {
        // Handle specific error types
        if (
          error.message.includes("Email address") &&
          error.message.includes("invalid")
        ) {
          // Check if it's a Gmail address
          if (cleanEmail.includes("@gmail.com")) {
            setMessage({
              type: "error",
              text: "Gmail addresses are currently not supported. Please use Outlook, Yahoo, or another email provider.",
            });
          } else {
            setMessage({
              type: "error",
              text: "The email address format is not accepted. Please try a different email address.",
            });
          }
        } else if (error.message.includes("already registered")) {
          setMessage({
            type: "error",
            text: "An account with this email already exists. Please try logging in instead.",
          });
        } else if (error.message.includes("rate limit")) {
          setMessage({
            type: "error",
            text: "Too many signup attempts. Please wait a moment and try again.",
          });
        } else {
          setMessage({ type: "error", text: error.message });
        }
        return;
      }

      // If there's no error, redirect to verification page
      router.push({
        pathname: "/verify-email",
        params: { email: cleanEmail },
      });
    } catch (error) {
      console.error("Signup error:", error);
      if (error instanceof Error) {
        setMessage({ type: "error", text: error.message });
      } else {
        setMessage({
          type: "error",
          text: "An unexpected error occurred. Please try again.",
        });
      }
    } finally {
      // This block will run no matter what, ensuring the loading spinner is always turned off.
      setIsLoading(false);
    }
  }

  const fields = [
    {
      name: "fullName",
      label: "Full Name",
      placeholder: "Enter your full name",
      value: fullName,
      onChangeText: setFullName,
      autoCapitalize: "words" as const,
      error: errors.fullName,
    },
    {
      name: "email",
      label: "Email Address",
      placeholder: "you@outlook.com",
      value: email,
      onChangeText: setEmail,
      keyboardType: "email-address" as const,
      autoCapitalize: "none" as const,
      error: errors.email,
      note: "Note: Use a valid email address",
    },
    {
      name: "password",
      label: "Password",
      placeholder: "Create a password",
      value: password,
      onChangeText: setPassword,
      secureTextEntry: true,
      isPasswordField: true,
      error: errors.password,
    },
    {
      name: "confirmPassword",
      label: "Confirm Password",
      placeholder: "Confirm your password",
      value: confirmPassword,
      onChangeText: setConfirmPassword,
      secureTextEntry: true,
      isPasswordField: true,
      error: errors.confirmPassword,
    },
  ];

  return (
    <AuthLayout>
      <AuthForm
        title="Create Account"
        subtitle="Join the Miniway community"
        fields={fields}
        buttonText="Sign Up"
        onButtonPress={handleSignup}
        isLoading={isLoading}
        message={message}
        footerText="Already have an account?"
        footerLinkText="Log In"
        onFooterLinkPress={() => router.push("/login")}
        textColor={textColor}
      />
    </AuthLayout>
  );
}
