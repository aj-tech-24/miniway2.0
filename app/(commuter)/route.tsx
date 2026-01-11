import { useAppTheme } from "@/contexts/ThemeContext";
import { useThemeColor } from "@/hooks/useThemeColor";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// UPDATED: Route type now includes start and end addresses
type Route = {
  id: string;
  name: string;
  start_address: string | null;
  end_address: string | null;
};

export function RouteScreen() {
  const [allRoutes, setAllRoutes] = useState<Route[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { theme } = useAppTheme();
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const primaryColor = useThemeColor({}, "tint");
  const placeholderTextColor = useThemeColor({}, "placeholderTextColor");
  const separatorColor = useThemeColor({}, "separatorColor");

  const isDark = theme === "dark";

  const fetchRoutes = useCallback(async () => {
    try {
      setError(null);
      const { data, error } = await supabase
        .from("routes")
        .select("id, name, start_address, end_address")
        .order("name", { ascending: true });

      if (error) throw error;
      setAllRoutes(data || []);
    } catch (error) {
      console.error("Error fetching routes:", error);
      setError("Failed to load routes. Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRoutes();
  }, [fetchRoutes]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchRoutes();
  }, [fetchRoutes]);

  // Filter routes based on the search query
  const filteredRoutes = useMemo(() => {
    if (!searchQuery) return allRoutes;
    return allRoutes.filter((route) =>
      route.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [allRoutes, searchQuery]);
  const renderRouteCard = ({ item, index }: { item: Route; index: number }) => (
    <TouchableOpacity
      style={[styles.routeCard, isDark && styles.routeCardDark]}
      onPress={() =>
        router.push({
          pathname: "/select-destination",
          params: {
            selectedRouteId: item.id,
            selectedRouteName: item.name,
          },
        })
      }
      activeOpacity={0.7}
    >
      {/* Card Header */}
      <View style={styles.cardHeader}>
        <View style={styles.routeInfo}>
          <View style={styles.routeIconWrapper}>
            <LinearGradient
              colors={["#3B82F6", "#2563EB"]}
              style={styles.routeIconGradient}
            >
              <Ionicons name="bus" size={20} color="#fff" />
            </LinearGradient>
          </View>
          <View style={styles.routeDetails}>
            <Text
              style={[styles.routeName, { color: textColor }]}
              numberOfLines={1}
            >
              {item.name}
            </Text>
            <View style={styles.routeBadge}>
              <View style={styles.routeBadgeDot} />
              <Text style={styles.routeBadgeText}>Active Route</Text>
            </View>
          </View>
        </View>
        <LinearGradient
          colors={["#3B82F6", "#2563EB"]}
          style={styles.selectButton}
        >
          <Ionicons name="arrow-forward" size={16} color="#fff" />
        </LinearGradient>
      </View>

      {/* Route Details - Journey Path */}
      <View style={styles.routePathContainer}>
        {/* From Location */}
        <View style={styles.locationRow}>
          <View style={styles.locationIndicator}>
            <LinearGradient
              colors={["#10B981", "#059669"]}
              style={styles.locationDot}
            >
              <View style={styles.locationDotInner} />
            </LinearGradient>
            <View style={[styles.connectionLine, isDark && styles.connectionLineDark]} />
          </View>
          <View style={styles.locationInfo}>
            <Text style={[styles.locationLabel, { color: isDark ? "#9CA3AF" : "#6B7280" }]}>
              Starting Point
            </Text>
            <Text
              style={[styles.locationText, { color: textColor }]}
              numberOfLines={2}
            >
              {item.start_address || "Starting point not specified"}
            </Text>
          </View>
        </View>

        {/* To Location */}
        <View style={styles.locationRow}>
          <View style={styles.locationIndicator}>
            <LinearGradient
              colors={["#EF4444", "#DC2626"]}
              style={styles.locationDot}
            >
              <Ionicons name="flag" size={10} color="#fff" />
            </LinearGradient>
          </View>
          <View style={styles.locationInfo}>
            <Text style={[styles.locationLabel, { color: isDark ? "#9CA3AF" : "#6B7280" }]}>
              Destination
            </Text>
            <Text
              style={[styles.locationText, { color: textColor }]}
              numberOfLines={2}
            >
              {item.end_address || "Destination not specified"}
            </Text>
          </View>
        </View>
      </View>

      {/* Card Footer */}
      <LinearGradient
        colors={isDark
          ? ["rgba(59, 130, 246, 0.1)", "rgba(37, 99, 235, 0.05)"]
          : ["rgba(59, 130, 246, 0.05)", "rgba(37, 99, 235, 0.02)"]}
        style={styles.cardFooter}
      >
        <View style={styles.footerLeft}>
          <Ionicons
            name="bus-outline"
            size={14}
            color={isDark ? "#60A5FA" : "#3B82F6"}
          />
          <Text style={[styles.footerText, { color: isDark ? "#60A5FA" : "#3B82F6" }]}>
            View buses & schedule
          </Text>
        </View>
        <View style={styles.footerRight}>
          <Ionicons name="chevron-forward" size={16} color={isDark ? "#60A5FA" : "#3B82F6"} />
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );

  // Premium Loading State
  if (loading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor }]}
        edges={["top", "left", "right"]}
      >
        <StatusBar style={theme === "dark" ? "light" : "dark"} />
        <View style={styles.loadingContainer}>
          <LinearGradient
            colors={["#3B82F6", "#2563EB"]}
            style={styles.loadingIconContainer}
          >
            <Ionicons name="map" size={32} color="#fff" />
          </LinearGradient>
          <Text style={[styles.loadingTitle, { color: textColor }]}>
            Loading Routes
          </Text>
          <Text style={[styles.loadingSubtitle, { color: isDark ? "#9CA3AF" : "#6B7280" }]}>
            Fetching available bus routes...
          </Text>
          <ActivityIndicator
            size="small"
            color={isDark ? "#60A5FA" : "#3B82F6"}
            style={styles.loadingSpinner}
          />
        </View>
      </SafeAreaView>
    );
  }

  // Premium Error State
  if (error) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor }]}
        edges={["top", "left", "right"]}
      >
        <StatusBar style={theme === "dark" ? "light" : "dark"} />
        <View style={styles.errorContainer}>
          <LinearGradient
            colors={["#EF4444", "#DC2626"]}
            style={styles.errorIconContainer}
          >
            <Ionicons name="alert" size={32} color="#fff" />
          </LinearGradient>
          <Text style={[styles.errorTitle, { color: textColor }]}>
            Connection Error
          </Text>
          <Text style={[styles.errorMessage, { color: isDark ? "#9CA3AF" : "#6B7280" }]}>
            {error}
          </Text>
          <TouchableOpacity
            style={styles.retryButtonWrapper}
            onPress={fetchRoutes}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={["#3B82F6", "#2563EB"]}
              style={styles.retryButton}
            >
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={styles.retryButtonText}>Try Again</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor }]}
      edges={["top", "left", "right"]}
    >
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      {/* Premium Gradient Header */}
      <LinearGradient
        colors={isDark
          ? ["#1a365d", "#2563eb", "#3b82f6"]
          : ["#0052d4", "#4364f7", "#6fb1fc"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        {/* Decorative elements */}
        <View style={styles.headerDecorativeCircle1} />
        <View style={styles.headerDecorativeCircle2} />

        <View style={styles.headerContent}>
          <View style={styles.headerIconContainer}>
            <LinearGradient
              colors={["#ffffff", "#f0f9ff"]}
              style={styles.headerIconGradient}
            >
              <Ionicons name="map" size={26} color="#3B82F6" />
            </LinearGradient>
          </View>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Explore Routes</Text>
            <Text style={styles.headerSubtitle}>
              {refreshing ? "Refreshing..." : "Find your perfect journey"}
            </Text>
          </View>
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>{allRoutes.length}</Text>
          </View>
        </View>
      </LinearGradient>

      <FlatList
        data={filteredRoutes}
        renderItem={renderRouteCard}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={["#3B82F6"]}
            tintColor="#3B82F6"
            progressBackgroundColor={isDark ? "#1F2937" : "#ffffff"}
          />
        }
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.searchSection}>
            {/* Premium Search Bar */}
            <View
              style={[
                styles.searchContainer,
                isDark && styles.searchContainerDark,
              ]}
            >
              <LinearGradient
                colors={isDark
                  ? ["rgba(59, 130, 246, 0.2)", "rgba(37, 99, 235, 0.1)"]
                  : ["rgba(59, 130, 246, 0.1)", "rgba(37, 99, 235, 0.05)"]}
                style={styles.searchIconWrapper}
              >
                <Ionicons name="search" size={18} color={isDark ? "#60A5FA" : "#3B82F6"} />
              </LinearGradient>
              <TextInput
                style={[styles.searchInput, { color: textColor }]}
                placeholder="Search routes..."
                placeholderTextColor={isDark ? "#6B7280" : "#9CA3AF"}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity
                  onPress={() => setSearchQuery("")}
                  style={styles.clearButton}
                >
                  <Ionicons
                    name="close-circle"
                    size={20}
                    color={isDark ? "#6B7280" : "#9CA3AF"}
                  />
                </TouchableOpacity>
              )}
            </View>
            {/* Results Count Badge */}
            {filteredRoutes.length > 0 && (
              <View style={styles.resultsContainer}>
                <View style={[styles.resultsBadge, isDark && styles.resultsBadgeDark]}>
                  <Ionicons
                    name="layers-outline"
                    size={14}
                    color={isDark ? "#60A5FA" : "#3B82F6"}
                  />
                  <Text style={[styles.resultsCount, { color: isDark ? "#60A5FA" : "#3B82F6" }]}>
                    {filteredRoutes.length} route{filteredRoutes.length !== 1 ? "s" : ""} available
                  </Text>
                </View>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <LinearGradient
              colors={["rgba(59, 130, 246, 0.1)", "rgba(37, 99, 235, 0.05)"]}
              style={styles.emptyIconWrapper}
            >
              <Ionicons
                name="bus-outline"
                size={48}
                color={isDark ? "#6B7280" : "#9CA3AF"}
              />
            </LinearGradient>
            <Text style={[styles.emptyTitle, { color: textColor }]}>
              {searchQuery ? "No routes found" : "No routes available"}
            </Text>
            <Text
              style={[styles.emptySubtitle, { color: isDark ? "#6B7280" : "#9CA3AF" }]}
            >
              {searchQuery
                ? `No routes match "${searchQuery}"`
                : "Check back later for available routes"}
            </Text>
            {searchQuery && (
              <TouchableOpacity
                style={styles.clearSearchButtonWrapper}
                onPress={() => setSearchQuery("")}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={["#3B82F6", "#2563EB"]}
                  style={styles.clearSearchButton}
                >
                  <Ionicons name="close" size={16} color="#fff" />
                  <Text style={styles.clearSearchButtonText}>Clear Search</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}
          </View>
        }
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  // Premium Header Styles
  header: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    position: "relative",
    overflow: "hidden",
  },
  headerDecorativeCircle1: {
    position: "absolute",
    top: -30,
    right: -30,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  headerDecorativeCircle2: {
    position: "absolute",
    top: 50,
    right: 60,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerIconContainer: {
    marginRight: 14,
  },
  headerIconGradient: {
    width: 52,
    height: 52,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.8)",
    marginTop: 3,
    fontWeight: "500",
  },
  headerBadge: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  headerBadgeText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },

  // List Content
  listContent: {
    paddingBottom: 120,
  },

  // Loading State
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  loadingIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    shadowColor: "#3B82F6",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  loadingTitle: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
  },
  loadingSubtitle: {
    fontSize: 15,
    marginBottom: 24,
  },
  loadingSpinner: {
    marginTop: 8,
  },

  // Error State
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  errorIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    shadowColor: "#EF4444",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  errorMessage: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  retryButtonWrapper: {
    borderRadius: 16,
    overflow: "hidden",
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 28,
    paddingVertical: 14,
    gap: 8,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },

  // Search Section
  searchSection: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.2)",
    shadowColor: "#3B82F6",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  searchContainerDark: {
    backgroundColor: "#1F2937",
    borderColor: "rgba(59, 130, 246, 0.3)",
  },
  searchIconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    marginLeft: 10,
    marginRight: 8,
    fontWeight: "500",
  },
  clearButton: {
    padding: 8,
  },
  resultsContainer: {
    marginTop: 14,
    alignItems: "center",
  },
  resultsBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(59, 130, 246, 0.1)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  resultsBadgeDark: {
    backgroundColor: "rgba(59, 130, 246, 0.2)",
  },
  resultsCount: {
    fontSize: 13,
    fontWeight: "600",
  },

  // Route Card Styles
  routeCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 20,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.04)",
  },
  routeCardDark: {
    backgroundColor: "#1F2937",
    borderColor: "rgba(59, 130, 246, 0.15)",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 18,
    paddingBottom: 14,
  },
  routeInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  routeIconWrapper: {
    marginRight: 14,
  },
  routeIconGradient: {
    width: 46,
    height: 46,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  routeDetails: {
    flex: 1,
  },
  routeName: {
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  routeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  routeBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#10B981",
  },
  routeBadgeText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#10B981",
  },
  selectButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },

  // Route Path Styles
  routePathContainer: {
    paddingHorizontal: 18,
    paddingBottom: 14,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  locationIndicator: {
    alignItems: "center",
    marginRight: 14,
  },
  locationDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  locationDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#fff",
  },
  connectionLine: {
    width: 2,
    height: 28,
    backgroundColor: "#E5E7EB",
    marginVertical: 4,
  },
  connectionLineDark: {
    backgroundColor: "#374151",
  },
  locationInfo: {
    flex: 1,
    paddingBottom: 8,
  },
  locationLabel: {
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  locationText: {
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },

  // Card Footer
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  footerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  footerRight: {
    alignItems: "center",
  },
  footerText: {
    fontSize: 13,
    fontWeight: "600",
  },

  // Empty State
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 60,
  },
  emptyIconWrapper: {
    width: 100,
    height: 100,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
  clearSearchButtonWrapper: {
    marginTop: 20,
    borderRadius: 16,
    overflow: "hidden",
  },
  clearSearchButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 8,
  },
  clearSearchButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
});

export default RouteScreen;
