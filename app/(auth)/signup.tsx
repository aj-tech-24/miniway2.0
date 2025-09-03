import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { Link, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  ImageBackground,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useThemeColor } from "../../hooks/useThemeColor";

export default function SignupScreen() {
  const router = useRouter();
  // --- State for all input fields ---
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState(""); // New state for confirm password
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");

  // --- State for user feedback messages ---
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  // --- This state now stores specific error messages for each field ---
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  // --- This state now controls showing the OTP input view ---
  const [showOtpInput, setShowOtpInput] = useState(false);

  // --- Animation setup (unchanged) ---
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 5,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, scaleAnim]);

  // --- Step 1: Sign up to receive the OTP ---
  async function handleSignup() {
    setMessage(null);
    setErrors({});

    // --- Validation Logic ---
    let validationErrors: { [key: string]: string } = {};
    if (!fullName.trim()) validationErrors.fullName = "Full name is required.";
    if (!email.trim()) validationErrors.email = "Email is required.";
    if (!password.trim()) validationErrors.password = "Password is required.";
    if (!confirmPassword.trim())
      validationErrors.confirmPassword = "Please confirm your password.";

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    if (password.length < 6) {
      validationErrors.password = "Password must be at least 6 characters.";
      setErrors(validationErrors);
      return;
    }
    if (password !== confirmPassword) {
      validationErrors.confirmPassword = "Passwords do not match.";
      setErrors(validationErrors);
      return;
    }

    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email: email,
        password: password,
        options: {
          data: {
            full_name: fullName,
            role: "commuter",
          },
        },
      });

      console.log("SIGNUP RESPONSE:", { data, error }); // <-- Add this

      if (error) {
        // Throw the error to be caught by the catch block
        throw error;
      }

      // If there's no error, we assume the email was sent successfully.
      setShowOtpInput(true);
      setMessage({
        type: "success",
        text: "A confirmation code has been sent to your email.",
      });
    } catch (error) {
      if (error instanceof Error) {
        setMessage({ type: "error", text: error.message });
      }
    } finally {
      // This block will run no matter what, ensuring the loading spinner is always turned off.
      setIsLoading(false);
    }
  }

  // --- Step 2: Verify the OTP ---
  async function handleVerifyOtp() {
    setMessage(null);
    if (!otp.trim()) {
      setMessage({
        type: "error",
        text: "Please enter the confirmation code.",
      });
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email,
        token: otp,
        type: "signup",
      });

      if (error) {
        throw error;
      }

      setMessage({
        type: "success",
        text: "Verification successful! Redirecting...",
      });
      // The onAuthStateChange listener will handle the redirect automatically
    } catch (error) {
      if (error instanceof Error) {
        setMessage({ type: "error", text: error.message });
      }
    } finally {
      setIsLoading(false);
    }
  }

  // --- New OTP Verification View ---
  if (showOtpInput) {
    return (
      <SafeAreaView style={styles.container}>
        <ImageBackground
          source={require("../../assets/images/morningBg.png")}
          style={styles.background}
          resizeMode="cover"
        >
          <View style={styles.content}>
            <Ionicons
              name="mail-unread-outline"
              size={80}
              color="#007AFF"
              style={{ alignSelf: "center", marginBottom: 20 }}
            />
            <Text style={styles.title}>Check Your Email</Text>
            <Text style={styles.successSubtitle}>
              We've sent a 6-digit confirmation code to {email}.
            </Text>

            <Text style={styles.label}>Confirmation Code</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter the code"
              keyboardType="number-pad"
              value={otp}
              onChangeText={setOtp}
            />

            {message && (
              <Text
                style={[
                  styles.message,
                  message.type === "error"
                    ? styles.errorText
                    : styles.successText,
                ]}
              >
                {message.text}
              </Text>
            )}

            <TouchableOpacity
              style={[styles.button, isLoading && styles.buttonDisabled]}
              onPress={handleVerifyOtp}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Verify Account</Text>
              )}
            </TouchableOpacity>
          </View>
        </ImageBackground>
      </SafeAreaView>
    );
  }

  // --- Original Signup Form View ---
  return (
    <SafeAreaView style={[styles.container, { backgroundColor }]}>
      <ImageBackground
        source={require("../../assets/images/morningBg.png")}
        style={styles.background}
        resizeMode="cover"
      >
        <Animated.View
          style={[
            styles.content,
            { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
          ]}
        >
          <Image
            source={require("../../assets/images/logo.png")}
            alt="Miniway Logo"
            style={{
              width: 100,
              height: 100,
              alignSelf: "center",
              marginBottom: 10,
              marginTop: -20,
            }}
          />
          <Text style={[styles.title, { color: textColor }]}>
            Create Account
          </Text>
          <Text style={[styles.subtitle, { color: textColor }]}>
            Join the Miniway community
          </Text>

          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: textColor }]}>Full Name</Text>
            <TextInput
              style={[styles.input, errors.fullName && styles.inputError]}
              placeholder="Enter your full name"
              placeholderTextColor="#A0A3BD"
              autoCapitalize="words"
              value={fullName}
              onChangeText={setFullName}
            />
            {errors.fullName && (
              <Text style={styles.errorText}>{errors.fullName}</Text>
            )}
          </View>

          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: textColor }]}>
              Email Address
            </Text>
            <TextInput
              style={[styles.input, errors.email && styles.inputError]}
              placeholder="you@example.com"
              placeholderTextColor="#A0A3BD"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
            {errors.email && (
              <Text style={styles.errorText}>{errors.email}</Text>
            )}
          </View>

          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: textColor }]}>Password</Text>
            <TextInput
              style={[styles.input, errors.password && styles.inputError]}
              placeholder="Create a password"
              placeholderTextColor="#A0A3BD"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            {errors.password && (
              <Text style={styles.errorText}>{errors.password}</Text>
            )}
          </View>

          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: textColor }]}>
              Confirm Password
            </Text>
            <TextInput
              style={[
                styles.input,
                errors.confirmPassword && styles.inputError,
              ]}
              placeholder="Confirm your password"
              placeholderTextColor="#A0A3BD"
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />
            {errors.confirmPassword && (
              <Text style={styles.errorText}>{errors.confirmPassword}</Text>
            )}
          </View>

          {message && message.type === "error" && (
            <Text style={styles.message}>{message.text}</Text>
          )}

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleSignup}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign Up</Text>
            )}
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <Link href="/login" asChild>
              <TouchableOpacity disabled={isLoading}>
                <Text style={styles.link}>Log In</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </Animated.View>
      </ImageBackground>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    justifyContent: "center",
  },
  content: {
    paddingHorizontal: 30,
  },
  background: {
    flex: 1,
    justifyContent: "center",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 10,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 20,
    textAlign: "center",
  },
  successSubtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 40,
    textAlign: "center",
    lineHeight: 24,
  },
  label: {
    fontSize: 16,
    color: "#333",
    marginBottom: 8,
    fontWeight: "500",
  },
  inputContainer: {
    marginBottom: 15,
  },
  input: {
    backgroundColor: "#fff",
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderRadius: 10,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  inputError: {
    borderColor: "red",
  },
  message: {
    textAlign: "center",
    marginBottom: 10,
    fontSize: 14,
    color: "red",
  },
  successText: {
    color: "green",
  },
  errorText: {
    color: "red",
    marginTop: 5,
    fontSize: 12,
  },
  button: {
    backgroundColor: "#007AFF",
    paddingVertical: 18,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 10,
    height: 58,
    justifyContent: "center",
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 6,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  footer: {
    marginTop: 30,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  footerText: {
    fontSize: 16,
    color: "#666",
  },
  link: {
    fontSize: 16,
    color: "#007AFF",
    fontWeight: "bold",
  },
});
