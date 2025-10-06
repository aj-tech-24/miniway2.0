import { useAuth } from "@/contexts/AuthContext";
import { useAppTheme } from "@/contexts/ThemeContext";
import { useThemeColor } from "@/hooks/useThemeColor";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
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

// --- FIX 1: Update the 'routes' property type ---
// 'routes' should be an array of objects, not a single object.
type HistoryItem = {
  id: string;
  start_location_name: string | null;
  end_location_name: string | null;
  travel_date: string;
  route_name: string | null;
  status?: string; // 'completed' | 'cancelled' | other
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
  const borderColor = useThemeColor({}, "borderColor");
  const textColor = useThemeColor({}, "text");
  const primaryColor = useThemeColor({}, "tint");
  const tabIconDefault = useThemeColor({}, "tabIconDefault");
  const placeholderTextColor = useThemeColor({}, "placeholderTextColor");
  const separatorColor = useThemeColor({}, "separatorColor");
  const { theme } = useAppTheme();

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

  // Filter history based on selected filter
  const filteredHistory = history.filter((item) => {
    if (selectedFilter === "all") return true;
    return item.status?.toLowerCase() === selectedFilter;
  });

  // Get statistics
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
          color: "#34C759",
          backgroundColor: "rgba(52,199,89,0.1)",
          label: "Completed",
        };
      }
      if (s === "cancelled") {
        return {
          icon: "close-circle" as const,
          color: "#FF3B30",
          backgroundColor: "rgba(255,59,48,0.1)",
          label: "Cancelled",
        };
      }
      return {
        icon: "time" as const,
        color: "#007AFF",
        backgroundColor: "rgba(0,122,255,0.1)",
        label: s ? s.charAt(0).toUpperCase() + s.slice(1) : "Completed",
      };
    };

    const statusConfig = getStatusConfig(item.status);
    const travelDate = new Date(item.travel_date);
    const formattedDate = travelDate.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const formattedTime = travelDate.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });

    return (
      <TouchableOpacity
        style={[styles.historyCard, { backgroundColor }]}
        activeOpacity={0.7}
      >
        {/* Card Header */}
        <View style={styles.cardHeader}>
          <View style={styles.routeInfo}>
            <View
              style={[
                styles.routeIconContainer,
                { backgroundColor: statusConfig.backgroundColor },
              ]}
            >
              <Ionicons name="bus" size={20} color={statusConfig.color} />
            </View>
            <View style={styles.routeDetails}>
              <Text
                style={[styles.routeName, { color: textColor }]}
                numberOfLines={1}
              >
                {routeName}
              </Text>
              <Text
                style={[styles.routeSubtitle, { color: placeholderTextColor }]}
              >
                {formattedDate} • {formattedTime}
              </Text>
            </View>
          </View>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: statusConfig.backgroundColor },
            ]}
          >
            <Ionicons
              name={statusConfig.icon}
              size={14}
              color={statusConfig.color}
            />
            <Text style={[styles.statusText, { color: statusConfig.color }]}>
              {statusConfig.label}
            </Text>
          </View>
        </View>

        {/* Route Details */}
        <View style={styles.routeDetailsContainer}>
          <View style={styles.locationRow}>
            <View
              style={[styles.locationDot, { backgroundColor: "#34C759" }]}
            />
            <View style={styles.locationInfo}>
              <Text
                style={[styles.locationLabel, { color: placeholderTextColor }]}
              >
                From
              </Text>
              <Text
                style={[styles.locationText, { color: textColor }]}
                numberOfLines={2}
              >
                {item.start_location_name || "Unknown location"}
              </Text>
            </View>
          </View>

          <View style={styles.connectionLine} />

          <View style={styles.locationRow}>
            <View
              style={[styles.locationDot, { backgroundColor: "#FF3B30" }]}
            />
            <View style={styles.locationInfo}>
              <Text
                style={[styles.locationLabel, { color: placeholderTextColor }]}
              >
                To
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

        {/* Card Footer */}
        <View style={[styles.cardFooter, { borderTopColor: separatorColor }]}>
          <View style={styles.footerLeft}>
            <Ionicons
              name="calendar-outline"
              size={16}
              color={placeholderTextColor}
            />
            <Text style={[styles.footerText, { color: placeholderTextColor }]}>
              {formattedDate}
            </Text>
          </View>
          <View style={styles.footerRight}>
            <Ionicons
              name="time-outline"
              size={16}
              color={placeholderTextColor}
            />
            <Text style={[styles.footerText, { color: placeholderTextColor }]}>
              {formattedTime}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderFilterButton = (
    filter: "all" | "completed" | "cancelled",
    label: string,
    count: number
  ) => (
    <TouchableOpacity
      style={[
        styles.filterButton,
        selectedFilter === filter && styles.filterButtonActive,
        {
          borderColor: selectedFilter === filter ? primaryColor : borderColor,
        },
        { backgroundColor },
      ]}
      onPress={() => setSelectedFilter(filter)}
    >
      <Text
        style={[
          styles.filterButtonText,
          { color: selectedFilter === filter ? primaryColor : textColor },
        ]}
      >
        {label}
      </Text>
      <View
        style={[
          styles.filterCount,
          {
            backgroundColor:
              selectedFilter === filter ? primaryColor : separatorColor,
          },
          { backgroundColor },
        ]}
      >
        <Text
          style={[
            styles.filterCountText,
            { color: selectedFilter === filter ? "#fff" : textColor },
            { color: textColor },
          ]}
        >
          {count}
        </Text>
      </View>
    </TouchableOpacity>
  );

  const renderStatsCard = () => (
    <View style={[styles.statsCard, { backgroundColor }]}>
      <View style={styles.statsHeader}>
        <Ionicons name="analytics-outline" size={24} color={primaryColor} />
        <Text style={[styles.statsTitle, { color: textColor }]}>
          Travel Summary
        </Text>
      </View>
      <View style={styles.statsGrid}>
        <View style={styles.statItem}>
          <Text style={[styles.statNumber, { color: textColor }]}>
            {stats.total}
          </Text>
          <Text style={[styles.statLabel, { color: placeholderTextColor }]}>
            Total Trips
          </Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statNumber, { color: "#34C759" }]}>
            {stats.completed}
          </Text>
          <Text style={[styles.statLabel, { color: placeholderTextColor }]}>
            Completed
          </Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statNumber, { color: "#FF3B30" }]}>
            {stats.cancelled}
          </Text>
          <Text style={[styles.statLabel, { color: placeholderTextColor }]}>
            Cancelled
          </Text>
        </View>
      </View>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor }]}
        edges={["top", "left", "right"]}
      >
        <StatusBar style={theme === "dark" ? "light" : "dark"} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={[styles.loadingText, { color: textColor }]}>
            Loading your travel history...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor }]}
        edges={["top", "left", "right"]}
      >
        <StatusBar style={theme === "dark" ? "light" : "dark"} />
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={60} color="#FF3B30" />
          <Text style={[styles.errorTitle, { color: textColor }]}>
            Oops! Something went wrong
          </Text>
          <Text style={[styles.errorMessage, { color: placeholderTextColor }]}>
            {error}
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: primaryColor }]}
            onPress={fetchHistory}
          >
            <Ionicons name="refresh" size={20} color="#fff" />
            <Text style={styles.retryButtonText}>Try Again</Text>
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

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.headerIconContainer}>
            <Ionicons name="time-outline" size={28} color="#007AFF" />
          </View>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Travel History</Text>
            <Text style={styles.headerSubtitle}>
              {refreshing
                ? "Refreshing..."
                : "Your completed trips and journeys"}
            </Text>
          </View>
        </View>
      </View>

      <FlatList
        data={filteredHistory}
        renderItem={renderHistoryCard}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={["#007AFF"]}
            tintColor="#007AFF"
            title="Pull to refresh history"
            titleColor="#8e8e93"
            progressBackgroundColor="#ffffff"
          />
        }
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            {renderStatsCard()}
            <View style={styles.filtersContainer}>
              {renderFilterButton("all", "All", stats.total)}
              {renderFilterButton("completed", "Completed", stats.completed)}
              {renderFilterButton("cancelled", "Cancelled", stats.cancelled)}
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="trail-sign-outline" size={80} color="#d1d1d6" />
            <Text style={[styles.emptyTitle, { color: textColor }]}>
              {selectedFilter === "all"
                ? "No trips yet"
                : `No ${selectedFilter} trips`}
            </Text>
            <Text
              style={[styles.emptySubtitle, { color: placeholderTextColor }]}
            >
              {selectedFilter === "all"
                ? "Your completed trips will appear here."
                : `You don't have any ${selectedFilter} trips yet.`}
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
    backgroundColor: "#f8f9fa",
  },
  header: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgb(255, 255, 255)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#fff",
  },
  headerSubtitle: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.8)",
    marginTop: 2,
  },
  listContent: {
    paddingBottom: 100,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  loadingText: {
    fontSize: 16,
    marginTop: 16,
    textAlign: "center",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginTop: 16,
    textAlign: "center",
  },
  errorMessage: {
    fontSize: 16,
    marginTop: 8,
    textAlign: "center",
    lineHeight: 22,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 20,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },
  statsCard: {
    margin: 20,
    padding: 20,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  statsHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  statsTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginLeft: 12,
  },
  statsGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statItem: {
    alignItems: "center",
    flex: 1,
  },
  statNumber: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: "500",
  },
  filtersContainer: {
    flexDirection: "row",
    paddingHorizontal: 20,
    marginBottom: 20,
    gap: 12,
  },
  filterButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: "#fff",
  },
  filterButtonActive: {
    backgroundColor: "rgb(0, 123, 255)",
  },
  filterButtonText: {
    fontSize: 14,
    fontWeight: "600",
    marginRight: 8,
  },
  filterCount: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 6,
  },
  filterCountText: {
    fontSize: 12,
    fontWeight: "600",
  },
  historyCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
    paddingBottom: 16,
  },
  routeInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  routeIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  routeDetails: {
    flex: 1,
  },
  routeName: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  routeSubtitle: {
    fontSize: 12,
    fontWeight: "500",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 4,
  },
  routeDetailsContainer: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  locationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
    marginRight: 12,
  },
  locationInfo: {
    flex: 1,
  },
  locationLabel: {
    fontSize: 12,
    fontWeight: "500",
    marginBottom: 2,
  },
  locationText: {
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
  connectionLine: {
    width: 2,
    height: 20,
    backgroundColor: "#E5E5E7",
    marginLeft: 3,
    marginBottom: 12,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    backgroundColor: "rgba(0, 0, 0, 0.02)",
  },
  footerLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  footerRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  footerText: {
    fontSize: 12,
    fontWeight: "500",
    marginLeft: 6,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginTop: 16,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 16,
    marginTop: 8,
    textAlign: "center",
    lineHeight: 22,
  },
});

export default TravelHistoryScreen;
