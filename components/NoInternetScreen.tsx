import { useAppTheme } from "@/contexts/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import { useNetInfo } from "@react-native-community/netinfo";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef } from "react";
import {
    Animated,
    Dimensions,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

const { width } = Dimensions.get("window");

const NoInternetScreen = () => {
    const netInfo = useNetInfo();
    const { theme } = useAppTheme();
    const isDark = theme === "dark";

    // Animations
    const pulseAnim = useRef(new Animated.Value(1)).current;
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(50)).current;
    const waveAnim1 = useRef(new Animated.Value(0)).current;
    const waveAnim2 = useRef(new Animated.Value(0)).current;
    const waveAnim3 = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (netInfo.isConnected === false) {
            // Fade and slide in
            Animated.parallel([
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 500,
                    useNativeDriver: true,
                }),
                Animated.spring(slideAnim, {
                    toValue: 0,
                    friction: 8,
                    tension: 40,
                    useNativeDriver: true,
                }),
            ]).start();

            // Pulse animation for icon
            Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, {
                        toValue: 1.1,
                        duration: 1000,
                        useNativeDriver: true,
                    }),
                    Animated.timing(pulseAnim, {
                        toValue: 1,
                        duration: 1000,
                        useNativeDriver: true,
                    }),
                ])
            ).start();

            // Wave animations
            const createWaveAnimation = (anim: Animated.Value, delay: number) => {
                return Animated.loop(
                    Animated.sequence([
                        Animated.delay(delay),
                        Animated.timing(anim, {
                            toValue: 1,
                            duration: 2000,
                            useNativeDriver: true,
                        }),
                        Animated.timing(anim, {
                            toValue: 0,
                            duration: 0,
                            useNativeDriver: true,
                        }),
                    ])
                );
            };

            createWaveAnimation(waveAnim1, 0).start();
            createWaveAnimation(waveAnim2, 400).start();
            createWaveAnimation(waveAnim3, 800).start();
        }
    }, [netInfo.isConnected]);

    if (netInfo.isConnected === false) {
        return (
            <View style={[styles.container, isDark && styles.containerDark]}>
                {/* Background Gradient */}
                <LinearGradient
                    colors={isDark
                        ? ["#0F172A", "#1E293B", "#0F172A"]
                        : ["#FEF2F2", "#FFF7ED", "#FFFFFF"]}
                    style={styles.gradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                />

                {/* Decorative Elements */}
                <View style={[styles.decorCircle1, isDark && styles.decorCircleDark]} />
                <View style={[styles.decorCircle2, isDark && styles.decorCircleDark]} />

                <Animated.View
                    style={[
                        styles.content,
                        {
                            opacity: fadeAnim,
                            transform: [{ translateY: slideAnim }],
                        },
                    ]}
                >
                    {/* Animated Icon Container */}
                    <Animated.View
                        style={[
                            styles.iconWrapper,
                            { transform: [{ scale: pulseAnim }] },
                        ]}
                    >
                        {/* Wave Rings */}
                        <Animated.View
                            style={[
                                styles.waveRing,
                                styles.waveRing1,
                                {
                                    opacity: waveAnim1.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [0.6, 0],
                                    }),
                                    transform: [
                                        {
                                            scale: waveAnim1.interpolate({
                                                inputRange: [0, 1],
                                                outputRange: [1, 2],
                                            }),
                                        },
                                    ],
                                },
                            ]}
                        />
                        <Animated.View
                            style={[
                                styles.waveRing,
                                styles.waveRing2,
                                {
                                    opacity: waveAnim2.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [0.5, 0],
                                    }),
                                    transform: [
                                        {
                                            scale: waveAnim2.interpolate({
                                                inputRange: [0, 1],
                                                outputRange: [1, 1.8],
                                            }),
                                        },
                                    ],
                                },
                            ]}
                        />
                        <Animated.View
                            style={[
                                styles.waveRing,
                                styles.waveRing3,
                                {
                                    opacity: waveAnim3.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [0.4, 0],
                                    }),
                                    transform: [
                                        {
                                            scale: waveAnim3.interpolate({
                                                inputRange: [0, 1],
                                                outputRange: [1, 1.6],
                                            }),
                                        },
                                    ],
                                },
                            ]}
                        />

                        <LinearGradient
                            colors={["#EF4444", "#DC2626", "#B91C1C"]}
                            style={styles.iconContainer}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                        >
                            <Ionicons name="cloud-offline" size={48} color="#fff" />
                        </LinearGradient>
                    </Animated.View>

                    {/* Text Content */}
                    <Text style={[styles.title, isDark && styles.titleDark]}>
                        No Internet Connection
                    </Text>
                    <Text style={[styles.subtitle, isDark && styles.subtitleDark]}>
                        You're currently offline
                    </Text>
                    <Text style={[styles.message, isDark && styles.messageDark]}>
                        Please check your WiFi or mobile data connection and try again.
                    </Text>

                    {/* Connection Status Card */}
                    <View style={[styles.statusCard, isDark && styles.statusCardDark]}>
                        <View style={styles.statusRow}>
                            <View style={styles.statusItem}>
                                <View style={[styles.statusDot, styles.statusDotOffline]} />
                                <Text style={[styles.statusLabel, isDark && styles.statusLabelDark]}>
                                    WiFi
                                </Text>
                            </View>
                            <View style={styles.statusItem}>
                                <View style={[styles.statusDot, styles.statusDotOffline]} />
                                <Text style={[styles.statusLabel, isDark && styles.statusLabelDark]}>
                                    Mobile Data
                                </Text>
                            </View>
                        </View>
                    </View>

                    {/* Tips */}
                    <View style={styles.tipsContainer}>
                        <Text style={[styles.tipsTitle, isDark && styles.tipsTitleDark]}>
                            Quick Tips
                        </Text>
                        <View style={styles.tipItem}>
                            <Ionicons name="wifi" size={16} color={isDark ? "#60A5FA" : "#3B82F6"} />
                            <Text style={[styles.tipText, isDark && styles.tipTextDark]}>
                                Toggle WiFi off and on
                            </Text>
                        </View>
                        <View style={styles.tipItem}>
                            <Ionicons name="airplane" size={16} color={isDark ? "#60A5FA" : "#3B82F6"} />
                            <Text style={[styles.tipText, isDark && styles.tipTextDark]}>
                                Disable Airplane Mode
                            </Text>
                        </View>
                        <View style={styles.tipItem}>
                            <Ionicons name="refresh" size={16} color={isDark ? "#60A5FA" : "#3B82F6"} />
                            <Text style={[styles.tipText, isDark && styles.tipTextDark]}>
                                Restart your device
                            </Text>
                        </View>
                    </View>

                    {/* Retry Button */}
                    <TouchableOpacity style={styles.buttonWrapper} activeOpacity={0.8}>
                        <LinearGradient
                            colors={["#0891B2", "#06B6D4", "#22D3EE"]}
                            style={styles.button}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                        >
                            <Ionicons name="refresh" size={20} color="#fff" />
                            <Text style={styles.buttonText}>Try Again</Text>
                        </LinearGradient>
                    </TouchableOpacity>
                </Animated.View>
            </View>
        );
    }

    return null;
};

