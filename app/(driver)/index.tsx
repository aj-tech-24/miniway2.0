import { mapDarkStyle } from "@/constants/mapDarkStyle";
import { useAppTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";

// Route type definition
type Route = {
  id: string;
  name: string;
  start_address: string | null;
  end_address: string | null;
};

const DriverScreen = () => {
  const { theme } = useAppTheme();
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const [allRoutes, setAllRoutes] = useState<Route[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(true);

  // Fetch routes from database
  const fetchRoutes = async () => {
    try {
      const { data, error } = await supabase
        .from("routes")
        .select("id, name, start_address, end_address")
        .order("name", { ascending: true });

      if (error) throw error;
      setAllRoutes(data || []);
      if (data && data.length > 0) {
        setSelectedRoute(data[0]); // Set first route as default
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
    router.push("/(driver)/gps-tracking");
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
        center: {
          latitude: 6.7536,
          longitude: 125.356,
        },
        zoom: 15,
      }, { duration: 500 });
    }
  };

  const zoomOut = () => {
    if (mapRef.current) {
      mapRef.current.animateCamera({
        center: {
          latitude: 6.7536,
          longitude: 125.356,
        },
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
            <Text style={styles.title}>Driver Dashboard</Text>
          </View>
        </View>

        {/* Status Bar */}
        <View style={styles.statusBar}>
          <View style={styles.statusLeft}>
            <Ionicons name="pause-circle-outline" size={24} color="#8e8e93" />
            <Text style={styles.statusText}>Waiting to start</Text>
          </View>
          <View style={styles.gpsIndicator}>
            <View style={styles.gpsDot} />
            <Text style={styles.gpsText}>GPS OK</Text>
          </View>
        </View>

        {/* Map Card */}
        <View style={styles.mapCard}>
          <MapView
            ref={(ref) => (mapRef.current = ref)}
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
            {/* Hospital Marker */}
            <Marker
              coordinate={{ latitude: 6.7600, longitude: 125.3600 }}
              title="Hospital"
            >
              <View style={styles.hospitalMarker}>
                <Ionicons name="medical" size={20} color="#FF3B30" />
              </View>
            </Marker>
            
            {/* Hotel Marker */}
            <Marker
              coordinate={{ latitude: 6.7450, longitude: 125.3500 }}
              title="Hotel"
            >
              <View style={styles.hotelMarker}>
                <Ionicons name="bed" size={20} color="#AF52DE" />
              </View>
            </Marker>
            
            {/* Shopping Center Marker */}
            <Marker
              coordinate={{ latitude: 6.7650, longitude: 125.3650 }}
              title="Shopping Center"
            >
              <View style={styles.shoppingMarker}>
                <Ionicons name="cart" size={20} color="#007AFF" />
              </View>
            </Marker>
          </MapView>
          
          {/* Center Button */}
          <TouchableOpacity 
            style={styles.centerButton}
            onPress={centerMapOnUser}
          >
            <Ionicons name="locate" size={18} color="#007AFF" />
          </TouchableOpacity>
          
          {/* Zoom Controls */}
          <View style={styles.zoomControls}>
            <TouchableOpacity 
              style={styles.zoomButton}
              onPress={zoomIn}
            >
              <Ionicons name="add" size={16} color="#007AFF" />
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.zoomButton}
              onPress={zoomOut}
            >
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
          
          {/* Route Dropdown */}
          <View style={styles.dropdownContainer}>
            <TouchableOpacity 
              style={styles.dropdownField}
              onPress={(e) => {
                e.stopPropagation();
                setShowDropdown(!showDropdown);
              }}
            >
              <Ionicons name="bus" size={20} color="#8e8e93" />
              <Text style={styles.dropdownText}>
                Select Route: {selectedRoute?.name || "Loading..."}
              </Text>
              <Ionicons 
                name={showDropdown ? "chevron-up" : "chevron-down"} 
                size={20} 
                color="#8e8e93" 
              />
            </TouchableOpacity>
            
            {/* Inline Dropdown List */}
            {showDropdown && (
              <View style={styles.dropdownList}>
                {loading ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="small" color="#007AFF" />
                    <Text style={styles.loadingText}>Loading routes...</Text>
                  </View>
                ) : (
                  <ScrollView 
                    style={styles.dropdownScrollView}
                    showsVerticalScrollIndicator={true}
                    nestedScrollEnabled={true}
                  >
                    {allRoutes.map((route) => (
                      <TouchableOpacity
                        key={route.id}
                        style={[
                          styles.dropdownItem,
                          selectedRoute?.id === route.id && styles.selectedDropdownItem
                        ]}
                        onPress={(e) => {
                          e.stopPropagation();
                          handleRouteSelect(route);
                        }}
                      >
                        <Text style={[
                          styles.dropdownItemText,
                          selectedRoute?.id === route.id && styles.selectedDropdownItemText
                        ]}>
                          {route.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>
            )}
          </View>

          {/* Current Route Display */}
          {selectedRoute && (
            <View style={styles.currentRoute}>
              <View style={styles.routeItem}>
                <View style={styles.locationMarker}>
                  <Ionicons name="location" size={16} color="#007AFF" />
                </View>
                <Text style={styles.locationText}>
                  {selectedRoute.start_address || "Start Location"}
                </Text>
              </View>
              
              <View style={styles.arrowContainer}>
                <Ionicons name="arrow-forward" size={20} color="#8e8e93" />
              </View>
              
              <View style={styles.routeItem}>
                <View style={[styles.locationMarker, { backgroundColor: "#FF3B30" }]}>
                  <Ionicons name="location" size={16} color="#FFFFFF" />
                </View>
                <Text style={styles.locationText}>
                  {selectedRoute.end_address || "End Location"}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Start Trip Button */}
        <TouchableOpacity 
          style={[
            styles.startButton,
            !selectedRoute && styles.disabledButton
          ]}
          onPress={handleStartTrip}
          disabled={!selectedRoute}
        >
          <Ionicons name="play" size={24} color="#FFFFFF" />
          <Text style={styles.startButtonText}>Start New Trip</Text>
        </TouchableOpacity>

        </ScrollView>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f2f2f7",
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  
  // Header Styles
  header: {
    paddingTop: 20,
    paddingBottom: 16,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#007AFF",
    marginLeft: 12,
  },

  // Status Bar Styles
  statusBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#ffffff",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statusLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusText: {
    fontSize: 16,
    color: "#8e8e93",
    marginLeft: 8,
  },
  gpsIndicator: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#34C759",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  gpsDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#ffffff",
    marginRight: 6,
  },
  gpsText: {
    fontSize: 12,
    color: "#ffffff",
    fontWeight: "600",
  },

  // Map Card Styles
  mapCard: {
    height: 200,
    borderRadius: 16,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    overflow: "hidden",
  },
  map: {
    flex: 1,
  },
  centerButton: {
    position: "absolute",
    top: 16,
    right: 16,
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  zoomControls: {
    position: "absolute",
    top: 16,
    left: 16,
    flexDirection: "column",
  },
  zoomButton: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 10,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
  },
  hospitalMarker: {
    backgroundColor: "#ffffff",
    padding: 8,
    borderRadius: 20,
    shadowColor: "#FF3B30",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  hotelMarker: {
    backgroundColor: "#ffffff",
    padding: 8,
    borderRadius: 20,
    shadowColor: "#AF52DE",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  shoppingMarker: {
    backgroundColor: "#ffffff",
    padding: 8,
    borderRadius: 20,
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },

  // Route Card Styles
  routeCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    overflow: "visible",
  },
  routeHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  routeTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#007AFF",
    marginLeft: 8,
  },
  dropdownContainer: {
    marginBottom: 16,
    position: "relative",
    zIndex: 1000,
  },
  dropdownField: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f2f2f7",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e5ea",
  },
  dropdownText: {
    flex: 1,
    fontSize: 16,
    color: "#1c1c1e",
    marginLeft: 8,
  },
  dropdownList: {
    backgroundColor: "#ffffff",
    borderRadius: 8,
    marginTop: 4,
    maxHeight: 250,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
    borderWidth: 1,
    borderColor: "#e5e5ea",
  },
  dropdownItem: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f2f2f7",
    minHeight: 48,
    justifyContent: "center",
  },
  selectedDropdownItem: {
    backgroundColor: "#f8f9fa",
  },
  dropdownItemText: {
    fontSize: 16,
    color: "#1c1c1e",
    fontWeight: "500",
  },
  selectedDropdownItemText: {
    color: "#007AFF",
    fontWeight: "600",
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 20,
  },
  loadingText: {
    marginLeft: 8,
    fontSize: 16,
    color: "#8e8e93",
  },
  dropdownScrollView: {
    maxHeight: 200,
  },
  currentRoute: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8f9fa",
    padding: 12,
    borderRadius: 8,
  },
  routeItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  locationMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#007AFF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  locationText: {
    fontSize: 14,
    color: "#1c1c1e",
    fontWeight: "500",
    flex: 1,
  },
  arrowContainer: {
    marginHorizontal: 8,
  },

  // Start Button Styles
  startButton: {
    backgroundColor: "#007AFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: 12,
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  startButtonText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#ffffff",
    marginLeft: 8,
  },
  disabledButton: {
    backgroundColor: "#8e8e93",
    shadowColor: "#8e8e93",
    shadowOpacity: 0.2,
  },
});

export default DriverScreen;
