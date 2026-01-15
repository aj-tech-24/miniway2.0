import { useAuth } from "@/contexts/AuthContext";
import { useAppTheme } from "@/contexts/ThemeContext";
import { useThemeColor } from "@/hooks/useThemeColor";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type HistoryItem = {
  id: string;
  start_location_name: string | null;
  end_location_name: string | null;
  travel_date: string;
  route_name: string | null;
  status?: string;
};

export function TravelHistoryScreen() {
  const { session } = useAuth();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<
    "all" | "completed" | "cancelled"
  >("all");

  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const primaryColor = useThemeColor({}, "tint");
  const placeholderTextColor = useThemeColor({}, "placeholderTextColor");
  const { theme } = useAppTheme();

  const isDark = theme === "dark";

  const fetchHistory = useCallback(async () => {
    if (!session?.user) return;

    try {
      setError(null);
      const { data, error } = await supabase
        .from("travel_history_commuter")
        .select(
          "id, start_location_name, end_location_name, travel_date, route_name, status"
        )
        .eq("user_id", session.user.id)
        .order("travel_date", { ascending: false });

      if (error) {
        throw error;
      }

      setHistory(
        (data ?? []).map((item: any) => ({
          id: item.id,
          start_location_name: item.start_location_name,
          end_location_name: item.end_location_name,
          travel_date: item.travel_date,
          route_name: item.route_name ?? null,
          status: (item.status ?? "completed") as
            | "completed"
            | "cancelled"
            | string,
        }))
      );
    } catch (error) {
      console.error("Error fetching travel history:", error);
      setError("Failed to load travel history. Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session?.user]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchHistory();
  }, [fetchHistory]);

  const filteredHistory = history.filter((item) => {
    if (selectedFilter === "all") return true;
    return item.status?.toLowerCase() === selectedFilter;
  });

  const stats = {
    total: history.length,
    completed: history.filter(
      (item) => item.status?.toLowerCase() === "completed"
    ).length,
    cancelled: history.filter(
      (item) => item.status?.toLowerCase() === "cancelled"
    ).length,
  };

  const renderHistoryCard = ({ item }: { item: HistoryItem }) => {
    const routeName = item.route_name || "Unknown Route";
    const isCompleted = item.status?.toLowerCase() === "completed";
    const isCancelled = item.status?.toLowerCase() === "cancelled";

    const getStatusConfig = (status?: string) => {
      const s = (status || "").toLowerCase();
      if (s === "completed") {
        return {
          icon: "checkmark-circle" as const,
          colors: ["#10B981", "#059669"] as const,
          label: "Completed",
        };
      }
      if (s === "cancelled") {
        return {
          icon: "close-circle" as const,
          colors: ["#EF4444", "#DC2626"] as const,
          label: "Cancelled",
        };
      }
      return {
        icon: "time" as const,
        colors: ["#3B82F6", "#2563EB"] as const,
        label: s ? s.charAt(0).toUpperCase() + s.slice(1) : "Completed",
      };
    };

    const statusConfig = getStatusConfig(item.status);
    const travelDate = new Date(item.travel_date);
    const formattedDate = travelDate.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const formattedTime = travelDate.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });

    return (
      <TouchableOpacity
        style={[styles.historyCard, isDark && styles.historyCardDark]}
        activeOpacity={0.7}
      >
        {/* Card Header */}
        <View style={styles.cardHeader}>
          <View style={styles.routeInfo}>
            <View style={styles.routeIconWrapper}>
              <LinearGradient
                colors={statusConfig.colors}
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
                {routeName}
              </Text>
              <View style={styles.dateTimeRow}>
                <Ionicons
                  name="calendar-outline"
                  size={12}
                  color={isDark ? "#9CA3AF" : "#6B7280"}
                />
                <Text style={[styles.dateTimeText, { color: isDark ? "#9CA3AF" : "#6B7280" }]}>
                  {formattedDate} • {formattedTime}
                </Text>
              </View>
            </View>
          </View>
          <LinearGradient
            colors={statusConfig.colors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.statusBadge}
          >
            <Ionicons
              name={statusConfig.icon}
              size={12}
              color="#fff"
            />
            <Text style={styles.statusText}>
              {statusConfig.label}
            </Text>
          </LinearGradient>
        </View>

        {/* Route Path */}
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
                Pickup
              </Text>
              <Text
                style={[styles.locationText, { color: textColor }]}
                numberOfLines={2}
              >
                {item.start_location_name || "Unknown location"}
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
                Drop-off
              </Text>
              <Text
                style={[styles.locationText, { color: textColor }]}
                numberOfLines={2}
              >
                {item.end_location_name || "Unknown location"}
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderFilterButton = (
    filter: "all" | "completed" | "cancelled",
    label: string,
    count: number,
    colors: readonly [string, string]
  ) => {
    const isActive = selectedFilter === filter;

    return (
      <TouchableOpacity
        style={[
          styles.filterButton,
          isDark && styles.filterButtonDark,
          isActive && styles.filterButtonActive,
        ]}
        onPress={() => setSelectedFilter(filter)}
        activeOpacity={0.7}
      >
        {isActive ? (
          <LinearGradient
            colors={colors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.filterButtonGradient}
          >
            <Text style={styles.filterButtonTextActive}>{label}</Text>
            <View style={styles.filterCountActive}>
              <Text style={styles.filterCountTextActive}>{count}</Text>
            </View>
          </LinearGradient>
        ) : (
          <View style={styles.filterButtonInner}>
            <Text style={[styles.filterButtonText, { color: isDark ? "#9CA3AF" : "#6B7280" }]}>
              {label}
            </Text>
            <View style={[styles.filterCount, isDark && styles.filterCountDark]}>
              <Text style={[styles.filterCountText, { color: isDark ? "#9CA3AF" : "#6B7280" }]}>
                {count}
              </Text>
            </View>
          </View>
        )}
      </TouchableOpacity>
    );
  };
  const renderStatsCard = () => (
    <View style={[styles.statsCard, isDark && styles.statsCardDark]}>
      <LinearGradient
        colors={isDark
          ? ["rgba(59, 130, 246, 0.1)", "rgba(37, 99, 235, 0.05)"]
          : ["rgba(59, 130, 246, 0.08)", "rgba(37, 99, 235, 0.02)"]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.statsHeader}>
        <View style={styles.statsIconWrapper}>
          <LinearGradient
            colors={["#3B82F6", "#2563EB"]}
            style={styles.statsIconGradient}
          >
            <Ionicons name="analytics" size={20} color="#fff" />
          </LinearGradient>
        </View>
        <View>
          <Text style={[styles.statsTitle, { color: textColor }]}>
            Travel Summary
          </Text>
          <Text style={[styles.statsSubtitle, { color: isDark ? "#9CA3AF" : "#6B7280" }]}>
            Your journey statistics
          </Text>
        </View>
      </View>
      <View style={styles.statsGrid}>
        <View style={[styles.statItem, isDark && styles.statItemDark]}>
          <LinearGradient
            colors={["#3B82F6", "#2563EB"]}
            style={styles.statIconBg}
          >
            <Ionicons name="layers" size={16} color="#fff" />
          </LinearGradient>
          <Text style={[styles.statNumber, { color: textColor }]}>
            {stats.total}
          </Text>
          <Text style={[styles.statLabel, { color: isDark ? "#9CA3AF" : "#6B7280" }]}>
            Total
          </Text>
        </View>
        <View style={[styles.statItem, isDark && styles.statItemDark]}>
          <LinearGradient
            colors={["#10B981", "#059669"]}
            style={styles.statIconBg}
          >
            <Ionicons name="checkmark" size={16} color="#fff" />
          </LinearGradient>
          <Text style={[styles.statNumber, { color: "#10B981" }]}>
            {stats.completed}
          </Text>
          <Text style={[styles.statLabel, { color: isDark ? "#9CA3AF" : "#6B7280" }]}>
            Completed
          </Text>
        </View>
        <View style={[styles.statItem, isDark && styles.statItemDark]}>
          <LinearGradient
            colors={["#EF4444", "#DC2626"]}
            style={styles.statIconBg}
          >
            <Ionicons name="close" size={16} color="#fff" />
          </LinearGradient>
          <Text style={[styles.statNumber, { color: "#EF4444" }]}>
            {stats.cancelled}
          </Text>
          <Text style={[styles.statLabel, { color: isDark ? "#9CA3AF" : "#6B7280" }]}>
            Cancelled
          </Text>
        </View>
      </View>
    </View>
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
            <Ionicons name="time" size={32} color="#fff" />
          </LinearGradient>
          <Text style={[styles.loadingTitle, { color: textColor }]}>
            Loading History
          </Text>
          <Text style={[styles.loadingSubtitle, { color: isDark ? "#9CA3AF" : "#6B7280" }]}>
            Fetching your travel records...
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
            onPress={fetchHistory}
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
              <Ionicons name="time" size={26} color="#3B82F6" />
            </LinearGradient>
          </View>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Travel History</Text>
            <Text style={styles.headerSubtitle}>
              {refreshing
                ? "Refreshing..."
                : "Your journey timeline"}
            </Text>
          </View>
          {stats.total > 0 && (
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>{stats.total}</Text>
            </View>
          )}
        </View>
      </LinearGradient>

      <FlatList
        data={filteredHistory}
        renderItem={renderHistoryCard}
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
          <View>
            {renderStatsCard()}
            <View style={styles.filtersContainer}>
              {renderFilterButton("all", "All", stats.total, ["#3B82F6", "#2563EB"])}
              {renderFilterButton("completed", "Done", stats.completed, ["#10B981", "#059669"])}
              {renderFilterButton("cancelled", "Cancelled", stats.cancelled, ["#EF4444", "#DC2626"])}
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <LinearGradient
              colors={["rgba(59, 130, 246, 0.1)", "rgba(37, 99, 235, 0.05)"]}
              style={styles.emptyIconWrapper}
            >
              <Ionicons
                name="trail-sign-outline"
                size={48}
                color={isDark ? "#6B7280" : "#9CA3AF"}
              />
            </LinearGradient>
            <Text style={[styles.emptyTitle, { color: textColor }]}>
              {selectedFilter === "all"
                ? "No trips yet"
                : `No ${selectedFilter} trips`}
            </Text>
            <Text
              style={[styles.emptySubtitle, { color: isDark ? "#6B7280" : "#9CA3AF" }]}
            >
              {selectedFilter === "all"
                ? "Your journey history will appear here"
                : `No ${selectedFilter} trips found`}
            </Text>
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
  }, loadingIconContainer: {
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

  // Stats Card
  statsCard: {
    margin: 20,
    marginBottom: 16,
    padding: 18,
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
  }, statsCardDark: {
    backgroundColor: "#1F2937",
    borderColor: "rgba(59, 130, 246, 0.15)",
  },
  statsHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
  },
  statsIconWrapper: {
    marginRight: 14,
  },
  statsIconGradient: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  statsTitle: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  statsSubtitle: {
    fontSize: 13,
    fontWeight: "400",
    marginTop: 2,
  },
  statsGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.02)",
    paddingVertical: 16,
    borderRadius: 16,
  },
  statItemDark: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  statIconBg: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: "500",
  },

  // Filter Buttons
  filtersContainer: {
    flexDirection: "row",
    paddingHorizontal: 20,
    marginBottom: 16,
    gap: 10,
  },
  filterButton: {
    flex: 1,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.06)",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  filterButtonDark: {
    backgroundColor: "#1F2937",
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  filterButtonActive: {
    borderWidth: 0,
  },
  filterButtonGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  filterButtonInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  filterButtonText: {
    fontSize: 13,
    fontWeight: "600",
  },
  filterButtonTextActive: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
  },
  filterCount: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.05)",
  },
  filterCountDark: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  filterCountActive: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.25)",
  },
  filterCountText: {
    fontSize: 12,
    fontWeight: "600",
  },
  filterCountTextActive: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
  },

  // History Card
  historyCard: {
    marginHorizontal: 20,
    marginBottom: 14,
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
  historyCardDark: {
    backgroundColor: "#1F2937",
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    paddingBottom: 12,
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
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  routeDetails: {
    flex: 1,
  },
  routeName: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  dateTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  dateTimeText: {
    fontSize: 12,
    fontWeight: "500",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    gap: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.3,
  },

  // Route Path
  routePathContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
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
    height: 24,
    backgroundColor: "#E5E7EB",
    marginVertical: 4,
  },
  connectionLineDark: {
    backgroundColor: "#374151",
  },
  locationInfo: {
    flex: 1,
    paddingBottom: 6,
  },
  locationLabel: {
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  }, locationText: {
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
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
});

export default TravelHistoryScreen;
