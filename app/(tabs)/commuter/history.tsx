import { useAuth } from "@/contexts/AuthContext"; // Assuming you have an Auth context
import { useAppTheme } from "@/contexts/ThemeContext";
import { useThemeColor } from "@/hooks/useThemeColor";
import { supabase } from "@/lib/supabase"; // Adjust if needed
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
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
  routes:
    | {
        name: string;
      }[]
    | null; // Changed to an array
};

export function TravelHistoryScreen() {
  const { session } = useAuth(); // Get the current user session
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const { theme } = useAppTheme();
  // Function to fetch travel history from the database
  const fetchHistory = async () => {
    if (!session?.user) return;

    try {
      // Call the new SQL function directly
      const { data, error } = await supabase.rpc("get_user_travel_history");

      if (error) {
        throw error;
      }

      // The data from an RPC call needs to be mapped slightly differently
      const formattedHistory = data.map((item: any) => ({
        id: item.id,
        start_location_name: item.start_location_name,
        end_location_name: item.end_location_name,
        travel_date: item.travel_date,
        // The route object is now flat
        routes: item.route_name ? [{ name: item.route_name }] : null,
      }));
      setHistory(formattedHistory);
    } catch (error) {
      console.error("Error fetching travel history:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };
  useEffect(() => {
    fetchHistory();
  }, [session]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchHistory();
  }, [session]);

  // Render a single history card
  const renderHistoryCard = ({ item }: { item: HistoryItem }) => {
    // --- FIX 2: Access the first element of the 'routes' array ---
    // Use optional chaining (?.) for safety in case routes is null or empty
    const routeName = item.routes?.[0]?.name || "Unknown Route";

    return (
      <View style={[styles.card, { backgroundColor }]}>
        <View style={styles.cardHeader}>
          <Ionicons name="location-outline" size={24} color="#007AFF" />
          <Text style={styles.cardTitle}>{routeName}</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.locationText}>
            From: {item.start_location_name || "N/A"}
          </Text>
          <Text style={styles.locationText}>
            To: {item.end_location_name || "N/A"}
          </Text>
        </View>
        <View style={styles.cardFooter}>
          <Ionicons name="calendar-outline" size={16} color="#8e8e93" />
          <Text style={styles.dateText}>
            {new Date(item.travel_date).toLocaleString()}
          </Text>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor }]}
      edges={["top", "left", "right"]}
    >
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      <FlatList
        data={history}
        renderItem={renderHistoryCard}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={{ paddingHorizontal: 20 }}
        ListHeaderComponent={<Text style={styles.title}>Travel History</Text>}
        ListEmptyComponent={
          <View style={styles.centered}>
            <Ionicons name="trail-sign-outline" size={60} color="#d1d1d6" />
            <Text style={styles.emptyText}>No trips yet</Text>
            <Text style={styles.emptySubtitle}>
              Your completed trips will appear here.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    marginTop: "40%",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#1c1c1e",
    paddingVertical: 20,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e5e5ea",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginLeft: 12,
    color: "#1c1c1e",
  },
  cardBody: {
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5ea",
  },
  locationText: {
    fontSize: 16,
    color: "#3c3c43",
    marginBottom: 8,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 12,
  },
  dateText: {
    fontSize: 14,
    color: "#8e8e93",
    marginLeft: 8,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: "600",
    color: "#8e8e93",
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 16,
    color: "#c7c7cc",
    marginTop: 8,
    textAlign: "center",
  },
});

export default TravelHistoryScreen;
