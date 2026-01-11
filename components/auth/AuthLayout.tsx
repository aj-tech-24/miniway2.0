import { useAppTheme } from "@/contexts/ThemeContext";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useThemeColor } from "../../hooks/useThemeColor";

interface AuthLayoutProps {
  children: React.ReactNode;
}

const { width, height } = Dimensions.get("window");

export default function AuthLayout({ children }: AuthLayoutProps) {
  const { theme } = useAppTheme();
  const isDark = theme === "dark";
  const backgroundColor = useThemeColor({}, "background");

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const logoScale = useRef(new Animated.Value(0.8)).current;
  const logoRotate = useRef(new Animated.Value(0)).current;
  const floatingAnim1 = useRef(new Animated.Value(0)).current;
  const floatingAnim2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Main content animation
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 6,
        tension: 80,
        useNativeDriver: true,
      }),
    ]).start();

    // Logo entrance animation
    Animated.sequence([
      Animated.delay(200),
      Animated.parallel([
        Animated.spring(logoScale, {
          toValue: 1,
          friction: 4,
          tension: 100,
          useNativeDriver: true,
        }),
        Animated.timing(logoRotate, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    // Floating decorative elements
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatingAnim1, {
          toValue: 1,
          duration: 3000,
          useNativeDriver: true,
        }),
        Animated.timing(floatingAnim1, {
          toValue: 0,
          duration: 3000,
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(floatingAnim2, {
          toValue: 1,
          duration: 4000,
          useNativeDriver: true,
        }),
        Animated.timing(floatingAnim2, {
          toValue: 0,
          duration: 4000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [fadeAnim, scaleAnim, logoScale, logoRotate, floatingAnim1, floatingAnim2]);

  const logoRotation = logoRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ["-10deg", "0deg"],
  });

  const floating1Y = floatingAnim1.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -20],
  });

  const floating2Y = floatingAnim2.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 15],
  });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? "#0F172A" : "#F0FDFA" }]}>
      <StatusBar style={isDark ? "light" : "dark"} />

      {/* Gradient Background - Cyan/Teal Theme */}
      <LinearGradient
        colors={isDark
          ? ["#0F172A", "#164E63", "#0F172A"]
          : ["#ECFEFF", "#CFFAFE", "#A5F3FC"]}
        style={styles.gradientBackground}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />

      {/* Decorative Floating Elements - Cyan Theme */}
      <Animated.View
        style={[
          styles.floatingCircle1,
          {
            transform: [{ translateY: floating1Y }],
            backgroundColor: isDark ? "rgba(6, 182, 212, 0.15)" : "rgba(6, 182, 212, 0.12)",
          },
        ]}
      />
      <Animated.View
        style={[
          styles.floatingCircle2,
          {
            transform: [{ translateY: floating2Y }],
            backgroundColor: isDark ? "rgba(8, 145, 178, 0.12)" : "rgba(8, 145, 178, 0.1)",
          },
        ]}
      />
      <Animated.View
        style={[
          styles.floatingCircle3,
          {
            transform: [{ translateY: floating1Y }],
            backgroundColor: isDark ? "rgba(34, 211, 238, 0.1)" : "rgba(34, 211, 238, 0.08)",
          },
        ]}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <Animated.View
          style={[
            styles.content,
            { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
          ]}
        >
          {/* Premium Logo Container - Cyan Theme */}
          <Animated.View
            style={[
              styles.logoContainer,
              {
                transform: [
                  { scale: logoScale },
                  { rotate: logoRotation },
                ],
              },
            ]}
          >
            <LinearGradient
              colors={["#06B6D4", "#0891B2", "#0E7490"]}
              style={styles.logoGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <View style={styles.logoInner}>
                <Image
                  source={require("../../assets/images/logo.png")}
                  style={styles.logo}
                  resizeMode="contain"
                />
              </View>
            </LinearGradient>

            {/* Logo Glow Effect - Cyan */}
            <View style={styles.logoGlow} />
          </Animated.View>

          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradientBackground: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: "center",
  },
  floatingCircle1: {
    position: "absolute",
    top: height * 0.08,
    right: -width * 0.2,
    width: width * 0.6,
    height: width * 0.6,
    borderRadius: width * 0.3,
  },
  floatingCircle2: {
    position: "absolute",
    bottom: height * 0.15,
    left: -width * 0.3,
    width: width * 0.7,
    height: width * 0.7,
    borderRadius: width * 0.35,
  },
  floatingCircle3: {
    position: "absolute",
    top: height * 0.4,
    right: width * 0.1,
    width: width * 0.25,
    height: width * 0.25,
    borderRadius: width * 0.125,
  },
  logoContainer: {
    alignSelf: "center",
    marginBottom: 32,
    marginTop: 20,
  },
  logoGradient: {
    width: 100,
    height: 100,
    borderRadius: 28,
    padding: 3,
    shadowColor: "#06B6D4",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
  },
  logoInner: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 25,
    justifyContent: "center",
    alignItems: "center",
  },
  logo: {
    width: 60,
    height: 60,
  },
  logoGlow: {
    position: "absolute",
    top: -10,
    left: -10,
    right: -10,
    bottom: -10,
    borderRadius: 38,
    backgroundColor: "rgba(6, 182, 212, 0.15)",
    zIndex: -1,
  },
});