const styles = StyleSheet.create({
    container: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "#FFFFFF",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 99999,
    },
    containerDark: {
        backgroundColor: "#0F172A",
    },
    gradient: {
        ...StyleSheet.absoluteFillObject,
    },
    decorCircle1: {
        position: "absolute",
        top: -width * 0.3,
        right: -width * 0.3,
        width: width * 0.8,
        height: width * 0.8,
        borderRadius: width * 0.4,
        backgroundColor: "rgba(239, 68, 68, 0.05)",
    },
    decorCircle2: {
        position: "absolute",
        bottom: -width * 0.2,
        left: -width * 0.2,
        width: width * 0.6,
        height: width * 0.6,
        borderRadius: width * 0.3,
        backgroundColor: "rgba(59, 130, 246, 0.05)",
    },
    decorCircleDark: {
        backgroundColor: "rgba(255, 255, 255, 0.03)",
    },
    content: {
        alignItems: "center",
        paddingHorizontal: 32,
        maxWidth: 400,
    },
    iconWrapper: {
        marginBottom: 32,
        alignItems: "center",
        justifyContent: "center",
    },
    waveRing: {
        position: "absolute",
        width: 100,
        height: 100,
        borderRadius: 50,
        borderWidth: 2,
        borderColor: "#EF4444",
    },
    waveRing1: {
        borderColor: "#EF4444",
    },
    waveRing2: {
        borderColor: "#F87171",
    },
    waveRing3: {
        borderColor: "#FCA5A5",
    },
    iconContainer: {
        width: 100,
        height: 100,
        borderRadius: 30,
        justifyContent: "center",
        alignItems: "center",
        shadowColor: "#EF4444",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.4,
        shadowRadius: 16,
        elevation: 12,
    },
    title: {
        fontSize: 26,
        fontWeight: "800",
        color: "#1F2937",
        marginBottom: 8,
        textAlign: "center",
        letterSpacing: -0.5,
    },
    titleDark: {
        color: "#F9FAFB",
    },
    subtitle: {
        fontSize: 16,
        color: "#EF4444",
        fontWeight: "600",
        marginBottom: 12,
    },
    subtitleDark: {
        color: "#F87171",
    },
    message: {
        fontSize: 15,
        color: "#6B7280",
        textAlign: "center",
        marginBottom: 24,
        lineHeight: 22,
    },
    messageDark: {
        color: "#9CA3AF",
    },
    statusCard: {
        backgroundColor: "#F9FAFB",
        borderRadius: 16,
        padding: 16,
        width: "100%",
        marginBottom: 24,
        borderWidth: 1,
        borderColor: "#E5E7EB",
    },
    statusCardDark: {
        backgroundColor: "#1E293B",
        borderColor: "#334155",
    },
    statusRow: {
        flexDirection: "row",
        justifyContent: "space-around",
    },
    statusItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    statusDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
    },
    statusDotOffline: {
        backgroundColor: "#EF4444",
    },
    statusLabel: {
        fontSize: 14,
        color: "#374151",
        fontWeight: "500",
    },
    statusLabelDark: {
        color: "#D1D5DB",
    },
    tipsContainer: {
        width: "100%",
        marginBottom: 28,
    },
    tipsTitle: {
        fontSize: 14,
        fontWeight: "600",
        color: "#374151",
        marginBottom: 12,
        textAlign: "center",
    },
    tipsTitleDark: {
        color: "#D1D5DB",
    },
    tipItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 8,
        paddingHorizontal: 16,
        backgroundColor: "rgba(59, 130, 246, 0.05)",
        borderRadius: 10,
        marginBottom: 8,
    },
    tipText: {
        fontSize: 14,
        color: "#4B5563",
    },
    tipTextDark: {
        color: "#9CA3AF",
    },
    buttonWrapper: {
        borderRadius: 16,
        overflow: "hidden",
        shadowColor: "#06B6D4",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 8,
    },
    button: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 16,
        paddingHorizontal: 40,
        gap: 10,
    },
    buttonText: {
        color: "#fff",
        fontSize: 16,
        fontWeight: "700",
        letterSpacing: 0.3,
    },
});

export default NoInternetScreen;
