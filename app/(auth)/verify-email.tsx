import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import ErrorModal from "../../components/auth/ErrorModal";
import SuccessModal from "../../components/auth/SuccessModal";
import { useThemeColor } from "../../hooks/useThemeColor";

export default function VerifyEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  // Get email from params or use empty string as fallback
  const [email] = useState((params.email as string) || "");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");

  // --- State for user feedback messages ---
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  // --- Animation setup ---
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

  // Handle modal display based on message type
  useEffect(() => {
    if (message) {
      if (message.type === "error") {
        setShowErrorModal(true);
      } else if (message.type === "success") {
        setShowSuccessModal(true);
      }
    }
  }, [message]);
  // --- Verify the OTP ---
  async function handleVerifyOtp() {
    setMessage(null);
    setShowErrorModal(false);
    setShowSuccessModal(false);

    if (!otp.trim()) {
      setMessage({
        type: "error",
        text: "Please enter the confirmation code.",
      });
      return;
    }

    if (otp.length !== 6) {
      setMessage({
        type: "error",
        text: "Please enter a valid 6-digit code.",
      });
      return;
    }

    setIsLoading(true);
    
    try {
      console.log("Attempting to verify OTP:", otp, "for email:", email);
      
      // Try signup verification first
      let { data, error } = await supabase.auth.verifyOtp({
        email: email,
        token: otp,
        type: "signup",
      });

      console.log("Signup verification response:", { data, error });

      // If signup verification fails, try email verification
      if (error) {
        console.log("Signup verification failed, trying email type...");
        const emailResult = await supabase.auth.verifyOtp({
          email: email,
          token: otp,
          type: "email",
        });
        console.log("Email verification response:", emailResult);
        data = emailResult.data;
        error = emailResult.error;
      }

      if (error) {
        console.error("Verification failed:", error);
        throw error;
      }

      console.log("Verification successful, user:", data.user?.email);
      console.log("Email confirmed at:", data.user?.email_confirmed_at);

      setMessage({
        type: "success",
        text: "Verification successful! Redirecting...",
      });

      // Force redirect to commuter screen after successful verification
      setTimeout(() => {
        console.log("Redirecting to commuter screen...");
        router.replace("/(commuter)");
      }, 1000);
    } catch (error) {
      console.error("Verification error:", error);
      if (error instanceof Error) {
        setMessage({ 
          type: "error", 
          text: error.message || "Verification failed. Please try again." 
        });
      } else {
        setMessage({
          type: "error",
          text: "Verification failed. Please try again."
        });
      }
    } finally {
      setIsLoading(false);
    }
  }

  // --- Resend verification email ---
  async function handleResendEmail() {
    setMessage(null);
    setIsResending(true);

    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email,
      });

      if (error) {
        throw error;
      }

      setMessage({
        type: "success",
        text: "A new confirmation code has been sent to your email.",
      });

      // Clear the OTP input when resending
      setOtp("");
    } catch (error) {
      if (error instanceof Error) {
        setMessage({ type: "error", text: error.message });
      }
    } finally {
      setIsResending(false);
    }
  }  // --- Handle OTP input with auto-formatting ---
  const handleOtpChange = (text: string) => {
    // Remove non-numeric characters
    const numericText = text.replace(/[^0-9]/g, "");
    // Limit to 6 digits
    const limitedText = numericText.slice(0, 6);
    setOtp(limitedText);

    // Clear any previous error messages when user starts typing
    if (message?.type === "error") {
      setMessage(null);
    }
  };

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
          <Ionicons
            name="mail-unread-outline"
            size={80}
            color="#007AFF"
            style={{ alignSelf: "center", marginBottom: 20 }}
          />
          <Text style={[styles.title, { color: textColor }]}>
            Verify Your Email
          </Text>
          <Text style={[styles.subtitle, { color: textColor }]}>
            We've sent a 6-digit confirmation code to {email}
          </Text>
          <View style={styles.inputContainer}>
            <Text style={[styles.label, { color: textColor }]}>
              Confirmation Code
            </Text>
            <TextInput
              style={styles.input}
              placeholder="000000"
              placeholderTextColor="#A0A3BD"
              keyboardType="number-pad"
              value={otp}
              onChangeText={handleOtpChange}
              maxLength={6}
              autoFocus
            />
          </View>

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
          <TouchableOpacity
            style={[styles.resendButton, isResending && styles.buttonDisabled]}
            onPress={handleResendEmail}
            disabled={isResending}
          >
            {isResending ? (
              <ActivityIndicator color="#007AFF" />
            ) : (
              <Text style={styles.resendButtonText}>Resend Code</Text>
            )}
          </TouchableOpacity>
          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: textColor }]}>
              Didn&apos;t receive the code? Check your spam folder or
            </Text>
            <TouchableOpacity
              onPress={handleResendEmail}
              disabled={isResending}
            >
              <Text style={styles.link}>resend it</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </ImageBackground>
      {/* Error Modal */}
      <ErrorModal
        visible={showErrorModal}
        title="Verification Error"
        message={message?.text || "An error occurred during verification"}
        onClose={() => setShowErrorModal(false)}
        icon="close-circle"
        iconColor="#FF3B30"
      />
      {/* Success Modal */}
      <SuccessModal
        visible={showSuccessModal}
        title="Verification Successful"
        message={message?.text || "Your email has been verified successfully"}
        onClose={() => setShowSuccessModal(false)}
        icon="checkmark-circle"
        iconColor="#34C759"
      />
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
    marginBottom: 20,
  },
  input: {
    backgroundColor: "#fff",
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderRadius: 12,
    fontSize: 24,
    borderWidth: 2,
    borderColor: "#E1E5E9",
    textAlign: "center",
    letterSpacing: 4,
    fontWeight: "600",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  button: {
    backgroundColor: "#007AFF",
    paddingVertical: 18,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 15,
    height: 58,
    justifyContent: "center",
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 6,
  },
  resendButton: {
    backgroundColor: "transparent",
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#007AFF",
    marginBottom: 20,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  resendButtonText: {
    color: "#007AFF",
    fontSize: 16,
    fontWeight: "bold",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    flexWrap: "wrap",
  },
  footerText: {
    fontSize: 14,
    color: "#666",
  },
  link: {
    fontSize: 14,
    color: "#007AFF",
    fontWeight: "bold",
  },
});
