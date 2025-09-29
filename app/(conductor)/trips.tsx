import { useAppTheme } from "@/contexts/ThemeContext";
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

      // Get current user
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setError("User not authenticated");
        return;
      }

      // Fetch trips for the current driver
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
        //console.error("Error fetching trips:", tripsError);
        setError("Failed to load trips");
        return;
      }

      setTrips((data as any[]) || []);
    } catch (error) {
      //console.error("Unexpected error fetching trips:", error);
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "#4CAF50";
      case "ongoing":
        return "#FF9500";
      case "cancelled":
        return "#FF3B30";
      case "waiting":
        return "#8e8e93";
      default:
        return "#8e8e93";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return "checkmark-circle";
      case "ongoing":
        return "play-circle";
      case "cancelled":
        return "close-circle";
      case "waiting":
        return "time";
      default:
        return "help-circle";
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
    const statusColor = getStatusColor(item.status);
    const statusIcon = getStatusIcon(item.status);

    // Handle undefined values
    if (!item.buses || !item.buses.routes) {
      return (
        <View style={styles.tripCard}>
          <View style={styles.tripHeader}>
            <View style={styles.tripInfo}>
              <Text style={styles.routeName}>Trip #{item.id.slice(-8)}</Text>
              <Text style={styles.busPlate}>Incomplete Data</Text>
            </View>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: `${statusColor}20` },
              ]}
            >
              <Ionicons name={statusIcon} size={16} color={statusColor} />
              <Text style={[styles.statusText, { color: statusColor }]}>
                {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
              </Text>
            </View>
          </View>
          <Text style={styles.incompleteDataText}>
            Some trip data is missing. Please contact support if this persists.
          </Text>
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
            <Text style={styles.busPlate}>{bus.plate_number}</Text>
          </View>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: `${statusColor}20` },
            ]}
          >
            <Ionicons name={statusIcon} size={16} color={statusColor} />
            <Text style={[styles.statusText, { color: statusColor }]}>
              {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
            </Text>
          </View>
        </View>

        {/* Route Details */}
        <View style={styles.routeDetails}>
          <View style={styles.routeItem}>
            <View
              style={[styles.locationMarker, { backgroundColor: "#4CAF50" }]}
            >
              <Ionicons name="location" size={12} color="#fff" />
            </View>
            <Text style={styles.locationText}>{route.start_address}</Text>
          </View>
          <View style={styles.routeItem}>
            <View
              style={[styles.locationMarker, { backgroundColor: "#FF3B30" }]}
            >
              <Ionicons name="location" size={12} color="#fff" />
            </View>
            <Text style={styles.locationText}>{route.end_address}</Text>
          </View>
        </View>

        {/* Trip Stats */}
        <View style={styles.tripStats}>
          <View style={styles.statItem}>
            <Ionicons name="people" size={16} color="#8e8e93" />
            <Text style={styles.statText}>
              {passengerCount}/{bus.capacity}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Ionicons name="calendar" size={16} color="#8e8e93" />
            <Text style={styles.statText}>{formatDate(item.updated_at)}</Text>
          </View>
          {item.started_at && (
            <View style={styles.statItem}>
              <Ionicons name="time" size={16} color="#8e8e93" />
              <Text style={styles.statText}>{formatTime(item.started_at)}</Text>
            </View>
          )}
        </View>

        {/* Trip Timeline */}
        <View style={styles.timeline}>
          <View style={styles.timelineItem}>
            <View
              style={[styles.timelineDot, { backgroundColor: "#4CAF50" }]}
            />
            <Text style={styles.timelineText}>Trip Created</Text>
            <Text style={styles.timelineTime}>
              {formatTime(item.updated_at)}
            </Text>
          </View>

          {item.started_at && (
            <View style={styles.timelineItem}>
              <View
                style={[styles.timelineDot, { backgroundColor: "#FF9500" }]}
              />
              <Text style={styles.timelineText}>Trip Started</Text>
              <Text style={styles.timelineTime}>
                {formatTime(item.started_at)}
              </Text>
            </View>
          )}

          {item.ended_at && (
            <View style={styles.timelineItem}>
              <View
                style={[styles.timelineDot, { backgroundColor: "#4CAF50" }]}
              />
              <Text style={styles.timelineText}>Trip Completed</Text>
              <Text style={styles.timelineTime}>
                {formatTime(item.ended_at)}
              </Text>
            </View>
          )}

          {item.cancelled_at && (
            <View style={styles.timelineItem}>
              <View
                style={[styles.timelineDot, { backgroundColor: "#FF3B30" }]}
              />
              <Text style={styles.timelineText}>Trip Cancelled</Text>
              <Text style={styles.timelineTime}>
                {formatTime(item.cancelled_at)}
              </Text>
            </View>
          )}
        </View>

        {item.cancellation_reason && (
          <View style={styles.cancellationReason}>
            <Text style={styles.cancellationLabel}>Reason:</Text>
            <Text style={styles.cancellationText}>
              {item.cancellation_reason}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Ionicons name="car-outline" size={64} color="#8e8e93" />
      <Text style={styles.emptyTitle}>No Trips Yet</Text>
      <Text style={styles.emptySubtitle}>
        Your trip history will appear here once you start driving
      </Text>
    </View>
  );

  const renderErrorState = () => (
    <View style={styles.errorState}>
      <Ionicons name="alert-circle-outline" size={64} color="#FF3B30" />
      <Text style={styles.errorTitle}>Failed to Load Trips</Text>
      <Text style={styles.errorSubtitle}>{error}</Text>
      <TouchableOpacity style={styles.retryButton} onPress={fetchTrips}>
        <Ionicons name="refresh" size={20} color="#fff" />
        <Text style={styles.retryButtonText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style={theme === "dark" ? "light" : "dark"} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
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
      <StatusBar style={theme === "dark" ? "light" : "dark"} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Ionicons name="car" size={28} color="#ffffff" />
          <Text style={styles.headerTitle}>Trip History</Text>
        </View>
        <Text style={styles.headerSubtitle}>
          {trips.length} {trips.length === 1 ? "trip" : "trips"} completed
        </Text>
      </View>

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
            colors={["#007AFF"]}
            tintColor="#007AFF"
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
    backgroundColor: "#f2f2f7",
  },

  // Header Styles
  header: {
    backgroundColor: "#007AFF",
    paddingTop: 20,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    marginBottom: 20,
    elevation: 4,
    shadowColor: "#007AFF",
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#fff",
    marginLeft: 12,
  },
  headerSubtitle: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.8)",
    fontWeight: "500",
  },

  // Loading and Error States
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    fontSize: 16,
    color: "#8e8e93",
    marginTop: 12,
    fontWeight: "500",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1c1c1e",
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    color: "#8e8e93",
    textAlign: "center",
    lineHeight: 22,
  },
  errorState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1c1c1e",
    marginTop: 16,
    marginBottom: 8,
  },
  errorSubtitle: {
    fontSize: 16,
    color: "#8e8e93",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#007AFF",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },

  // List Styles
  listContainer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },

  // Trip Card Styles
  tripCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
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
    fontSize: 18,
    fontWeight: "bold",
    color: "#1c1c1e",
    marginBottom: 4,
  },
  busPlate: {
    fontSize: 14,
    color: "#8e8e93",
    fontWeight: "500",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 6,
  },

  // Route Details
  routeDetails: {
    marginBottom: 16,
    gap: 8,
  },
  routeItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  locationMarker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  locationText: {
    fontSize: 14,
    color: "#1c1c1e",
    fontWeight: "500",
    flex: 1,
  },

  // Trip Stats
  tripStats: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#f2f2f7",
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  statText: {
    fontSize: 12,
    color: "#8e8e93",
    marginLeft: 6,
    fontWeight: "500",
  },

  // Timeline
  timeline: {
    marginBottom: 12,
  },
  timelineItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 12,
  },
  timelineText: {
    fontSize: 12,
    color: "#1c1c1e",
    fontWeight: "500",
    flex: 1,
  },
  timelineTime: {
    fontSize: 12,
    color: "#8e8e93",
    fontWeight: "500",
  },

  // Cancellation Reason
  cancellationReason: {
    backgroundColor: "#fff5f5",
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#FF3B30",
  },
  cancellationLabel: {
    fontSize: 12,
    color: "#FF3B30",
    fontWeight: "600",
    marginBottom: 4,
  },
  cancellationText: {
    fontSize: 14,
    color: "#1c1c1e",
    fontWeight: "500",
  },
  incompleteDataText: {
    fontSize: 14,
    color: "#FF9500",
    fontWeight: "500",
    textAlign: "center",
    marginTop: 12,
    padding: 12,
    backgroundColor: "#fff8e1",
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#FF9500",
  },
});

export default TripsScreen;