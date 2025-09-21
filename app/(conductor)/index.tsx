import { mapDarkStyle } from "@/constants/mapDarkStyle";
import { useAppTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";

type Route = {
  id: string;
  name: string;
  start_address: string | null;
  end_address: string | null;
};

const ConductorScreen = () => {
  const { theme } = useAppTheme();
  const router = useRouter();
  const mapRef = useRef<MapView | null>(null);
  const [allRoutes, setAllRoutes] = useState<Route[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchRoutes = async () => {
    try {
      const { data, error } = await supabase
        .from("routes")
        .select("id, name, start_address, end_address")
        .order("name", { ascending: true });

      if (error) throw error;
      setAllRoutes(data || []);
      if (data && data.length > 0) {
        setSelectedRoute(data[0]);
      }
    } catch (error) {
      console.error("Error fetching routes:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoutes();
  }, []);

  const handleRouteSelect = (route: Route) => {
    setSelectedRoute(route);
    setShowDropdown(false);
  };

  const handleStartTrip = () => {
    if (!selectedRoute) {
      alert("Please select a route first");
      return;
    }
    router.push({
      pathname: "/gps-tracking",
      params: {
        routeId: selectedRoute.id,
        routeName: selectedRoute.name,
        startAddress: selectedRoute.start_address || "",
        endAddress: selectedRoute.end_address || "",
      }
    });
  };

  const centerMapOnUser = () => {
    if (mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: 6.7536,
        longitude: 125.356,
        latitudeDelta: 0.0922,
        longitudeDelta: 0.0421,
      }, 1000);
    }
  };

  const zoomIn = () => {
    if (mapRef.current) {
      mapRef.current.animateCamera({
        center: { latitude: 6.7536, longitude: 125.356 },
        zoom: 15,
      }, { duration: 500 });
    }
  };

  const zoomOut = () => {
    if (mapRef.current) {
      mapRef.current.animateCamera({
        center: { latitude: 6.7536, longitude: 125.356 },
        zoom: 10,
      }, { duration: 500 });
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      <TouchableOpacity 
        style={styles.container} 
        activeOpacity={1} 
        onPress={() => setShowDropdown(false)}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
        
          {/* Header Section */}
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <Ionicons name="bus" size={32} color="#007AFF" />
              <Text style={styles.title}>Conductor Dashboard</Text>
            </View>
          </View>

          {/* Status Bar */}
          <View style={styles.statusBar}>
            <View style={styles.statusLeft}>
              <Ionicons name="cash-outline" size={24} color="#8e8e93" />
              <Text style={styles.statusText}>Ready to assist</Text>
            </View>
            <View style={styles.gpsIndicator}>
              <View style={styles.gpsDot} />
              <Text style={styles.gpsText}>Online</Text>
            </View>
          </View>

          {/* Map Card */}
          <View style={styles.mapCard}>
            <MapView
              ref={mapRef}
              style={styles.map}
              provider="google"
              customMapStyle={theme === "dark" ? [...mapDarkStyle] : []}
              initialRegion={{
                latitude: 6.7536,
                longitude: 125.356,
                latitudeDelta: 0.0922,
                longitudeDelta: 0.0421,
              }}
              showsUserLocation
              showsMyLocationButton={false}
            >
              <Marker coordinate={{ latitude: 6.7600, longitude: 125.3600 }} title="Hospital">
                <View style={styles.hospitalMarker}>
                  <Ionicons name="medical" size={20} color="#FF3B30" />
                </View>
              </Marker>

              <Marker coordinate={{ latitude: 6.7450, longitude: 125.3500 }} title="Hotel">
                <View style={styles.hotelMarker}>
                  <Ionicons name="bed" size={20} color="#AF52DE" />
                </View>
              </Marker>

              <Marker coordinate={{ latitude: 6.7650, longitude: 125.3650 }} title="Shopping Center">
                <View style={styles.shoppingMarker}>
                  <Ionicons name="cart" size={20} color="#007AFF" />
                </View>
              </Marker>
            </MapView>

            <TouchableOpacity style={styles.centerButton} onPress={centerMapOnUser}>
              <Ionicons name="locate" size={18} color="#007AFF" />
            </TouchableOpacity>

            <View style={styles.zoomControls}>
              <TouchableOpacity style={styles.zoomButton} onPress={zoomIn}>
                <Ionicons name="add" size={16} color="#007AFF" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.zoomButton} onPress={zoomOut}>
                <Ionicons name="remove" size={16} color="#007AFF" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Assigned Route Card */}
          <View style={styles.routeCard}>
            <View style={styles.routeHeader}>
              <Ionicons name="map" size={24} color="#007AFF" />
              <Text style={styles.routeTitle}>Assigned Route</Text>
            </View>

            {/* Route Selector */}
            <TouchableOpacity
              style={styles.routeSelector}
              onPress={() => setShowDropdown(!showDropdown)}
            >
              <Ionicons name="bus" size={18} color="#666" />
              <Text style={styles.routeSelectorText}>
                {selectedRoute
                  ? `${selectedRoute.start_address} → ${selectedRoute.end_address}`
                  : "Select a route"}
              </Text>
              <Ionicons
                name={showDropdown ? "chevron-up" : "chevron-down"}
                size={18}
                color="#666"
              />
            </TouchableOpacity>

            {/* Dropdown Options */}
            {showDropdown && (
              <View style={styles.dropdown}>
                {allRoutes.map((route) => (
                  <TouchableOpacity
                    key={route.id}
                    style={styles.dropdownItem}
                    onPress={() => handleRouteSelect(route)}
                  >
                    <Text style={styles.dropdownText}>
                      {route.start_address} → {route.end_address}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Route Row (From → To) */}
            {selectedRoute && (
              <View style={styles.routeRow}>
                <View style={styles.routePoint}>
                  <Ionicons name="ellipse" size={14} color="blue" />
                  <Text style={styles.pointText}>{selectedRoute.start_address}</Text>
                </View>
                <Ionicons name="arrow-forward" size={16} color="#666" />
                <View style={styles.routePoint}>
                  <Ionicons name="location" size={16} color="red" />
                  <Text style={styles.pointText}>{selectedRoute.end_address}</Text>
                </View>
              </View>
            )}
          </View>

          {/* Start Trip Button */}
          <TouchableOpacity
            style={[styles.startButton, !selectedRoute && styles.disabledButton]}
            onPress={handleStartTrip}
            disabled={!selectedRoute}
          >
            <Ionicons name="play" size={24} color="#FFFFFF" />
            <Text style={styles.startButtonText}>Assist Trip</Text>
          </TouchableOpacity>

        </ScrollView>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f2f2f7" },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 20 },
  header: { paddingTop: 20, paddingBottom: 16 },
  headerContent: { flexDirection: "row", alignItems: "center" },
  title: { fontSize: 28, fontWeight: "bold", color: "#007AFF", marginLeft: 12 },
  statusBar: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: "#ffffff", paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: 12, marginBottom: 20, shadowColor: "#000",
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  statusLeft: { flexDirection: "row", alignItems: "center" },
  statusText: { fontSize: 16, color: "#8e8e93", marginLeft: 8 },
  gpsIndicator: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#34C759",
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
  },
  gpsDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff", marginRight: 6 },
  gpsText: { fontSize: 12, color: "#fff", fontWeight: "600" },
  mapCard: { height: 200, borderRadius: 16, marginBottom: 20, overflow: "hidden" },
  map: { flex: 1 },
  centerButton: {
    position: "absolute", top: 16, right: 16,
    backgroundColor: "#ffffff", borderRadius: 24, padding: 12,
  },
  zoomControls: { position: "absolute", top: 16, left: 16 },
  zoomButton: {
    backgroundColor: "#ffffff", borderRadius: 20, padding: 10, marginBottom: 8,
    alignItems: "center", justifyContent: "center", width: 40, height: 40,
  },
  hospitalMarker: { backgroundColor: "#fff", padding: 8, borderRadius: 20 },
  hotelMarker: { backgroundColor: "#fff", padding: 8, borderRadius: 20 },
  shoppingMarker: { backgroundColor: "#fff", padding: 8, borderRadius: 20 },
  routeCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 20 },
  routeHeader: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  routeTitle: { fontSize: 18, fontWeight: "600", color: "#007AFF", marginLeft: 8 },
  routeSelector: {
    flexDirection: "row", alignItems: "center",
    padding: 12, backgroundColor: "#F1F1F1", borderRadius: 8, marginBottom: 12,
  },
  routeSelectorText: { flex: 1, marginLeft: 8, fontSize: 14, color: "#333" },
  dropdown: {
    backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: "#ddd",
    marginBottom: 12,
  },
  dropdownItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: "#eee" },
  dropdownText: { fontSize: 14, color: "#333" },
  routeRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  routePoint: { flexDirection: "row", alignItems: "center" },
  pointText: { marginLeft: 6, fontSize: 14, color: "#333" },
  startButton: {
    backgroundColor: "#007AFF",
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    paddingVertical: 16, borderRadius: 12,
  },
  startButtonText: { fontSize: 18, fontWeight: "600", color: "#fff", marginLeft: 8 },
  disabledButton: { backgroundColor: "#8e8e93" },
});

export default ConductorScreen;
