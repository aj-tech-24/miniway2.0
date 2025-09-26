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
  route_name: string | null;
  status?: string; // 'completed' | 'cancelled' | other
};

export function TravelHistoryScreen() {
  const { session } = useAuth(); // Get the current user session
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const primaryColor = useThemeColor({}, "tint");
  const placeholderTextColor = useThemeColor({}, "placeholderTextColor");
  const separatorColor = useThemeColor({}, "separatorColor");
  const { theme } = useAppTheme();

  const fetchHistory = useCallback(async () => {
    if (!session?.user) return;

    try {
      // Read directly from the table you're inserting into
      const { data, error } = await supabase
        .from("travel_history_commuter") // or "travel_history" if you used that name
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

  // Render a single history card
  // Render a single history card
  const renderHistoryCard = ({ item }: { item: HistoryItem }) => {
    const routeName = item.route_name || "Unknown Route";

    const getStatusStyle = (status?: string) => {
      const s = (status || "").toLowerCase();
      if (s === "completed") {
        return {
          container: [
            styles.statusPill,
            { backgroundColor: "rgba(40,167,69,0.12)" },
          ],
          text: [styles.statusText, { color: "#28a745" }],
          label: "Completed",
        };
      }
      if (s === "cancelled") {
        return {
          container: [
            styles.statusPill,
            { backgroundColor: "rgba(220,53,69,0.12)" },
          ],
          text: [styles.statusText, { color: "#dc3545" }],
          label: "Cancelled",
        };
      }
      return {
        container: [
          styles.statusPill,
          { backgroundColor: "rgba(0,122,255,0.12)" },
        ],
        text: [styles.statusText, { color: "#007AFF" }],
        label: s ? s.charAt(0).toUpperCase() + s.slice(1) : "Completed",
      };
    };
    const statusStyle = getStatusStyle(item.status);

    return (
      <View
        style={[styles.card, { backgroundColor, borderColor: separatorColor }]}
      >
        <View
          style={[styles.cardHeader, { borderBottomColor: separatorColor }]}
        >
          <Ionicons name="location-outline" size={24} color={primaryColor} />
          <Text style={[styles.cardTitle, { color: textColor }]}>
            {routeName}
          </Text>
          <View style={{ flex: 1 }} />
          <View style={statusStyle.container}>
            <Text style={statusStyle.text}>{statusStyle.label}</Text>
          </View>
        </View>
        <View style={styles.cardBody}>
          <Text style={[styles.locationText, { color: textColor }]}>
            From:{" "}
            <Text style={{ color: placeholderTextColor }}>
              {item.start_location_name || "N/A"}
            </Text>
          </Text>
          <Text style={[styles.locationText, { color: textColor }]}>
            To:{" "}
            <Text style={{ color: placeholderTextColor }}>
              {item.end_location_name || "N/A"}
            </Text>
          </Text>
        </View>
        <View style={styles.cardFooter}>
          <Ionicons
            name="calendar-outline"
            size={16}
            color={placeholderTextColor}
          />
          <Text style={[styles.dateText, { color: placeholderTextColor }]}>
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
        ListHeaderComponent={
          <Text style={[styles.title, { color: textColor }]}>
            Travel History
          </Text>
        }
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
  button: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 24,
    alignItems: "center",
    marginHorizontal: 4,
  },
  editButton: { backgroundColor: "#007AFF" },
  signOutButton: { backgroundColor: "#dc3545" },
  saveButton: { backgroundColor: "#28a745" },
  cancelButton: { backgroundColor: "#6c757d" },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
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
  statusPill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "700",
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
