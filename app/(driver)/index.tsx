import { mapDarkStyle } from "@/constants/mapDarkStyle";
import { useAppTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location"; // Import expo-location
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MapView from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";

// Route type definition
type Route = {
  id: string;
  name: string;
  start_address: string | null;
  end_address: string | null;
};

interface RouteGeoJSONResponse {
  id: string;
  name: string;
  start_address: string | null;
  end_address: string | null;
  geojson: {
    coordinates: any[]; // Adjust this type more specifically if you know the exact structure
    // ... other geojson properties if any
  };
}
interface ActiveTripResponse {
  id: string;
  bus_id: string;
  current_location: {
    coordinates: [number, number];
    type: "Point";
    crs: { type: "name"; properties: { name: "urn:ogc:def:crs:EPSG::4326" } }; // Example CRS, adjust if needed
  } | null;
}

const DriverScreen = () => {
  const { theme } = useAppTheme();
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const [allRoutes, setAllRoutes] = useState<Route[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [driverLocation, setDriverLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [locationLoading, setLocationLoading] = useState(true);
  const [locationError, setLocationError] = useState(false);

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
    getCurrentLocation();
  }, []);

  // Optimized location fetching function
  const getCurrentLocation = async () => {
    setLocationLoading(true);
    setLocationError(false);

    try {
      // Request permissions
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        console.error("Permission to access location was denied");
        setLocationError(true);
        // Set a default location if permission denied
        setDriverLocation({
          latitude: 6.7536,
          longitude: 125.356,
        });
        setLocationLoading(false);
        return;
      }

      // Check if we have a recent cached location first
      const lastKnownPosition = await Location.getLastKnownPositionAsync({
        maxAge: 30000, // 30 seconds
        requiredAccuracy: 100, // 100 meters accuracy is acceptable for initial load
      });

      if (lastKnownPosition) {
        setDriverLocation({
          latitude: lastKnownPosition.coords.latitude,
          longitude: lastKnownPosition.coords.longitude,
        });
        setLocationLoading(false);
        console.log("Using cached location for faster loading");
      }

      // Get more accurate current position in background
      const currentPosition = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced, // Balanced accuracy for faster response
      });

      setDriverLocation({
        latitude: currentPosition.coords.latitude,
        longitude: currentPosition.coords.longitude,
      });
      setLocationError(false);
      console.log("Updated with current location");
    } catch (error) {
      console.error("Error getting location:", error);
      setLocationError(true);
      // Fallback to default location
      setDriverLocation({
        latitude: 6.7536,
        longitude: 125.356,
      });
    } finally {
      setLocationLoading(false);
    }
  };

  const handleRouteSelect = (route: Route) => {
    setSelectedRoute(route);
    setShowDropdown(false);
  };

  const handleStartTrip = async () => {
    if (!selectedRoute) {
      alert("Please select a route first");
      return;
    }
    setLoading(true);

    // Get current user ID
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    const currentUserId = user?.id;
    if (!currentUserId) {
      setLoading(false);
      alert("User not logged in");
      return;
    }
    // 1. Fetch route details
    const { data: routeData, error: routeError } = await supabase
      .rpc("get_route_geojson", {
        route_id: selectedRoute.id,
      })
      .single<RouteGeoJSONResponse>();
    if (routeError || !routeData) {
      setLoading(false);
      alert(
        "Failed to fetch route data: " + (routeError?.message || "No data")
      );
      return;
    }
    const geojson = routeData.geojson;
    const coordinates = geojson.coordinates;
    console.log(
      "DEBUG index.tsx: geojson coordinates length before passing:",
      coordinates.length
    );

    // 2. Fetch the active trip for this driver and route using RPC
    let tripId: string | undefined;
    let busId: string | undefined;
    let currentTripLocation = { latitude: 0, longitude: 0 };
    let passengersOnTrip = 0;

    const { data: activeTripData, error: activeTripError } = await supabase
      .rpc("get_active_driver_trip", {
        p_driver_id: currentUserId,
      })
      .single<ActiveTripResponse>();

    if (activeTripError || !activeTripData) {
      // No active trip found, create a new one
      alert("No active trip found for this driver. Creating a new trip.");

      if (!driverLocation) {
        setLoading(false);
        alert("Unable to get driver's current location to start a new trip.");
        return;
      }

      // Fetch the bus assigned to this driver
      const { data: driverBusData, error: driverBusError } = await supabase
        .from("buses")
        .select("id, capacity, passengers")
        .eq("driver_id", currentUserId)
        .single();

      if (driverBusError || !driverBusData) {
        setLoading(false);
        alert(
          "Failed to find an assigned bus for the driver: " +
            (driverBusError?.message || "No data")
        );
        return;
      }
      busId = driverBusData.id;
      passengersOnTrip = driverBusData.passengers || 0;

      const { data: newTripData, error: newTripError } = await supabase
        .from("trips")
        .insert({
          driver_id: currentUserId,
          bus_id: busId,
          status: "waiting", // Set initial status to 'waiting'
          current_location: `POINT(${driverLocation.longitude} ${driverLocation.latitude})`,
        })
        .select("id")
        .single();

      if (!newTripError && newTripData) {
        // Set bus status to active
        await supabase
          .from("buses")
          .update({ status: "active" })
          .eq("id", busId);
      }

      if (newTripError || !newTripData) {
        setLoading(false);
        alert(
          "Failed to create a new trip: " + (newTripError?.message || "No data")
        );
        console.log(
          "DEBUG index.tsx: Failed to create a new trip error: ",
          newTripError
        );
        return;
      }
      tripId = newTripData.id;
      currentTripLocation = driverLocation;
      console.log(
        "DEBUG index.tsx: New trip created. tripId:",
        tripId,
        "busId:",
        busId
      ); // Added log
    } else {
      // Active trip found, use its data
      tripId = activeTripData.id;
      busId = activeTripData.bus_id;
      if (
        activeTripData.current_location &&
        activeTripData.current_location.coordinates
      ) {
        const [lng, lat] = activeTripData.current_location.coordinates;
        currentTripLocation = { latitude: lat, longitude: lng };
      } else if (driverLocation) {
        currentTripLocation = driverLocation;
      }

      const { data: existingBusData, error: existingBusError } = await supabase
        .from("buses")
        .select("passengers")
        .eq("id", busId)
        .single();

      if (existingBusError || !existingBusData) {
        setLoading(false);
        alert(
          "Failed to fetch bus data for active trip: " +
            (existingBusError?.message || "No data")
        );
        console.log(
          "DEBUG index.tsx: Failed to fetch bus data for active trip error:",
          existingBusError
        ); // Added log
        return;
      }
      passengersOnTrip = existingBusData.passengers || 0;
      console.log(
        "DEBUG index.tsx: Active trip found. tripId:",
        tripId,
        "busId:",
        busId
      ); // Added log
    }

    // 3. Fetch the bus details using bus_id from the determined trip (either new or existing)
    if (!busId) {
      setLoading(false);
      alert("Bus ID not available.");
      console.log("DEBUG index.tsx: busId is not available."); // Added log
      return;
    }

    console.log("DEBUG index.tsx: Final busId before fetching busData:", busId); // Added log
    const { data: busData, error: busError } = await supabase
      .from("buses")
      .select("id, capacity, passengers")
      .eq("id", busId)
      .single();
    console.log(
      "DEBUG index.tsx: Result of fetching bus data - data:",
      busData,
      "error:",
      busError
    ); // Added log

    if (busError || !busData) {
      setLoading(false);
      alert("Failed to fetch bus data: " + (busError?.message || "No data"));
      console.log(
        "DEBUG index.tsx: Failed to fetch bus data error inside if block:",
        busError,
        "busData:",
        busData
      );
      return;
    }

    setLoading(false); // Set loading to false just before navigating
    // console.log(
    //   "DEBUG index.tsx: Navigating to DrivingModeScreen with params:",
    //   {
    //     // Added log
    //     routeName: routeData.name,
    //     path: "JSON_STRINGIFIED_COORDINATES", // Log as string to avoid very long output
    //     capacity: (busData.capacity || 0).toString(),
    //     passengers: passengersOnTrip.toString(),
    //     departureTime: new Date().toLocaleTimeString(),
    //     busLocation: JSON.stringify(currentTripLocation),
    //     tripId: tripId,
    //     busId: busId,
    //   }
    // );

    router.push({
      pathname: "/DrivingModeScreen",
      params: {
        routeName: routeData.name,
        path: JSON.stringify(coordinates),
        capacity: (busData.capacity || 0).toString(),
        passengers: passengersOnTrip.toString(),
        departureTime: new Date().toLocaleTimeString(),
        busLocation: JSON.stringify(currentTripLocation),
        tripId: tripId,
        busId: busId,
      },
    });
  };

  const centerMapOnUser = () => {
    if (mapRef.current && driverLocation) {
      mapRef.current.animateToRegion(
        {
          latitude: driverLocation.latitude,
          longitude: driverLocation.longitude,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        },
        1000
      );
    } else if (mapRef.current) {
      console.warn("Driver location not available for centering map.");
      mapRef.current.animateToRegion(
        {
          latitude: 6.7536,
          longitude: 125.356,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        },
        1000
      );
    }
  };

  const refreshLocation = () => {
    getCurrentLocation();
  };

  const zoomIn = () => {
    if (mapRef.current) {
      mapRef.current.animateCamera(
        {
          center: {
            latitude: 6.7536,
            longitude: 125.356,
          },
          zoom: 15,
        },
        { duration: 500 }
      );
    }
  };

  const zoomOut = () => {
    if (mapRef.current) {
      mapRef.current.animateCamera(
        {
          center: {
            latitude: 6.7536,
            longitude: 125.356,
          },
          zoom: 10,
        },
        { duration: 500 }
      );
    }
  };

  // Filtered routes based on search
  const filteredRoutes = allRoutes.filter((route) =>
    route.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
            <View
              style={[
                styles.gpsIndicator,
                locationError && styles.gpsErrorIndicator,
                locationLoading && styles.gpsLoadingIndicator,
              ]}
            >
              {locationLoading ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <View
                  style={[styles.gpsDot, locationError && styles.gpsErrorDot]}
                />
              )}
              <Text style={styles.gpsText}>
                {locationLoading
                  ? "Getting Location..."
                  : locationError
                  ? "GPS Error"
                  : "GPS OK"}
              </Text>
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
            ></MapView>

            {/* Center Button */}
            <TouchableOpacity
              style={styles.centerButton}
              onPress={centerMapOnUser}
            >
              <Ionicons name="locate" size={18} color="#007AFF" />
            </TouchableOpacity>

            {/* Refresh Location Button */}
            <TouchableOpacity
              style={[
                styles.refreshButton,
                locationLoading && styles.refreshButtonLoading,
              ]}
              onPress={refreshLocation}
              disabled={locationLoading}
            >
              <Ionicons
                name="refresh"
                size={18}
                color={locationLoading ? "#8e8e93" : "#007AFF"}
              />
            </TouchableOpacity>

            {/* Zoom Controls */}
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
                  <View
                    style={[
                      styles.locationMarker,
                      { backgroundColor: "#FF3B30" },
                    ]}
                  >
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
              !selectedRoute && styles.disabledButton,
              loading && styles.disabledButton, // Disable and style differently when loading
            ]}
            onPress={handleStartTrip}
            disabled={!selectedRoute || loading} // Disable when no route is selected or when loading
          >
            {loading ? ( // Show ActivityIndicator when loading
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="play" size={24} color="#FFFFFF" />
            )}
            <Text style={styles.startButtonText}>
              {loading ? "Starting Trip..." : "Start New Trip"}
              {/* Change text when loading */}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </TouchableOpacity>
      {/* Dropdown Overlay at Root Level */}
      {showDropdown && (
        <TouchableOpacity
          style={styles.dropdownBackdrop}
          activeOpacity={1}
          onPress={() => setShowDropdown(false)}
        >
          <View style={styles.dropdownListOverlayCentered}>
            <TextInput
              style={styles.dropdownSearch}
              placeholder="Search route..."
              value={searchTerm}
              onChangeText={setSearchTerm}
              autoFocus
            />
            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color="#007AFF" />
                <Text style={styles.loadingText}>Loading routes...</Text>
              </View>
            ) : filteredRoutes.length === 0 ? (
              <View style={styles.loadingContainer}>
                <Text style={styles.loadingText}>No routes found.</Text>
              </View>
            ) : (
              <ScrollView
                style={styles.dropdownScrollView}
                showsVerticalScrollIndicator={true}
                nestedScrollEnabled={true}
              >
                {filteredRoutes.map((route) => (
                  <TouchableOpacity
                    key={route.id}
                    style={[
                      styles.dropdownItem,
                      selectedRoute?.id === route.id &&
                        styles.selectedDropdownItem,
                    ]}
                    onPress={(e) => {
                      e.stopPropagation();
                      handleRouteSelect(route);
                      setSearchTerm(""); // Clear search on select
                      setShowDropdown(false); // Close dropdown
                    }}
                  >
                    <Text
                      style={[
                        styles.dropdownItemText,
                        selectedRoute?.id === route.id &&
                          styles.selectedDropdownItemText,
                      ]}
                    >
                      {route.name}
                    </Text>
                    <Text style={styles.dropdownItemSubText}>
                      {route.start_address} → {route.end_address}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </TouchableOpacity>
      )}
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
  gpsLoadingIndicator: {
    backgroundColor: "#FF9500",
  },
  gpsErrorIndicator: {
    backgroundColor: "#FF3B30",
  },
  gpsDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#ffffff",
    marginRight: 6,
  },
  gpsErrorDot: {
    backgroundColor: "#ffffff",
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
  refreshButton: {
    position: "absolute",
    top: 70,
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
  refreshButtonLoading: {
    backgroundColor: "#f2f2f7",
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
    position: "relative", // <-- Add this!
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
    position: "relative", // <-- Add this!
    zIndex: 10, // <-- Add this!
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
  dropdownSearch: {
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5ea",
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    marginBottom: 4,
  },
  dropdownItemSubText: {
    fontSize: 12,
    color: "#8e8e93",
    marginTop: 2,
    marginLeft: 2,
  },
  dropdownListOverlay: {
    position: "absolute",
    top: 52, // Adjust this value to match the height of your dropdownField
    left: 0,
    right: 0,
    backgroundColor: "#ffffff",
    borderRadius: 8,
    marginTop: 4,
    maxHeight: 250,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 10,
    borderWidth: 1,
    borderColor: "#e5e5ea",
    zIndex: 1000,
  },
  dropdownBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.2)", // semi-transparent background
    justifyContent: "center",
    alignItems: "center",
    zIndex: 2000,
  },
  dropdownListOverlayCentered: {
    width: "85%",
    maxWidth: 400,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    maxHeight: 350,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 20,
    borderWidth: 1,
    borderColor: "#e5e5ea",
    zIndex: 2001,
  },
  loadingModalBackdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)", // Semi-transparent black background
  },
  loadingModalContainer: {
    backgroundColor: "#fff",
    padding: 20,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  loadingModalText: {
    marginLeft: 10,
    fontSize: 16,
    fontWeight: "500",
    color: "#333",
  },
});

export default DriverScreen;
