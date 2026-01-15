import { mapDarkStyle } from "@/constants/mapDarkStyle";
import { useAppTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "expo-av";
import { LinearGradient } from "expo-linear-gradient";
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

// Tap sound effect helper
const playTapSound = async () => {
  try {
    const { sound } = await Audio.Sound.createAsync(
      require("@/assets/sounds/success.mp3"),
      { shouldPlay: true, volume: .3 }
    );
    sound.setOnPlaybackStatusUpdate(async (status) => {
      if (status.isLoaded && status.didJustFinish) {
        await sound.unloadAsync();
      }
    });
  } catch (error) {
    // Silently fail if sound can't play
  }
};

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
    onConfirm: () => { },
    confirmText: "OK",
    showCancel: false,
    onCancel: () => { },
    cancelText: "Cancel",
  });

  // Custom Alert Function
  const showAlert = useCallback(
    (
      title: string,
      message: string,
      type: "info" | "error" | "warning" | "success" = "info",
      onConfirm: () => void = () => { },
      confirmText: string = "OK",
      showCancel: boolean = false,
      onCancel: () => void = () => { },
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

  // Auto-detect an existing active trip on mount and resume it automatically
  useEffect(() => {
    let mounted = true;
    const checkActiveTrip = async () => {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();
        if (userError || !user) return;

        // Look for trips in 'waiting' or 'ongoing' for this driver
        const { data: existingTrips, error: existingTripsError } = await supabase
          .from("trips")
          .select("id, bus_id, status, current_location")
          .eq("driver_id", user.id)
          .in("status", ["waiting", "ongoing"])
          .order("started_at", { ascending: false })
          .limit(1);

        if (existingTripsError || !existingTrips || existingTrips.length === 0) return;

        const activeTrip = existingTrips[0];

        // Determine current trip location
        let currentTripLocation = { latitude: 0, longitude: 0 };
        if (activeTrip.current_location && (activeTrip.current_location as any).coordinates) {
          const [lng, lat] = (activeTrip.current_location as any).coordinates;
          currentTripLocation = { latitude: lat, longitude: lng };
        } else {
          // Fallback to cached or live driver location
          const cached = await getCachedDriverLocation();
          if (cached) currentTripLocation = cached;
          else if (driverLocation) currentTripLocation = driverLocation;
          else {
            try {
              const pos = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
              });
              currentTripLocation = {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
              };
            } catch (e) {
              // ignore
            }
          }
        }

        // Fetch bus data to find route id and passenger count
        const { data: busData, error: busError } = await supabase
          .from("buses")
          .select("id, capacity, passengers, route_id")
          .eq("id", activeTrip.bus_id)
          .single();
        if (busError || !busData) return;

        // Try to fetch route geojson using route_id from bus
        let coordinates: any[] = [];
        let routeName = "";
        if (busData.route_id) {
          const { data: routeData, error: routeError } = await supabase
            .rpc("get_route_geojson", { route_id: busData.route_id })
            .single<RouteGeoJSONResponse>();
          if (!routeError && routeData) {
            coordinates = routeData.geojson?.coordinates || [];
            routeName = routeData.name || "";
          }
        }

        // If we have coordinates, navigate to DrivingModeScreen with trip context
        if (mounted) {
          router.push({
            pathname: "/DrivingModeScreen",
            params: {
              routeName: routeName || selectedRoute?.name || "",
              path: JSON.stringify(coordinates),
              capacity: String(busData.capacity || 0),
              passengers: String(busData.passengers || 0),
              departureTime: "Resuming trip",
              busLocation: JSON.stringify(currentTripLocation),
              tripId: activeTrip.id,
              busId: busData.id,
              routeId: busData.route_id || selectedRoute?.id,
            },
          });
        }
      } catch (err) {
        // ignore errors silently - do not block UI
      }
    };

    checkActiveTrip();

    return () => {
      mounted = false;
    };
  }, [getCachedDriverLocation, driverLocation, router, selectedRoute]);

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

      // Update the route_id in the buses table for the current driver
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        showAlert(
          "Authentication Error",
          "Unable to update the route. Please log in again.",
          "error"
        );
        return;
      }

      const { error: updateError } = await supabase
        .from("buses")
        .update({ route_id: route.id })
        .eq("driver_id", user.id);

      if (updateError) {
        showAlert(
          "Update Failed",
          "Failed to update the route for your bus. Please try again.",
          "error"
        );
      } else {
        showAlert(
          "Route Updated",
          "The route for your bus has been successfully updated.",
          "success"
        );
      }
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

    // 2. Check for existing trips (including waiting status) for this driver
    let tripId: string | undefined;
    let busId: string | undefined;
    let currentTripLocation = { latitude: 0, longitude: 0 };
    let passengersOnTrip = 0;

    // First, let's check ALL trips for this driver to see what's in the database
    const { data: allTrips, error: allTripsError } = await supabase
      .from("trips")
      .select("id, bus_id, status, current_location, started_at")
      .eq("driver_id", currentUserId)
      .order("started_at", { ascending: false })
      .limit(10);

    console.log("🔍 DEBUG: All trips for driver");
    console.log("All trips query result:", allTrips);
    console.log("All trips query error:", allTripsError);
    if (allTrips && allTrips.length > 0) {
      console.log("📊 All trips found:");
      allTrips.forEach((trip, index) => {
        console.log(`  Trip ${index + 1}:`, {
          id: trip.id,
          bus_id: trip.bus_id,
          status: trip.status,
          started_at: trip.started_at,
          has_location: !!trip.current_location,
        });
      });
    } else {
      console.log("❌ No trips found for this driver at all");
    }

    // Now, try to get any existing trip for this driver (including waiting status)
    const { data: existingTrips, error: existingTripsError } = await supabase
      .from("trips")
      .select("id, bus_id, status, current_location")
      .eq("driver_id", currentUserId)
      .in("status", ["waiting", "ongoing"])
      .order("started_at", { ascending: false })
      .limit(1);

    // Debug logging
    console.log("🔍 DEBUG: Trip Detection Results");
    console.log("Driver ID:", currentUserId);
    console.log("Existing trips query result:", existingTrips);
    console.log("Query error:", existingTripsError);
    console.log("Number of trips found:", existingTrips?.length || 0);

    if (existingTrips && existingTrips.length > 0) {
      console.log("✅ Found existing trip(s):");
      existingTrips.forEach((trip, index) => {
        console.log(`  Trip ${index + 1}:`, {
          id: trip.id,
          bus_id: trip.bus_id,
          status: trip.status,
          has_location: !!trip.current_location,
        });
      });
    } else {
      console.log("❌ No existing trips found");
    }

    const activeTripData =
      existingTrips && existingTrips.length > 0 ? existingTrips[0] : null;
    const activeTripError = existingTripsError;

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
          routeId: selectedRoute.id, // Explicitly pass routeId for broadcasting context setup
        },
      });
    };

    // Helper function to continue with existing trip
    const continueWithExistingTrip = async (tripData: any) => {
      if (tripData?.current_location && tripData.current_location.coordinates) {
        const [lng, lat] = tripData.current_location.coordinates;
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
          "Unable to load bus information for your existing trip. Please try again.",
          "error"
        );
        return;
      }
      passengersOnTrip = existingBusData.passengers || 0;

      // Continue with trip setup for existing trip
      continueTripSetup();
    };

    // Handle existing trip
    if (activeTripData) {
      console.log("🎯 DEBUG: Using existing trip");
      console.log("Trip ID:", activeTripData.id);
      console.log("Bus ID:", activeTripData.bus_id);
      console.log("Status:", activeTripData.status);

      // Existing trip found, use its data
      tripId = activeTripData.id;
      busId = activeTripData.bus_id;

      // Show appropriate message based on trip status
      if (activeTripData.status === "waiting") {
        console.log(
          "📋 DEBUG: Showing 'Resuming Trip' alert for waiting status"
        );
        showAlert(
          "Resuming Trip",
          `You have an existing trip with "waiting" status. Continuing with that trip.`,
          "info",
          async () => {
            // Continue with existing trip setup
            await continueWithExistingTrip(activeTripData);
          },
          "Continue"
        );
      } else {
        console.log("🚀 DEBUG: Continuing directly with ongoing trip");
        // Trip is ongoing, continue directly
        await continueWithExistingTrip(activeTripData);
      }
      return;
    }

    // Check if we need to create a new trip
    if (activeTripError || !activeTripData) {
      console.log("🆕 DEBUG: No existing trip found, creating new one");
      console.log("Active trip error:", activeTripError);
      console.log("Active trip data:", activeTripData);

      // No existing trip found, create a new one
      showAlert(
        "Creating New Trip",
        "No existing trip found. We're creating a new trip for you now.",
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
      {/* Premium Header Section */}
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
            <Ionicons name="bus" size={26} color="#fff" />
          </View>
          <View style={styles.headerTextContainer}>
            <Text style={styles.title}>Driver Dashboard</Text>
            <Text style={styles.subtitle}>Ready to start your journey</Text>
          </View>
          <View style={styles.headerBadge}>
            <Ionicons name="shield-checkmark" size={14} color="#fff" />
            <Text style={styles.headerBadgeText}>Verified</Text>
          </View>
        </View>
      </LinearGradient>
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
            {/* Premium Status Cards */}
            <View style={styles.statusCardsContainer}>
              {/* Driver Status Card */}
              <View style={styles.statusCard}>
                <View style={styles.statusCardHeader}>
                  <LinearGradient
                    colors={["#8B5CF6", "#7C3AED"]}
                    style={styles.statusCardIconBg}
                  >
                    <Ionicons name="person-circle" size={18} color="#fff" />
                  </LinearGradient>
                  <Text style={styles.statusCardTitle}>Driver Status</Text>
                </View>
                <View style={styles.statusCardContent}>
                  <View style={styles.statusItem}>
                    <View style={[styles.statusDotSmall, { backgroundColor: "#F59E0B" }]} />
                    <Text style={styles.statusItemText}>Waiting to start</Text>
                  </View>
                  <View style={styles.statusItem}>
                    <View style={[styles.statusDotSmall, { backgroundColor: "#10B981" }]} />
                    <Text style={styles.statusItemText}>Ready for trip</Text>
                  </View>
                </View>
              </View>

              {/* GPS Status Card */}
              <View style={styles.statusCard}>
                <View style={styles.statusCardHeader}>
                  <LinearGradient
                    colors={["#0891B2", "#06B6D4"]}
                    style={styles.statusCardIconBg}
                  >
                    <Ionicons name="location" size={18} color="#fff" />
                  </LinearGradient>
                  <Text style={styles.statusCardTitle}>GPS Status</Text>
                </View>
                <View style={styles.statusCardContent}>
                  <View style={styles.gpsStatusContainer}>
                    <LinearGradient
                      colors={
                        locationLoading
                          ? ["#F59E0B", "#D97706"]
                          : locationError
                            ? ["#EF4444", "#DC2626"]
                            : ["#10B981", "#059669"]
                      }
                      style={styles.gpsIndicator}
                    >
                      {locationLoading ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <View style={styles.gpsDot} />
                      )}
                      <Text style={styles.gpsText}>
                        {locationLoading
                          ? "Getting..."
                          : locationError
                            ? "Error"
                            : "Connected"}
                      </Text>
                    </LinearGradient>
                  </View>
                  {driverLocation && (
                    <Text style={styles.coordinatesText}>
                      {driverLocation.latitude.toFixed(4)},
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
                    onPress={() => {
                      refreshLocation();
                    }}
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
                  <TouchableOpacity style={styles.zoomButton} onPress={() => { zoomIn(); }}>
                    <Ionicons name="add" size={16} color="#007AFF" />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.zoomButton} onPress={() => { zoomOut(); }}>
                    <Ionicons name="remove" size={16} color="#007AFF" />
                  </TouchableOpacity>
                </View>
                {/* Center Button */}
                <TouchableOpacity
                  style={styles.mapControlButton}
                  onPress={() => { centerMapOnUser(); }}
                >
                  <Ionicons name="locate" size={18} color="#007AFF" />
                </TouchableOpacity>

                {/* Zoom Controls */}
              </View>
            </View>

            {/* Enhanced Route Selection Card */}
            <View style={styles.routeCard}>
              {/* Premium Header */}
              <LinearGradient
                colors={["#0891B2", "#06B6D4"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.routeCardHeader}
              >
                <View style={styles.routeCardHeaderContent}>
                  <View style={styles.routeCardIconBg}>
                    <Ionicons name="map" size={20} color="#0891B2" />
                  </View>
                  <Text style={styles.routeCardTitle}>Route Selection</Text>
                </View>
                {selectedRoute && (
                  <View style={styles.routeSelectedBadge}>
                    <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                    <Text style={styles.routeSelectedText}>Ready</Text>
                  </View>
                )}
              </LinearGradient>

              <View style={styles.routeCardBody}>
                {/* Enhanced Route Dropdown */}
                <View style={styles.dropdownContainer}>
                  <Text style={styles.dropdownLabel}>SELECT YOUR ROUTE</Text>
                  <TouchableOpacity
                    style={[
                      styles.dropdownField,
                      selectedRoute && styles.dropdownFieldSelected,
                    ]}
                    onPress={(e) => {
                      playTapSound();
                      e.stopPropagation();
                      setShowDropdown(!showDropdown);
                    }}
                  >
                    <View style={styles.dropdownLeft}>
                      <LinearGradient
                        colors={selectedRoute ? ["#0891B2", "#06B6D4"] : ["#94A3B8", "#64748B"]}
                        style={styles.dropdownIconBg}
                      >
                        <Ionicons name="bus" size={16} color="#fff" />
                      </LinearGradient>
                      <View style={styles.dropdownTextContainer}>
                        <Text
                          style={[
                            styles.dropdownText,
                            selectedRoute && styles.dropdownTextSelected,
                          ]}
                        >
                          {selectedRoute?.name || "Tap to select a route"}
                        </Text>
                        {selectedRoute && (
                          <Text style={styles.dropdownSubText}>
                            {selectedRoute.start_address} → {selectedRoute.end_address}
                          </Text>
                        )}
                      </View>
                    </View>
                    <View style={styles.dropdownChevronBg}>
                      <Ionicons
                        name={showDropdown ? "chevron-up" : "chevron-down"}
                        size={16}
                        color="#64748B"
                      />
                    </View>
                  </TouchableOpacity>
                </View>

                {/* Enhanced Route Display */}
                {selectedRoute && (
                  <View style={styles.currentRoute}>
                    <View style={styles.routeVisualization}>
                      <View style={styles.routeItem}>
                        <LinearGradient
                          colors={["#10B981", "#059669"]}
                          style={styles.locationMarkerGradient}
                        >
                          <Ionicons name="radio-button-on" size={12} color="#fff" />
                        </LinearGradient>
                        <View style={styles.locationTextContainer}>
                          <Text style={styles.locationLabel}>ORIGIN</Text>
                          <Text style={styles.locationText}>
                            {selectedRoute.start_address || "Start Location"}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.routeConnectorContainer}>
                        <View style={styles.routeConnectorLine} />
                        <View style={styles.routeConnectorDots}>
                          <View style={styles.connectorDot} />
                          <View style={styles.connectorDot} />
                          <View style={styles.connectorDot} />
                        </View>
                        <View style={styles.routeConnectorLine} />
                      </View>

                      <View style={styles.routeItem}>
                        <LinearGradient
                          colors={["#EF4444", "#DC2626"]}
                          style={styles.locationMarkerGradient}
                        >
                          <Ionicons name="location" size={12} color="#fff" />
                        </LinearGradient>
                        <View style={styles.locationTextContainer}>
                          <Text style={styles.locationLabel}>DESTINATION</Text>
                          <Text style={styles.locationText}>
                            {selectedRoute.end_address || "End Location"}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>
                )}

                {/* Empty State */}
                {!selectedRoute && (
                  <View style={styles.routeEmptyState}>
                    <Ionicons name="navigate-circle-outline" size={40} color="#CBD5E1" />
                    <Text style={styles.routeEmptyText}>
                      Select a route above to see details
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </ScrollView>
        </TouchableWithoutFeedback>

        {/* Premium Start Trip Button */}
        <View style={styles.fixedStartButtonContainer}>
          <TouchableOpacity
            onPress={() => { playTapSound(); handleStartTrip(); }}
            disabled={!selectedRoute || loading}
            activeOpacity={0.9}
            style={styles.startButtonWrapper}
          >
            <LinearGradient
              colors={
                !selectedRoute || loading
                  ? ["#94A3B8", "#64748B"]
                  : ["#10B981", "#059669", "#047857"]
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.startButton}
            >
              <View style={styles.startButtonContent}>
                {loading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <View style={styles.startButtonIcon}>
                    <Ionicons name="play" size={22} color="#FFFFFF" />
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
                <View style={styles.startButtonArrow}>
                  <Ionicons name="arrow-forward" size={20} color="rgba(255,255,255,0.8)" />
                </View>
              </View>
            </LinearGradient>
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

      {/* Premium Dropdown Overlay at Root Level */}
      {showDropdown && (
        <TouchableOpacity
          style={styles.dropdownBackdrop}
          activeOpacity={1}
          onPress={() => { setShowDropdown(false); }}
        >
          <View style={styles.dropdownModalContainer}>
            {/* Modal Header */}
            <LinearGradient
              colors={["#0891B2", "#06B6D4"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.dropdownModalHeader}
            >
              <View style={styles.dropdownModalHeaderContent}>
                <View style={styles.dropdownModalIconBg}>
                  <Ionicons name="bus" size={18} color="#0891B2" />
                </View>
                <Text style={styles.dropdownModalTitle}>Select Route</Text>
              </View>
              <TouchableOpacity
                onPress={() => { setShowDropdown(false); }}
                style={styles.dropdownModalClose}
              >
                <Ionicons name="close" size={20} color="rgba(255,255,255,0.9)" />
              </TouchableOpacity>
            </LinearGradient>

            {/* Search Input */}
            <View style={styles.dropdownSearchContainer}>
              <Ionicons name="search" size={18} color="#64748B" />
              <TextInput
                style={styles.dropdownSearchInput}
                placeholder="Search routes..."
                placeholderTextColor="#94A3B8"
                value={searchTerm}
                onChangeText={setSearchTerm}
                autoFocus
              />
              {searchTerm.length > 0 && (
                <TouchableOpacity onPress={() => { playTapSound(); setSearchTerm(""); }}>
                  <Ionicons name="close-circle" size={18} color="#94A3B8" />
                </TouchableOpacity>
              )}
            </View>

            {/* Route List */}
            {loading ? (
              <View style={styles.dropdownLoadingContainer}>
                <ActivityIndicator size="small" color="#0891B2" />
                <Text style={styles.dropdownLoadingText}>Loading routes...</Text>
              </View>
            ) : filteredRoutes.length === 0 ? (
              <View style={styles.dropdownEmptyContainer}>
                <Ionicons name="map-outline" size={40} color="#CBD5E1" />
                <Text style={styles.dropdownEmptyText}>No routes found</Text>
                <Text style={styles.dropdownEmptySubText}>Try a different search term</Text>
              </View>
            ) : (
              <ScrollView
                style={styles.dropdownScrollView}
                showsVerticalScrollIndicator={true}
                nestedScrollEnabled={true}
              >
                {filteredRoutes.map((route, index) => (
                  <TouchableOpacity
                    key={route.id}
                    style={[
                      styles.dropdownRouteItem,
                      selectedRoute?.id === route.id && styles.dropdownRouteItemSelected,
                      index === filteredRoutes.length - 1 && { borderBottomWidth: 0 },
                    ]}
                    onPress={(e) => {
                      playTapSound();
                      e.stopPropagation();
                      handleRouteSelect(route);
                      setSearchTerm("");
                      setShowDropdown(false);
                    }}
                  >
                    <View style={styles.dropdownRouteLeft}>
                      <LinearGradient
                        colors={selectedRoute?.id === route.id ? ["#0891B2", "#06B6D4"] : ["#E2E8F0", "#CBD5E1"]}
                        style={styles.dropdownRouteIconBg}
                      >
                        <Ionicons
                          name="navigate"
                          size={14}
                          color={selectedRoute?.id === route.id ? "#fff" : "#64748B"}
                        />
                      </LinearGradient>
                      <View style={styles.dropdownRouteTextContainer}>
                        <Text
                          style={[
                            styles.dropdownRouteTitle,
                            selectedRoute?.id === route.id && styles.dropdownRouteTitleSelected,
                          ]}
                        >
                          {route.name}
                        </Text>
                        <Text style={styles.dropdownRouteSubtext}>
                          {route.start_address} → {route.end_address}
                        </Text>
                      </View>
                    </View>
                    {selectedRoute?.id === route.id && (
                      <View style={styles.dropdownRouteCheck}>
                        <Ionicons name="checkmark-circle" size={22} color="#10B981" />
                      </View>
                    )}
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
    backgroundColor: "#F8FAFC",
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 130,
    marginBottom: 20,
    flexGrow: 1,
    minHeight: "100%",
  },

  // Premium Header Styles
  header: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
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
  },
  headerIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  headerTextContainer: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.85)",
    marginTop: 2,
  },
  headerBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  headerBadgeText: {
    fontSize: 11,
    color: "#fff",
    fontWeight: "600",
  },

  // Premium Status Cards Styles
  statusCardsContainer: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 20,
    marginTop: 20,
  },
  statusCard: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 16,
    shadowColor: "#0891B2",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  statusCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  statusCardIconBg: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  statusCardTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1E293B",
    flex: 1,
    flexWrap: "wrap",
  },
  statusCardContent: {
    gap: 10,
  },
  statusItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusDotSmall: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  statusItemText: {
    fontSize: 12,
    color: "#64748B",
    flex: 1,
    flexWrap: "wrap",
  },
  gpsStatusContainer: {
    flex: 1,
    minWidth: 0,
  },
  coordinatesText: {
    fontSize: 10,
    color: "#94A3B8",
    fontFamily: "monospace",
    marginTop: 8,
  },
  gpsIndicator: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
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
    fontSize: 11,
    color: "#ffffff",
    fontWeight: "600",
  },

  // Enhanced Map Card Styles
  mapCard: {
    height: 240,
    borderRadius: 20,
    marginBottom: 20,
    shadowColor: "#0891B2",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6,
    overflow: "hidden",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  mapHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "#F8FAFC",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  mapHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  mapTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1E293B",
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
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
    borderColor: "#E2E8F0",
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
    borderRadius: 20,
    marginBottom: 50,
    shadowColor: "#0891B2",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
    overflow: "hidden",
    position: "relative",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  routeCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  routeCardHeaderContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  routeCardIconBg: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  routeCardTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: -0.2,
  },
  routeSelectedBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 4,
  },
  routeSelectedText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#fff",
  },
  routeCardBody: {
    padding: 16,
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
    color: "#0891B2",
    marginLeft: 8,
  },
  routeStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  routeStatusText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#059669",
    marginLeft: 4,
  },
  dropdownContainer: {
    marginBottom: 16,
    position: "relative",
    zIndex: 10,
  },
  dropdownLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748B",
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  dropdownField: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
  },
  dropdownFieldSelected: {
    backgroundColor: "#ECFEFF",
    borderColor: "#0891B2",
  },
  dropdownLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  dropdownIconBg: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  dropdownChevronBg: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#F1F5F9",
    justifyContent: "center",
    alignItems: "center",
  },
  dropdownTextContainer: {
    flex: 1,
  },
  dropdownText: {
    fontSize: 15,
    color: "#1E293B",
    fontWeight: "500",
    flexWrap: "wrap",
  },
  dropdownTextSelected: {
    color: "#0891B2",
    fontWeight: "600",
  },
  dropdownSubText: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 3,
    flexWrap: "wrap",
  },
  dropdownList: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    marginTop: 4,
    maxHeight: 250,
    shadowColor: "#0891B2",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  dropdownItem: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    minHeight: 48,
    justifyContent: "center",
  },
  selectedDropdownItem: {
    backgroundColor: "#ECFEFF",
  },
  dropdownItemText: {
    fontSize: 15,
    color: "#1E293B",
    fontWeight: "500",
  },
  selectedDropdownItemText: {
    color: "#0891B2",
    fontWeight: "600",
  },
  dropdownItemSubText: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  currentRoute: {
    backgroundColor: "#F8FAFC",
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  routeVisualization: {
    gap: 0,
  },
  routeItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  locationMarkerGradient: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  locationMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#10B981",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  locationTextContainer: {
    flex: 1,
  },
  locationLabel: {
    fontSize: 10,
    color: "#64748B",
    fontWeight: "600",
    marginBottom: 3,
    letterSpacing: 0.5,
  },
  locationText: {
    fontSize: 14,
    color: "#1E293B",
    fontWeight: "600",
    flexWrap: "wrap",
  },
  routeConnectorContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 15,
    height: 28,
  },
  routeConnectorLine: {
    width: 2,
    height: 8,
    backgroundColor: "#CBD5E1",
  },
  routeConnectorDots: {
    flexDirection: "column",
    alignItems: "center",
    gap: 3,
    marginVertical: 2,
  },
  connectorDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#CBD5E1",
  },
  arrowContainer: {
    alignItems: "center",
    marginVertical: 4,
  },
  routeEmptyState: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 8,
  },
  routeEmptyText: {
    fontSize: 14,
    color: "#94A3B8",
    fontWeight: "500",
  },

  // Fixed Start Button Styles
  fixedStartButtonContainer: {
    position: "absolute",
    bottom: 90, // Above the 70px navbar + some spacing
    left: 0,
    right: 0,
    backgroundColor: "transparent",
    paddingHorizontal: 20,
    zIndex: 100,
    pointerEvents: "box-none",
  },
  startButtonWrapper: {
    borderRadius: 18,
    overflow: "hidden",
    shadowColor: "#10B981",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  startButton: {
    borderRadius: 18,
    width: "100%",
    pointerEvents: "auto",
  },
  startButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 18,
    paddingHorizontal: 20,
  },
  startButtonIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  startButtonTextContainer: {
    flex: 1,
  },
  startButtonText: {
    fontSize: 17,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 2,
    flexWrap: "wrap",
  },
  startButtonSubtext: {
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.8)",
    flexWrap: "wrap",
  },
  startButtonArrow: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  disabledButton: {
    backgroundColor: "#94A3B8",
    shadowColor: "#64748B",
    shadowOpacity: 0.15,
  },
  dropdownSearch: {
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5ea",
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    marginBottom: 4,
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
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 2000,
  },
  // Premium Dropdown Modal Styles
  dropdownModalContainer: {
    width: "90%",
    maxWidth: 400,
    backgroundColor: "#fff",
    borderRadius: 20,
    maxHeight: 450,
    shadowColor: "#0891B2",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 20,
    overflow: "hidden",
    zIndex: 2001,
  },
  dropdownModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dropdownModalHeaderContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  dropdownModalIconBg: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  dropdownModalTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: -0.2,
  },
  dropdownModalClose: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  dropdownSearchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  dropdownSearchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 15,
    color: "#1E293B",
    fontWeight: "500",
  },
  dropdownLoadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    gap: 10,
  },
  dropdownLoadingText: {
    fontSize: 15,
    color: "#64748B",
    fontWeight: "500",
  },
  dropdownEmptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    gap: 8,
  },
  dropdownEmptyText: {
    fontSize: 16,
    color: "#64748B",
    fontWeight: "600",
  },
  dropdownEmptySubText: {
    fontSize: 13,
    color: "#94A3B8",
  },
  dropdownScrollView: {
    maxHeight: 280,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  dropdownRouteItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 14,
    marginHorizontal: 8,
    marginBottom: 6,
    borderRadius: 14,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  dropdownRouteItemSelected: {
    backgroundColor: "#ECFEFF",
    borderColor: "#0891B2",
  },
  dropdownRouteLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  dropdownRouteIconBg: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  dropdownRouteTextContainer: {
    flex: 1,
  },
  dropdownRouteTitle: {
    fontSize: 15,
    color: "#1E293B",
    fontWeight: "600",
  },
  dropdownRouteTitleSelected: {
    color: "#0891B2",
  },
  dropdownRouteSubtext: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  dropdownRouteCheck: {
    marginLeft: 10,
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
