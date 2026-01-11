import { useAppTheme } from "@/contexts/ThemeContext";
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

interface Trip {
  id: string;
  status: "waiting" | "ongoing" | "completed" | "cancelled";
  updated_at: string;
  started_at: string | null;
  ended_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  buses: {
    id: string;
    plate_number: string;
    capacity: number;
    routes: {
      id: string;
      name: string;
      start_address: string;
      end_address: string;
    };
  };
  trip_passengers: Array<{
    id: string;
    status: "boarded" | "completed" | "cancelled";
    boarded_at: string;
  }>;
}

const TripsScreen = () => {
  const { theme } = useAppTheme();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTrips = useCallback(async () => {
    try {
      setError(null);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setError("User not authenticated");
        return;
      }

      const { data, error: tripsError } = await supabase
        .from("trips")
        .select(
          `
          id,
          status,
          updated_at,
          started_at,
          ended_at,
          cancelled_at,
          cancellation_reason,
          buses!inner(
            id,
            plate_number,
            capacity,
            routes!inner(
              id,
              name,
              start_address,
              end_address
            )
          ),
          trip_passengers(
            id,
            status,
            boarded_at
          )
        `
        )
        .eq("driver_id", user.id)
        .order("updated_at", { ascending: false });

      if (tripsError) {
        setError("Failed to load trips");
        return;
      }

      setTrips((data as any[]) || []);
    } catch (error) {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchTrips();
  }, [fetchTrips]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchTrips();
  }, [fetchTrips]);

  const getStatusConfig = (status: string) => {
    switch (status) {
      case "completed":
        return {
          color: "#10B981",
          gradient: ["#10B981", "#059669"] as const,
          icon: "checkmark-circle" as const,
          label: "Completed"
        };
      case "ongoing":
        return {
          color: "#F59E0B",
          gradient: ["#F59E0B", "#D97706"] as const,
          icon: "play-circle" as const,
          label: "In Progress"
        };
      case "cancelled":
        return {
          color: "#EF4444",
          gradient: ["#EF4444", "#DC2626"] as const,
          icon: "close-circle" as const,
          label: "Cancelled"
        };
      case "waiting":
        return {
          color: "#6B7280",
          gradient: ["#6B7280", "#4B5563"] as const,
          icon: "time" as const,
          label: "Waiting"
        };
      default:
        return {
          color: "#6B7280",
          gradient: ["#6B7280", "#4B5563"] as const,
          icon: "help-circle" as const,
          label: "Unknown"
        };
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getPassengerCount = (tripPassengers: any[]) => {
    return tripPassengers.filter(
      (p) => p.status === "completed" || p.status === "boarded"
    ).length;
  };

  const renderTripItem = ({ item }: { item: Trip }) => {
    const passengerCount = getPassengerCount(item.trip_passengers);
    const statusConfig = getStatusConfig(item.status);

    if (!item.buses || !item.buses.routes) {
      return (
        <View style={styles.tripCard}>
          <View style={styles.tripHeader}>
            <View style={styles.tripInfo}>
              <Text style={styles.routeName}>Trip #{item.id.slice(-8)}</Text>
              <Text style={styles.busPlate}>Incomplete Data</Text>
            </View>
            <LinearGradient
              colors={statusConfig.gradient}
              style={styles.statusBadge}
            >
              <Ionicons name={statusConfig.icon} size={14} color="#fff" />
              <Text style={styles.statusText}>{statusConfig.label}</Text>
            </LinearGradient>
          </View>
          <View style={styles.incompleteDataContainer}>
            <Ionicons name="warning" size={16} color="#F59E0B" />
            <Text style={styles.incompleteDataText}>
              Some trip data is missing. Please contact support if this persists.
            </Text>
          </View>
        </View>
      );
    }

    const bus = item.buses;
    const route = bus.routes;

    return (
      <TouchableOpacity style={styles.tripCard} activeOpacity={0.7}>
        {/* Trip Header */}
        <View style={styles.tripHeader}>
          <View style={styles.tripInfo}>
            <Text style={styles.routeName}>{route.name}</Text>
            <View style={styles.busPlateContainer}>
              <Ionicons name="bus" size={12} color="#64748B" />
              <Text style={styles.busPlate}>{bus.plate_number}</Text>
            </View>
          </View>
          <LinearGradient
            colors={statusConfig.gradient}
            style={styles.statusBadge}
          >
            <Ionicons name={statusConfig.icon} size={14} color="#fff" />
            <Text style={styles.statusText}>{statusConfig.label}</Text>
          </LinearGradient>
        </View>

        {/* Route Details */}
        <View style={styles.routeDetails}>
          <View style={styles.routeItem}>
            <LinearGradient
              colors={["#10B981", "#059669"]}
              style={styles.locationMarker}
            >
              <Ionicons name="location" size={10} color="#fff" />
            </LinearGradient>
            <View style={styles.routeTextContainer}>
              <Text style={styles.routeLabel}>From</Text>
              <Text style={styles.locationText}>{route.start_address}</Text>
            </View>
          </View>
          <View style={styles.routeConnector}>
            <View style={styles.routeConnectorLine} />
            <Ionicons name="arrow-down" size={14} color="#CBD5E1" />
            <View style={styles.routeConnectorLine} />
          </View>
          <View style={styles.routeItem}>
            <LinearGradient
              colors={["#EF4444", "#DC2626"]}
              style={styles.locationMarker}
            >
              <Ionicons name="location" size={10} color="#fff" />
            </LinearGradient>
            <View style={styles.routeTextContainer}>
              <Text style={styles.routeLabel}>To</Text>
              <Text style={styles.locationText}>{route.end_address}</Text>
            </View>
          </View>
        </View>

        {/* Trip Stats */}
        <View style={styles.tripStats}>
          <View style={styles.statItem}>
            <View style={styles.statIconBg}>
              <Ionicons name="people" size={14} color="#0891B2" />
            </View>
            <View>
              <Text style={styles.statLabel}>Passengers</Text>
              <Text style={styles.statValue}>
                {passengerCount}/{bus.capacity}
              </Text>
            </View>
          </View>
          <View style={styles.statItem}>
            <View style={styles.statIconBg}>
              <Ionicons name="calendar" size={14} color="#8B5CF6" />
            </View>
            <View>
              <Text style={styles.statLabel}>Date</Text>
              <Text style={styles.statValue}>{formatDate(item.updated_at)}</Text>
            </View>
          </View>
          {item.started_at && (
            <View style={styles.statItem}>
              <View style={styles.statIconBg}>
                <Ionicons name="time" size={14} color="#F59E0B" />
              </View>
              <View>
                <Text style={styles.statLabel}>Start</Text>
                <Text style={styles.statValue}>{formatTime(item.started_at)}</Text>
              </View>
            </View>
          )}
        </View>

        {/* Trip Timeline */}
        <View style={styles.timeline}>
          <View style={styles.timelineItem}>
            <View style={[styles.timelineDot, { backgroundColor: "#10B981" }]} />
            <Text style={styles.timelineText}>Trip Created</Text>
            <Text style={styles.timelineTime}>{formatTime(item.updated_at)}</Text>
          </View>

          {item.started_at && (
            <View style={styles.timelineItem}>
              <View style={[styles.timelineDot, { backgroundColor: "#F59E0B" }]} />
              <Text style={styles.timelineText}>Trip Started</Text>
              <Text style={styles.timelineTime}>{formatTime(item.started_at)}</Text>
            </View>
          )}

          {item.ended_at && (
            <View style={styles.timelineItem}>
              <View style={[styles.timelineDot, { backgroundColor: "#10B981" }]} />
              <Text style={styles.timelineText}>Trip Completed</Text>
              <Text style={styles.timelineTime}>{formatTime(item.ended_at)}</Text>
            </View>
          )}

          {item.cancelled_at && (
            <View style={styles.timelineItem}>
              <View style={[styles.timelineDot, { backgroundColor: "#EF4444" }]} />
              <Text style={styles.timelineText}>Trip Cancelled</Text>
              <Text style={styles.timelineTime}>{formatTime(item.cancelled_at)}</Text>
            </View>
          )}
        </View>

        {item.cancellation_reason && (
          <View style={styles.cancellationReason}>
            <Ionicons name="information-circle" size={16} color="#EF4444" />
            <View style={styles.cancellationContent}>
              <Text style={styles.cancellationLabel}>Cancellation Reason</Text>
              <Text style={styles.cancellationText}>
                {item.cancellation_reason}
              </Text>
            </View>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <LinearGradient
        colors={["#0891B2", "#06B6D4"]}
        style={styles.emptyIconContainer}
      >
        <Ionicons name="car-outline" size={40} color="#fff" />
      </LinearGradient>
      <Text style={styles.emptyTitle}>No Trips Yet</Text>
      <Text style={styles.emptySubtitle}>
        Your trip history will appear here once you start driving
      </Text>
    </View>
  );

  const renderErrorState = () => (
    <View style={styles.errorState}>
      <LinearGradient
        colors={["#EF4444", "#DC2626"]}
        style={styles.errorIconContainer}
      >
        <Ionicons name="alert-circle-outline" size={40} color="#fff" />
      </LinearGradient>
      <Text style={styles.errorTitle}>Failed to Load Trips</Text>
      <Text style={styles.errorSubtitle}>{error}</Text>
      <TouchableOpacity style={styles.retryButtonWrapper} onPress={fetchTrips}>
        <LinearGradient
          colors={["#0891B2", "#06B6D4"]}
          style={styles.retryButton}
        >
          <Ionicons name="refresh" size={18} color="#fff" />
          <Text style={styles.retryButtonText}>Try Again</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style={theme === "dark" ? "light" : "dark"} />
        <View style={styles.loadingContainer}>
          <View style={styles.loadingSpinner}>
            <ActivityIndicator size="large" color="#0891B2" />
          </View>
          <Text style={styles.loadingText}>Loading your trips...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style={theme === "dark" ? "light" : "dark"} />
        {renderErrorState()}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      {/* Premium Header */}
      <LinearGradient
        colors={["#0891B2", "#06B6D4", "#22D3EE"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerDecoCircle1} />
        <View style={styles.headerDecoCircle2} />
        <View style={styles.headerContent}>
          <View style={styles.headerIconContainer}>
            <Ionicons name="time" size={24} color="#fff" />
          </View>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Trip History</Text>
            <Text style={styles.headerSubtitle}>
              {trips.length} {trips.length === 1 ? "trip" : "trips"} recorded
            </Text>
          </View>
        </View>
        {/* Stats Summary */}
        <View style={styles.headerStats}>
          <View style={styles.headerStatItem}>
            <Text style={styles.headerStatValue}>
              {trips.filter(t => t.status === "completed").length}
            </Text>
            <Text style={styles.headerStatLabel}>Completed</Text>
          </View>
          <View style={styles.headerStatDivider} />
          <View style={styles.headerStatItem}>
            <Text style={styles.headerStatValue}>
              {trips.filter(t => t.status === "cancelled").length}
            </Text>
            <Text style={styles.headerStatLabel}>Cancelled</Text>
          </View>
          <View style={styles.headerStatDivider} />
          <View style={styles.headerStatItem}>
            <Text style={styles.headerStatValue}>
              {trips.reduce((acc, t) => acc + getPassengerCount(t.trip_passengers), 0)}
            </Text>
            <Text style={styles.headerStatLabel}>Passengers</Text>
          </View>
        </View>
      </LinearGradient>

      {/* Trips List */}
      <FlatList
        data={trips}
        renderItem={renderTripItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={["#0891B2"]}
            tintColor="#0891B2"
          />
        }
        ListEmptyComponent={renderEmptyState}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },

  // Premium Header Styles
  header: {
    paddingTop: 16,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    marginBottom: 16,
    overflow: "hidden",
    position: "relative",
  },
  headerDecoCircle1: {
    position: "absolute",
    top: -40,
    right: -40,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  headerDecoCircle2: {
    position: "absolute",
    bottom: -20,
    left: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  headerIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.85)",
    marginTop: 2,
  },
  headerStats: {
    flexDirection: "row",
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  headerStatItem: {
    flex: 1,
    alignItems: "center",
  },
  headerStatValue: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fff",
  },
  headerStatLabel: {
    fontSize: 11,
    color: "rgba(255, 255, 255, 0.8)",
    marginTop: 2,
    fontWeight: "500",
  },
  headerStatDivider: {
    width: 1,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    marginHorizontal: 10,
  },

  // Loading States
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingSpinner: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: "#CFFAFE",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  loadingText: {
    fontSize: 16,
    color: "#64748B",
    fontWeight: "500",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
    paddingTop: 60,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1E293B",
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: "#64748B",
    textAlign: "center",
    lineHeight: 22,
  },
  errorState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  errorIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1E293B",
    marginBottom: 8,
  },
  errorSubtitle: {
    fontSize: 15,
    color: "#64748B",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  retryButtonWrapper: {
    borderRadius: 14,
    overflow: "hidden",
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 14,
    gap: 8,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },

  // List Styles
  listContainer: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },

  // Trip Card Styles
  tripCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
    shadowColor: "#0891B2",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  tripHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  tripInfo: {
    flex: 1,
  },
  routeName: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1E293B",
    marginBottom: 6,
  },
  busPlateContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  busPlate: {
    fontSize: 13,
    color: "#64748B",
    fontWeight: "500",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#fff",
  },

  // Route Details
  routeDetails: {
    marginBottom: 16,
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    padding: 14,
  },
  routeItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  routeTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  routeLabel: {
    fontSize: 10,
    color: "#94A3B8",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  routeConnector: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 9,
    marginVertical: 6,
  },
  routeConnectorLine: {
    width: 1,
    height: 8,
    backgroundColor: "#CBD5E1",
  },
  locationMarker: {
    width: 22,
    height: 22,
    borderRadius: 7,
    justifyContent: "center",
    alignItems: "center",
  },
  locationText: {
    fontSize: 14,
    color: "#1E293B",
    fontWeight: "500",
    marginTop: 2,
  },

  // Trip Stats
  tripStats: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 8,
  },
  statIconBg: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#F1F5F9",
    justifyContent: "center",
    alignItems: "center",
  },
  statLabel: {
    fontSize: 10,
    color: "#94A3B8",
    fontWeight: "500",
    textTransform: "uppercase",
  },
  statValue: {
    fontSize: 13,
    color: "#1E293B",
    fontWeight: "600",
    marginTop: 1,
  },

  // Timeline
  timeline: {
    marginBottom: 12,
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    padding: 12,
  },
  timelineItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  timelineText: {
    fontSize: 13,
    color: "#1E293B",
    fontWeight: "500",
    flex: 1,
  },
  timelineTime: {
    fontSize: 12,
    color: "#64748B",
    fontWeight: "500",
  },

  // Cancellation Reason
  cancellationReason: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#FEF2F2",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FEE2E2",
    gap: 12,
  },
  cancellationContent: {
    flex: 1,
  },
  cancellationLabel: {
    fontSize: 11,
    color: "#EF4444",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  cancellationText: {
    fontSize: 14,
    color: "#1E293B",
    fontWeight: "500",
  },
  incompleteDataContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFBEB",
    padding: 12,
    borderRadius: 10,
    gap: 10,
    borderWidth: 1,
    borderColor: "#FEF3C7",
  },
  incompleteDataText: {
    fontSize: 13,
    color: "#92400E",
    fontWeight: "500",
    flex: 1,
  },
});

export default TripsScreen;
