import { useAppTheme } from "@/contexts/ThemeContext";
import { useThemeColor } from "@/hooks/useThemeColor";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
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
  View,
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

  const { theme } = useAppTheme();
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const primaryColor = useThemeColor({}, "tint");
  const placeholderTextColor = useThemeColor({}, "placeholderTextColor");
  const separatorColor = useThemeColor({}, "separatorColor");

  const fetchRoutes = async () => {
    try {
      // Fetch the new columns as well
      const { data, error } = await supabase
        .from("routes")
        .select("id, name, start_address, end_address")
        .order("name", { ascending: true });

      if (error) throw error;
      setAllRoutes(data || []);
    } catch (error) {
      console.error("Error fetching routes:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchRoutes();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchRoutes();
  }, []);

  // Filter routes based on the search query
  const filteredRoutes = useMemo(() => {
    if (!searchQuery) return allRoutes;
    return allRoutes.filter((route) =>
      route.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [allRoutes, searchQuery]);

  // A redesigned, more informative route card component
  const renderRouteCard = ({ item }: { item: Route }) => (
    <TouchableOpacity
      style={[styles.card, { backgroundColor, borderColor: separatorColor }]}
      onPress={() =>
        router.push({
          pathname: "/route-details",
          params: { routeId: item.id },
        })
      }
    >
      <View style={[styles.cardHeader, { borderBottomColor: separatorColor }]}>
        <Ionicons name="bus-outline" size={24} color={primaryColor} />
        <Text style={[styles.cardTitle, { color: textColor }]}>
          {item.name}
        </Text>
      </View>
      <View style={styles.cardBody}>
        <View style={styles.addressLine}>
          <Text style={[styles.addressLabel, { color: placeholderTextColor }]}>
            FROM:
          </Text>
          <Text style={[styles.addressText, { color: textColor }]}>
            {item.start_address || "N/A"}
          </Text>
        </View>
        <View style={styles.addressLine}>
          <Text style={[styles.addressLabel, { color: placeholderTextColor }]}>
            TO:
          </Text>
          <Text style={[styles.addressText, { color: textColor }]}>
            {item.end_address || "N/A"}
          </Text>
        </View>
      </View>
      <View style={[styles.cardFooter, { borderTopColor: separatorColor }]}>
        <Text style={[styles.footerText, { color: primaryColor }]}>
          View Details
        </Text>
        <Ionicons name="arrow-forward" size={16} color={primaryColor} />
      </View>
    </TouchableOpacity>
  );

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
        data={filteredRoutes}
        renderItem={renderRouteCard}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={{ paddingHorizontal: 20 }}
        ListHeaderComponent={
          <>
            <Text style={[styles.title, { color: textColor }]}>
              Explore Routes
            </Text>
            <View
              style={[
                styles.searchContainer,
                { borderColor: separatorColor, backgroundColor },
              ]}
            >
              <Ionicons name="search" size={20} color={placeholderTextColor} />
              <TextInput
                style={[styles.searchInput, { color: textColor }]}
                placeholder="Search by route name..."
                placeholderTextColor={placeholderTextColor}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={[styles.emptyText, { color: placeholderTextColor }]}>
              No routes match your search.
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
    backgroundColor: "#f2f2f7",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 50,
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#1c1c1e",
    paddingVertical: 20,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 15,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#e5e5ea",
  },
  searchInput: {
    flex: 1,
    height: 44,
    fontSize: 17,
    marginLeft: 10,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
    borderWidth: 1,
    borderColor: "#e5e5ea",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5ea",
    paddingBottom: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginLeft: 12,
    color: "#1c1c1e",
  },
  cardBody: {
    paddingVertical: 15,
  },
  addressLine: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  addressLabel: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#8e8e93",
    width: 50,
  },
  addressText: {
    fontSize: 16,
    color: "#3c3c43",
    flex: 1,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#e5e5ea",
  },
  footerText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#007AFF",
    marginRight: 5,
  },
  emptyText: {
    fontSize: 16,
    color: "#8e8e93",
  },
});

export default RouteScreen;
