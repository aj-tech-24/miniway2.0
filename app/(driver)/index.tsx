import { mapDarkStyle } from "@/constants/mapDarkStyle";
import { useAppTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
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

// Storage keys
const LAST_SELECTED_ROUTE_KEY = "driver_last_selected_route";
const DRIVER_LOCATION_CACHE_KEY = "driver_location_cache";

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

  // Custom Alert State
  const [showCustomAlert, setShowCustomAlert] = useState(false);
  const [alertConfig, setAlertConfig] = useState({
    title: "",
    message: "",
    type: "info" as "info" | "error" | "warning" | "success",
    onConfirm: () => {},
    confirmText: "OK",
    showCancel: false,
    onCancel: () => {},
    cancelText: "Cancel",
  });

  // Custom Alert Function
  const showAlert = useCallback(
    (
      title: string,
      message: string,
      type: "info" | "error" | "warning" | "success" = "info",
      onConfirm: () => void = () => {},
      confirmText: string = "OK",
      showCancel: boolean = false,
      onCancel: () => void = () => {},
      cancelText: string = "Cancel"
    ) => {
      setAlertConfig({
        title,
        message,
        type,
        onConfirm,
        confirmText,
        showCancel,
        onCancel,
        cancelText,
      });
      setShowCustomAlert(true);
    },
    []
  );

  const hideAlert = useCallback(() => {
    setShowCustomAlert(false);
  }, []);

  // Helper functions for alert styling
  const getAlertColor = (type: string) => {
    switch (type) {
      case "error":
        return "#FF3B30";
      case "warning":
        return "#FF9500";
      case "success":
        return "#34C759";
      default:
        return "#007AFF";
    }
  };

  const getAlertIcon = (type: string) => {
    switch (type) {
      case "error":
        return "close-circle";
      case "warning":
        return "warning";
      case "success":
        return "checkmark-circle";
      default:
        return "information-circle";
    }
  };

  // Save selected route to AsyncStorage
  const saveSelectedRoute = useCallback(async (route: Route) => {
    try {
      await AsyncStorage.setItem(
        LAST_SELECTED_ROUTE_KEY,
        JSON.stringify(route)
      );
    } catch (error) {
      //console.error("Error saving selected route:", error);
    }
  }, []);

  // Load last selected route from AsyncStorage
  const loadLastSelectedRoute = useCallback(async (): Promise<Route | null> => {
    try {
      const savedRoute = await AsyncStorage.getItem(LAST_SELECTED_ROUTE_KEY);
      return savedRoute ? JSON.parse(savedRoute) : null;
    } catch (error) {
      // console.error("Error loading last selected route:", error);
      return null;
    }
  }, []);

  // Cache driver location
  const cacheDriverLocation = useCallback(
    async (location: { latitude: number; longitude: number }) => {
      try {
        const locationData = {
          ...location,
          timestamp: Date.now(),
        };
        await AsyncStorage.setItem(
          DRIVER_LOCATION_CACHE_KEY,
          JSON.stringify(locationData)
        );
      } catch (error) {
        //console.error("Error caching driver location:", error);
      }
    },
    []
  );

  // Get cached driver location
  const getCachedDriverLocation = useCallback(async (): Promise<{
    latitude: number;
    longitude: number;
  } | null> => {
    try {
      const cachedLocation = await AsyncStorage.getItem(
        DRIVER_LOCATION_CACHE_KEY
      );
      if (cachedLocation) {
        const locationData = JSON.parse(cachedLocation);
        // Use cached location if it's less than 5 minutes old
        if (Date.now() - locationData.timestamp < 5 * 60 * 1000) {
          return {
            latitude: locationData.latitude,
            longitude: locationData.longitude,
          };
        }
      }
      return null;
    } catch (error) {
      // console.error("Error getting cached driver location:", error);
      return null;
    }
  }, []);

  // Fetch routes from database
  const fetchRoutes = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("routes")
        .select("id, name, start_address, end_address")
        .order("name", { ascending: true });

      if (error) throw error;
      setAllRoutes(data || []);

      // Try to load last selected route first
      const lastSelectedRoute = await loadLastSelectedRoute();
      if (lastSelectedRoute && data) {
        // Check if the last selected route still exists in the current routes
        const routeExists = data.find(
          (route) => route.id === lastSelectedRoute.id
        );
        if (routeExists) {
          setSelectedRoute(routeExists);
        } else if (data.length > 0) {
          setSelectedRoute(data[0]);
        }
      } else if (data && data.length > 0) {
        setSelectedRoute(data[0]); // Set first route as default
      }
    } catch (error) {
      //console.error("Error fetching routes:", error);
    } finally {
      setLoading(false);
    }
  }, [loadLastSelectedRoute]);

  useEffect(() => {
    fetchRoutes();
    getCurrentLocation();
  }, [fetchRoutes]);

  // Optimized location fetching function
  const getCurrentLocation = useCallback(async () => {
    setLocationLoading(true);
    setLocationError(false);

    try {
      // First, try to get cached location
      const cachedLocation = await getCachedDriverLocation();
      if (cachedLocation) {
        setDriverLocation(cachedLocation);
        setLocationLoading(false);
        //console.log("Using cached location for faster loading");
      }

      // Request permissions
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        //console.error("Permission to access location was denied");
        setLocationError(true);
        // Set a default location if permission denied
        const defaultLocation = {
          latitude: 6.7536,
          longitude: 125.356,
        };
        setDriverLocation(defaultLocation);
        setLocationLoading(false);
        return;
      }

      // Check if we have a recent cached location first
      const lastKnownPosition = await Location.getLastKnownPositionAsync({
        maxAge: 30000, // 30 seconds
        requiredAccuracy: 100, // 100 meters accuracy is acceptable for initial load
      });

      if (lastKnownPosition) {
        const location = {
          latitude: lastKnownPosition.coords.latitude,
          longitude: lastKnownPosition.coords.longitude,
        };
        setDriverLocation(location);
        await cacheDriverLocation(location);
        setLocationLoading(false);
        // console.log("Using last known position for faster loading");
      }

      // Get more accurate current position in background
      const currentPosition = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced, // Balanced accuracy for faster response
      });

      const location = {
        latitude: currentPosition.coords.latitude,
        longitude: currentPosition.coords.longitude,
      };
      setDriverLocation(location);
      await cacheDriverLocation(location);
      setLocationError(false);
      //console.log("Updated with current location");
    } catch (error) {
      //console.error("Error getting location:", error);
      setLocationError(true);
      // Fallback to default location
      const defaultLocation = {
        latitude: 6.7536,
        longitude: 125.356,
      };
      setDriverLocation(defaultLocation);
    } finally {
      setLocationLoading(false);
    }
  }, [getCachedDriverLocation, cacheDriverLocation]);

  const handleRouteSelect = useCallback(
    async (route: Route) => {
      setSelectedRoute(route);
      setShowDropdown(false);
      await saveSelectedRoute(route);
    },
    [saveSelectedRoute]
  );

  const handleStartTrip = async () => {
    if (!selectedRoute) {
      showAlert(
        "Route Required",
        "Please select a route before starting your trip. Choose from the available routes in the dropdown above.",
        "warning"
      );
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
      showAlert(
        "Authentication Required",
        "You need to be logged in to start a trip. Please sign in and try again.",
        "error"
      );
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
      showAlert(
        "Route Data Error",
        "Unable to load route information. Please check your internet connection and try again.",
        "error"
      );
      return;
    }
    const geojson = routeData.geojson;
    const coordinates = geojson.coordinates;
    // console.log(
    //   "DEBUG index.tsx: geojson coordinates length before passing:",
    //   coordinates.length
    // );

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

    // Function to create new trip
    const createNewTrip = async () => {
      if (!driverLocation) {
        setLoading(false);
        showAlert(
          "Location Required",
          "Unable to get your current location. Please ensure location services are enabled and try again.",
          "error"
        );
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
        showAlert(
          "Bus Assignment Error",
          "No bus has been assigned to you yet. Please contact your administrator to get a bus assigned.",
          "error"
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
        showAlert(
          "Trip Creation Failed",
          "Unable to create a new trip. Please try again or contact support if the problem persists.",
          "error"
        );
        // console.log(
        //   "DEBUG index.tsx: Failed to create a new trip error: ",
        //   newTripError
        // );
        return;
      }
      tripId = newTripData.id;
      currentTripLocation = driverLocation;
      // console.log(
      //   "DEBUG index.tsx: New trip created. tripId:",
      //   tripId,
      //   "busId:",
      //   busId
      // ); // Added log

      // Continue with the rest of the trip setup
      continueTripSetup();
    };

    // Function to continue trip setup after trip creation or existing trip found
    const continueTripSetup = async () => {
      // 3. Fetch the bus details using bus_id from the determined trip (either new or existing)
      if (!busId) {
        setLoading(false);
        showAlert(
          "Bus Information Missing",
          "Bus information is not available. Please try again or contact support.",
          "error"
        );
        //console.log("DEBUG index.tsx: busId is not available."); // Added log
        return;
      }

      // console.log(
      //   "DEBUG index.tsx: Final busId before fetching busData:",
      //   busId
      // ); // Added log
      const { data: busData, error: busError } = await supabase
        .from("buses")
        .select("id, capacity, passengers")
        .eq("id", busId)
        .single();
      // console.log(
      //   "DEBUG index.tsx: Result of fetching bus data - data:",
      //   busData,
      //   "error:",
      //   busError
      // ); // Added log

      if (busError || !busData) {
        setLoading(false);
        showAlert(
          "Bus Data Loading Failed",
          "Unable to load bus details. Please check your connection and try again.",
          "error"
        );
        // console.log(
        //   "DEBUG index.tsx: Failed to fetch bus data error inside if block:",
        //   busError,
        //   "busData:",
        //   busData
        // );
        return;
      }

      setLoading(false); // Set loading to false just before navigating
      router.push({
        pathname: "/DrivingModeScreen",
        params: {
          routeName: routeData.name,
          path: JSON.stringify(coordinates),
          capacity: (busData.capacity || 0).toString(),
          passengers: passengersOnTrip.toString(),
          departureTime: "Calculating...", // Will be calculated dynamically in DrivingModeScreen
          busLocation: JSON.stringify(currentTripLocation),
          tripId: tripId,
          busId: busId,
        },
      });
    };

    // Handle existing trip
    if (activeTripData) {
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
        showAlert(
          "Bus Data Error",
          "Unable to load bus information for your active trip. Please try again.",
          "error"
        );
        // console.log(
        //   "DEBUG index.tsx: Failed to fetch bus data for active trip error:",
        //   existingBusError
        // ); // Added log
        return;
      }
      passengersOnTrip = existingBusData.passengers || 0;
      // console.log(
      //   "DEBUG index.tsx: Active trip found. tripId:",
      //   tripId,
      //   "busId:",
      //   busId
      // ); // Added log

      // Continue with trip setup for existing trip
      continueTripSetup();
    }

    // Check if we need to create a new trip
    if (activeTripError || !activeTripData) {
      // No active trip found, create a new one
      showAlert(
        "Creating New Trip",
        "No active trip found. We're creating a new trip for you now.",
        "info",
        () => {
          // Continue with trip creation after user confirms
          createNewTrip();
        },
        "Continue",
        true,
        () => {
          setLoading(false);
        },
        "Cancel"
      );
      return;
    }
  };

  const centerMapOnUser = useCallback(() => {
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
      //console.warn("Driver location not available for centering map.");
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
  }, [driverLocation]);

  const refreshLocation = useCallback(() => {
    getCurrentLocation();
  }, [getCurrentLocation]);

  const zoomIn = useCallback(() => {
    if (mapRef.current) {
      const center = driverLocation || { latitude: 6.7536, longitude: 125.356 };
      mapRef.current.animateCamera(
        {
          center,
          zoom: 15,
        },
        { duration: 500 }
      );
    }
  }, [driverLocation]);

  const zoomOut = useCallback(() => {
    if (mapRef.current) {
      const center = driverLocation || { latitude: 6.7536, longitude: 125.356 };
      mapRef.current.animateCamera(
        {
          center,
          zoom: 10,
        },
        { duration: 500 }
      );
    }
  }, [driverLocation]);

  // Filtered routes based on search - memoized for performance
  const filteredRoutes = useMemo(() => {
    if (!searchTerm.trim()) return allRoutes;
    return allRoutes.filter((route) =>
      route.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [allRoutes, searchTerm]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      {/* Enhanced Header Section */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.headerIconContainer}>
            <Ionicons name="bus" size={28} color="#fff" />
          </View>
          <View style={styles.headerTextContainer}>
            <Text style={styles.title}>Driver Dashboard</Text>
            <Text style={styles.subtitle}>Ready to start your journey</Text>
          </View>
        </View>
      </View>
      <View style={styles.container}>
        <TouchableWithoutFeedback onPress={() => setShowDropdown(false)}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={true}
            scrollEnabled={true}
            nestedScrollEnabled={true}
            keyboardShouldPersistTaps="handled"
            removeClippedSubviews={false}
            onScrollBeginDrag={() => setShowDropdown(false)}
          >
            {/* Enhanced Status Cards */}
            <View style={styles.statusCardsContainer}>
              {/* Driver Status Card */}
              <View style={styles.statusCard}>
                <View style={styles.statusCardHeader}>
                  <Ionicons name="person-circle" size={24} color="#007AFF" />
                  <Text style={styles.statusCardTitle}>Driver Status</Text>
                </View>
                <View style={styles.statusCardContent}>
                  <View style={styles.statusItem}>
                    <Ionicons
                      name="pause-circle-outline"
                      size={20}
                      color="#8e8e93"
                    />
                    <Text style={styles.statusItemText}>Waiting to start</Text>
                  </View>
                  <View style={styles.statusItem}>
                    <Ionicons name="time-outline" size={20} color="#8e8e93" />
                    <Text style={styles.statusItemText}>Ready for trip</Text>
                  </View>
                </View>
              </View>

              {/* GPS Status Card */}
              <View style={styles.statusCard}>
                <View style={styles.statusCardHeader}>
                  <Ionicons name="location" size={24} color="#007AFF" />
                  <Text style={styles.statusCardTitle}>Location Status</Text>
                </View>
                <View style={styles.statusCardContent}>
                  <View style={styles.gpsStatusContainer}>
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
                          style={[
                            styles.gpsDot,
                            locationError && styles.gpsErrorDot,
                          ]}
                        />
                      )}
                      <Text style={styles.gpsText}>
                        {locationLoading
                          ? "Getting Location..."
                          : locationError
                          ? "GPS Error"
                          : "GPS Connected"}
                      </Text>
                    </View>
                  </View>
                  {driverLocation && (
                    <Text style={styles.coordinatesText}>
                      {driverLocation.latitude.toFixed(4)},{" "}
                      {driverLocation.longitude.toFixed(4)}
                    </Text>
                  )}
                </View>
              </View>
            </View>

            {/* Enhanced Map Card */}
            <View style={styles.mapCard}>
              <View style={styles.mapHeader}>
                <View style={styles.mapHeaderLeft}>
                  <Ionicons name="map" size={20} color="#007AFF" />
                  <Text style={styles.mapTitle}>Current Location</Text>
                </View>
                <View style={styles.mapHeaderRight}>
                  <TouchableOpacity
                    style={[
                      styles.mapActionButton,
                      locationLoading && styles.mapActionButtonDisabled,
                    ]}
                    onPress={refreshLocation}
                    disabled={locationLoading}
                  >
                    <Ionicons
                      name="refresh"
                      size={16}
                      color={locationLoading ? "#8e8e93" : "#007AFF"}
                    />
                  </TouchableOpacity>
                </View>
              </View>

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

              {/* Enhanced Map Controls */}
              <View style={styles.mapControls}>
                <View style={styles.zoomControls}>
                  <TouchableOpacity style={styles.zoomButton} onPress={zoomIn}>
                    <Ionicons name="add" size={16} color="#007AFF" />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.zoomButton} onPress={zoomOut}>
                    <Ionicons name="remove" size={16} color="#007AFF" />
                  </TouchableOpacity>
                </View>
                {/* Center Button */}
                <TouchableOpacity
                  style={styles.mapControlButton}
                  onPress={centerMapOnUser}
                >
                  <Ionicons name="locate" size={18} color="#007AFF" />
                </TouchableOpacity>

                {/* Zoom Controls */}
              </View>
            </View>

            {/* Enhanced Route Selection Card */}
            <View style={styles.routeCard}>
              <View style={styles.routeHeader}>
                <View style={styles.routeHeaderLeft}>
                  <Ionicons name="map" size={24} color="#007AFF" />
                  <Text style={styles.routeTitle}>Route Selection</Text>
                </View>
                {selectedRoute && (
                  <View style={styles.routeStatusBadge}>
                    <Ionicons
                      name="checkmark-circle"
                      size={16}
                      color="#4CAF50"
                    />
                    <Text style={styles.routeStatusText}>Selected</Text>
                  </View>
                )}
              </View>

              {/* Enhanced Route Dropdown */}
              <View style={styles.dropdownContainer}>
                <TouchableOpacity
                  style={[
                    styles.dropdownField,
                    selectedRoute && styles.dropdownFieldSelected,
                  ]}
                  onPress={(e) => {
                    e.stopPropagation();
                    setShowDropdown(!showDropdown);
                  }}
                >
                  <View style={styles.dropdownLeft}>
                    <Ionicons
                      name="bus"
                      size={20}
                      color={selectedRoute ? "#007AFF" : "#8e8e93"}
                    />
                    <View style={styles.dropdownTextContainer}>
                      <Text
                        style={[
                          styles.dropdownText,
                          selectedRoute && styles.dropdownTextSelected,
                        ]}
                      >
                        {selectedRoute?.name || "Select a route to begin"}
                      </Text>
                      {selectedRoute && (
                        <Text style={styles.dropdownSubText}>
                          {selectedRoute.start_address} →{" "}
                          {selectedRoute.end_address}
                        </Text>
                      )}
                    </View>
                  </View>
                  <Ionicons
                    name={showDropdown ? "chevron-up" : "chevron-down"}
                    size={20}
                    color="#8e8e93"
                  />
                </TouchableOpacity>
              </View>

              {/* Enhanced Route Display */}
              {selectedRoute && (
                <View style={styles.currentRoute}>
                  <View style={styles.routeItem}>
                    <View style={styles.locationMarker}>
                      <Ionicons name="location" size={16} color="#fff" />
                    </View>
                    <View style={styles.locationTextContainer}>
                      <Text style={styles.locationLabel}>From</Text>
                      <Text style={styles.locationText}>
                        {selectedRoute.start_address || "Start Location"}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.arrowContainer}>
                    <Ionicons name="arrow-down" size={20} color="#8e8e93" />
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
                    <View style={styles.locationTextContainer}>
                      <Text style={styles.locationLabel}>To</Text>
                      <Text style={styles.locationText}>
                        {selectedRoute.end_address || "End Location"}
                      </Text>
                    </View>
                  </View>
                </View>
              )}
            </View>
          </ScrollView>
        </TouchableWithoutFeedback>

        {/* Fixed Start Trip Button - Outside ScrollView */}
        <View style={styles.fixedStartButtonContainer}>
          <TouchableOpacity
            style={[
              styles.startButton,
              !selectedRoute && styles.disabledButton,
              loading && styles.disabledButton,
            ]}
            onPress={handleStartTrip}
            disabled={!selectedRoute || loading}
          >
            <View style={styles.startButtonContent}>
              {loading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <View style={styles.startButtonIcon}>
                  <Ionicons name="play" size={24} color="#FFFFFF" />
                </View>
              )}
              <View style={styles.startButtonTextContainer}>
                <Text style={styles.startButtonText}>
                  {loading ? "Starting Trip..." : "Start New Trip"}
                </Text>
                <Text style={styles.startButtonSubtext}>
                  {!selectedRoute
                    ? "Select a route first"
                    : loading
                    ? "Please wait..."
                    : "Begin your journey"}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Custom Alert Modal */}
      <Modal
        visible={showCustomAlert}
        transparent={true}
        animationType="fade"
        onRequestClose={hideAlert}
      >
        <View style={styles.alertOverlay}>
          <View style={styles.alertContainer}>
            <View style={styles.alertHeader}>
              <View
                style={[
                  styles.alertIconContainer,
                  { backgroundColor: getAlertColor(alertConfig.type) },
                ]}
              >
                <Ionicons
                  name={getAlertIcon(alertConfig.type)}
                  size={24}
                  color="#fff"
                />
              </View>
              <Text style={styles.alertTitle}>{alertConfig.title}</Text>
            </View>

            <Text style={styles.alertMessage}>{alertConfig.message}</Text>

            <View style={styles.alertButtons}>
              {alertConfig.showCancel && (
                <TouchableOpacity
                  style={[styles.alertButton, styles.alertCancelButton]}
                  onPress={() => {
                    alertConfig.onCancel();
                    hideAlert();
                  }}
                >
                  <Text style={styles.alertCancelButtonText}>
                    {alertConfig.cancelText}
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[
                  styles.alertButton,
                  styles.alertConfirmButton,
                  { backgroundColor: getAlertColor(alertConfig.type) },
                ]}
                onPress={() => {
                  alertConfig.onConfirm();
                  hideAlert();
                }}
              >
                <Text style={styles.alertConfirmButtonText}>
                  {alertConfig.confirmText}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
    paddingBottom: 120, // Add more space for fixed button
    flexGrow: 1,
    minHeight: "100%", // Ensure content is at least full height
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
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  headerTextContainer: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.8)",
  },

  // Enhanced Status Cards Styles
  statusCardsContainer: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 20,
    marginTop: 20,
  },
  statusCard: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  statusCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  statusCardTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
    marginLeft: 8,
    flex: 1,
    flexWrap: "wrap",
  },
  statusCardContent: {
    gap: 8,
  },
  statusItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusItemText: {
    fontSize: 12,
    color: "#8e8e93",
    marginLeft: 8,
    flex: 1,
    flexWrap: "wrap",
  },
  gpsStatusContainer: {
    flex: 1,
    minWidth: 0, // Allow shrinking
  },
  coordinatesText: {
    fontSize: 10,
    color: "#8e8e93",
    fontFamily: "monospace",
    marginTop: 4,
    flexWrap: "wrap",
  },
  gpsIndicator: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#34C759",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    flex: 1,
    minWidth: 0, // Allow shrinking
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

  // Enhanced Map Card Styles
  mapCard: {
    height: 240,
    borderRadius: 20,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
    overflow: "hidden",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#f0f0f0",
  },
  mapHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: "linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e7",
  },
  mapHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  mapTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1c1c1e",
    marginLeft: 10,
  },
  mapHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  mapActionButton: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
    borderColor: "#e5e5e7",
  },
  mapActionButtonDisabled: {
    backgroundColor: "#f2f2f7",
  },
  map: {
    flex: 1,
  },
  mapControls: {
    position: "absolute",
    top: 80,
    right: 20,
    flexDirection: "column",
    gap: 10,
  },
  mapControlButton: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
    alignItems: "center",
    justifyContent: "center",
    width: 48,
    height: 48,
    borderWidth: 1,
    borderColor: "#e5e5e7",
  },
  zoomControls: {
    flexDirection: "column",
    gap: 4,
  },
  zoomButton: {
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    borderWidth: 1,
    borderColor: "#e5e5e7",
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

  // Enhanced Route Card Styles
  routeCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 30,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    overflow: "visible",
    position: "relative",
  },
  routeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  routeHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  routeTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#007AFF",
    marginLeft: 8,
  },
  routeStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E8F5E8",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  routeStatusText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#4CAF50",
    marginLeft: 4,
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
  dropdownFieldSelected: {
    backgroundColor: "#E3F2FD",
    borderColor: "#007AFF",
  },
  dropdownLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  dropdownTextContainer: {
    flex: 1,
    marginLeft: 8,
  },
  dropdownText: {
    fontSize: 16,
    color: "#1c1c1e",
    flexWrap: "wrap",
  },
  dropdownTextSelected: {
    color: "#007AFF",
    fontWeight: "600",
  },
  dropdownSubText: {
    fontSize: 12,
    color: "#8e8e93",
    marginTop: 2,
    flexWrap: "wrap",
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
    backgroundColor: "#f8f9fa",
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  routeItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  locationMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#4CAF50",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  locationTextContainer: {
    flex: 1,
  },
  locationLabel: {
    fontSize: 12,
    color: "#8e8e93",
    fontWeight: "500",
    marginBottom: 2,
  },
  locationText: {
    fontSize: 14,
    color: "#1c1c1e",
    fontWeight: "600",
    flexWrap: "wrap",
  },
  arrowContainer: {
    alignItems: "center",
    marginVertical: 4,
  },

  // Fixed Start Button Styles
  fixedStartButtonContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#f2f2f7",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: "#e5e5e7",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 1000,
    pointerEvents: "box-none", // Allow touch events to pass through to ScrollView
  },
  startButton: {
    backgroundColor: "#007AFF",
    borderRadius: 16,
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    width: "100%",
    pointerEvents: "auto", // Ensure button can receive touch events
  },
  startButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 20,
    paddingHorizontal: 20,
  },
  startButtonIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  startButtonTextContainer: {
    flex: 1,
  },
  startButtonText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 4,
    flexWrap: "wrap",
  },
  startButtonSubtext: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.8)",
    flexWrap: "wrap",
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

  // Custom Alert Styles
  alertOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  alertContainer: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  alertHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  alertIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  alertTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1c1c1e",
    flex: 1,
  },
  alertMessage: {
    fontSize: 16,
    color: "#8e8e93",
    lineHeight: 22,
    marginBottom: 24,
  },
  alertButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  alertButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    minWidth: 80,
    alignItems: "center",
  },
  alertCancelButton: {
    backgroundColor: "#f2f2f7",
  },
  alertCancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#8e8e93",
  },
  alertConfirmButton: {
    // backgroundColor will be set dynamically
  },
  alertConfirmButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
  },
});

export default DriverScreen;
