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
  const [error, setError] = useState<string | null>(null);

  const { theme } = useAppTheme();
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const primaryColor = useThemeColor({}, "tint");
  const placeholderTextColor = useThemeColor({}, "placeholderTextColor");
  const separatorColor = useThemeColor({}, "separatorColor");

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

  const renderRouteCard = ({ item }: { item: Route }) => (
    <TouchableOpacity
      style={[styles.routeCard, { backgroundColor }]}
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
          <View
            style={[
              styles.routeIconContainer,
              { backgroundColor: "rgba(0, 122, 255, 0.1)" },
            ]}
          >
            <Ionicons name="bus" size={20} color={primaryColor} />
          </View>
          <View style={styles.routeDetails}>
            <Text
              style={[styles.routeName, { color: textColor }]}
              numberOfLines={1}
            >
              {item.name}
            </Text>
            <Text
              style={[styles.routeSubtitle, { color: placeholderTextColor }]}
            >
              Bus Route
            </Text>
          </View>
        </View>
        <View style={[styles.selectButton, { backgroundColor: primaryColor }]}>
          <Ionicons name="arrow-forward" size={16} color="#fff" />
        </View>
      </View>

      {/* Route Details */}
      <View style={styles.routeDetailsContainer}>
        <View style={styles.locationRow}>
          <View style={[styles.locationDot, { backgroundColor: "#34C759" }]} />
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
              {item.start_address || "Starting point not specified"}
            </Text>
          </View>
        </View>

        <View style={styles.connectionLine} />

        <View style={styles.locationRow}>
          <View style={[styles.locationDot, { backgroundColor: "#FF3B30" }]} />
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
              {item.end_address || "Destination not specified"}
            </Text>
          </View>
        </View>
      </View>

      {/* Card Footer */}
      <View style={[styles.cardFooter, { borderTopColor: separatorColor }]}>
        <View style={styles.footerLeft}>
          <Ionicons
            name="information-circle-outline"
            size={16}
            color={placeholderTextColor}
          />
          <Text style={[styles.footerText, { color: placeholderTextColor }]}>
            Tap to view buses and schedule
          </Text>
        </View>
        <View style={styles.footerRight}>
          <Ionicons name="chevron-forward" size={16} color={primaryColor} />
        </View>
      </View>
    </TouchableOpacity>
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
            Loading available routes...
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
            onPress={fetchRoutes}
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
            <Ionicons name="map-outline" size={28} color="#007AFF" />
          </View>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Explore Routes</Text>
            <Text style={styles.headerSubtitle}>
              {refreshing ? "Refreshing..." : "Find your perfect bus route"}
            </Text>
          </View>
        </View>
      </View>

      <FlatList
        data={filteredRoutes}
        renderItem={renderRouteCard}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={["#007AFF"]}
            tintColor="#007AFF"
            title="Pull to refresh routes"
            titleColor="#8e8e93"
            progressBackgroundColor="#ffffff"
          />
        }
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.searchSection}>
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
              {searchQuery.length > 0 && (
                <TouchableOpacity
                  onPress={() => setSearchQuery("")}
                  style={styles.clearButton}
                >
                  <Ionicons
                    name="close-circle"
                    size={20}
                    color={placeholderTextColor}
                  />
                </TouchableOpacity>
              )}
            </View>
            {filteredRoutes.length > 0 && (
              <Text
                style={[styles.resultsCount, { color: placeholderTextColor }]}
              >
                {filteredRoutes.length} route
                {filteredRoutes.length !== 1 ? "s" : ""} found
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="bus-outline" size={80} color="#d1d1d6" />
            <Text style={[styles.emptyTitle, { color: textColor }]}>
              {searchQuery ? "No routes found" : "No routes available"}
            </Text>
            <Text
              style={[styles.emptySubtitle, { color: placeholderTextColor }]}
            >
              {searchQuery
                ? `No routes match "${searchQuery}". Try a different search term.`
                : "There are currently no bus routes available."}
            </Text>
            {searchQuery && (
              <TouchableOpacity
                style={[
                  styles.clearSearchButton,
                  { backgroundColor: primaryColor },
                ]}
                onPress={() => setSearchQuery("")}
              >
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text style={styles.clearSearchButtonText}>Clear Search</Text>
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
  searchSection: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    marginLeft: 12,
    marginRight: 8,
  },
  clearButton: {
    padding: 4,
  },
  resultsCount: {
    fontSize: 14,
    fontWeight: "500",
    marginTop: 8,
    textAlign: "center",
  },
  routeCard: {
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
  selectButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  routeDetailsContainer: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
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
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 20,
  },
  connectionLine: {
    width: 2,
    height: 16,
    backgroundColor: "#E5E5E7",
    marginLeft: 3,
    marginBottom: 12,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderTopWidth: 1,
    backgroundColor: "rgba(0, 0, 0, 0.02)",
  },
  footerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  footerRight: {
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
  clearSearchButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 16,
  },
  clearSearchButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 6,
  },
});

export default RouteScreen;
