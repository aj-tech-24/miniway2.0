import { mapDarkStyle } from "@/constants/mapDarkStyle";
import { useAuth } from "@/contexts/AuthContext";
import { useAppTheme } from "@/contexts/ThemeContext";
import { useThemeColor } from "@/hooks/useThemeColor";
import { supabase } from "@/lib/supabase";
import { FontAwesome, Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Keyboard,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";

// --- Type Definitions ---
type Minibus = {
  id: string;
  plateNumber: string;
  currentLocation: { latitude: number; longitude: number };
};

interface Prediction {
  description: string;
  place_id: string;
}

interface Place {
  name: string;
  coordinate: {
    latitude: number;
    longitude: number;
  };
}

// --- Constants ---
const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLEMAPS_API;

export function CommuterHomeScreen() {
  // Hooks and State declarations remain the same...
  const { session } = useAuth();
  const { theme } = useAppTheme();
  const params = useLocalSearchParams();
  const mapRef = useRef<MapView>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [buses, setBuses] = useState<Minibus[]>([]);
  const [userLocation, setUserLocation] =
    useState<Location.LocationObject | null>(null);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [noResultsFound, setNoResultsFound] = useState(false);
  const [dropoffLocation, setDropoffLocation] = useState("");
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isPinDroppingMode, setIsPinDroppingMode] = useState(false);
  const [isPinDropLoading, setIsPinDropLoading] = useState(false);
  const [droppedPinLocation, setDroppedPinLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [confirmedDestination, setConfirmedDestination] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState(false);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [lastLocationUpdate, setLastLocationUpdate] = useState<number>(0);
  const [selectedRouteMessage, setSelectedRouteMessage] = useState<
    string | null
  >(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [selectedRouteName, setSelectedRouteName] = useState<string | null>(
    null
  );
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [isMapExpanded, setIsMapExpanded] = useState(false);
  const [isCheckingExistingTrip, setIsCheckingExistingTrip] = useState(true);

  // Animation values
  const headerOpacity = useRef(new Animated.Value(1)).current;
  const cardsOpacity = useRef(new Animated.Value(1)).current;
  const headerTranslateY = useRef(new Animated.Value(0)).current;
  const cardsTranslateY = useRef(new Animated.Value(0)).current;

  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const primaryColor = useThemeColor({}, "tint");
  const buttonColor = useThemeColor({}, "buttonBackground");
  const buttonTextColor = useThemeColor({}, "buttonText");
  const placeholderTextColor = useThemeColor({}, "placeholderTextColor");
  const separatorColor = useThemeColor({}, "separatorColor");

  const handleFindRide = () => {
    console.log("=== FIND RIDE DEBUG ===");
    console.log("User location:", userLocation);
    console.log("Confirmed destination:", confirmedDestination);
    console.log("Selected route ID:", selectedRouteId);
    console.log("Selected route name:", selectedRouteName);

    // If a route is selected, we only need user location
    if (selectedRouteId) {
      if (!userLocation) {
        Alert.alert(
          "Missing Information",
          "Please ensure your location is enabled."
        );
        return;
      }

      // For selected routes, use default destination coordinates or let route-details handle it
      const routeParams: any = {
        originLat: userLocation.coords.latitude,
        originLng: userLocation.coords.longitude,
        routeId: selectedRouteId,
      };

      // If we have a confirmed destination, include it
      if (confirmedDestination) {
        routeParams.destLat = confirmedDestination.latitude;
        routeParams.destLng = confirmedDestination.longitude;
      }

      console.log("Navigating to route-details with params:", routeParams);
      router.push({
        pathname: "/route-details",
        params: routeParams,
      });
      return;
    }

    // For general route finding, we need both location and destination
    if (!userLocation || !confirmedDestination) {
      Alert.alert(
        "Missing Information",
        "Please ensure your location is enabled and a destination is set."
      );
      return;
    }

    const routeParams: any = {
      originLat: userLocation.coords.latitude,
      originLng: userLocation.coords.longitude,
      destLat: confirmedDestination.latitude,
      destLng: confirmedDestination.longitude,
    };

    console.log("Navigating to route-details with params:", routeParams);
    router.push({
      pathname: "/route-details",
      params: routeParams,
    });
  };

  // Function to calculate distance between two points
  const calculateDistance = useCallback(
    (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371; // Radius of the Earth in kilometers
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c; // Distance in kilometers
      return distance;
    },
    []
  );

  // Function to check for existing waiting trips (for app crash recovery)
  const checkForExistingTrip = useCallback(async () => {
    if (!session?.user?.id) {
      setIsCheckingExistingTrip(false);
      return;
    }

    try {
      console.log("🔍 Checking for existing waiting trips...");

      // Check for trip_passengers records with waiting status
      const { data: existingTrips, error } = await supabase
        .from("trip_passengers")
        .select(
          `
            id,
            bus_id,
            trip_id,
            status,
            pickup_lat,
            pickup_lng,
            dest_lat,
            dest_lng,
            passenger_count,
            created_at,
            buses!inner(plate_number),
            trips!inner(status)
          `
        )
        .eq("passenger_id", session.user.id)
        .eq("status", "boarded")
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) {
        console.error("Error checking for existing trips:", error);
        setIsCheckingExistingTrip(false);
        return;
      }

      if (existingTrips && existingTrips.length > 0) {
        const existingTrip = existingTrips[0];
        console.log("✅ Found existing waiting trip:", existingTrip);

        // Show alert to continue trip
        Alert.alert(
          "Continue Your Trip? 🚌",
          `You have an ongoing trip on Bus ${
            existingTrip.buses[0]?.plate_number || "Unknown"
          }. Would you like to continue where you left off?`,
          [
            {
              text: "Start New Trip",
              style: "cancel",
              onPress: () => {
                // Cancel the existing trip
                cancelExistingTrip(existingTrip.id);
              },
            },
            {
              text: "Continue Trip",
              onPress: () => {
                // Navigate to trip screen with existing trip data
                continueExistingTrip(existingTrip);
              },
            },
          ]
        );
      } else {
        console.log("ℹ️ No existing waiting trips found");
      }
    } catch (error) {
      console.error("Error in checkForExistingTrip:", error);
    } finally {
      setIsCheckingExistingTrip(false);
    }
  }, [session?.user?.id]);

  // Function to cancel existing trip
  const cancelExistingTrip = async (tripPassengerId: string) => {
    try {
      const { error } = await supabase
        .from("trip_passengers")
        .update({ status: "cancelled" })
        .eq("id", tripPassengerId);

      if (error) {
        console.error("Error cancelling existing trip:", error);
        Alert.alert(
          "Error",
          "Could not cancel the existing trip. Please try again."
        );
      } else {
        console.log("✅ Existing trip cancelled successfully");
      }
    } catch (error) {
      console.error("Error cancelling trip:", error);
    }
  };

  // Function to continue existing trip
  const continueExistingTrip = (existingTrip: any) => {
    try {
      console.log("🚀 Continuing existing trip:", existingTrip);

      // Navigate to trip screen with the existing trip data
      const tripParams = {
        busId: existingTrip.bus_id,
        busPlateNumber: existingTrip.buses[0]?.plate_number || "Unknown",
        tripId: existingTrip.trip_id,
        passengerCount: existingTrip.passenger_count || 1,
        pickupLat: existingTrip.pickup_lat.toString(),
        pickupLng: existingTrip.pickup_lng.toString(),
        destLat: existingTrip.dest_lat.toString(),
        destLng: existingTrip.dest_lng.toString(),
        routePath: "[]", // Will be fetched in trip screen
      };

      console.log("Navigating to trip with params:", tripParams);
      router.push({
        pathname: "/trip",
        params: tripParams,
      });
    } catch (error) {
      console.error("Error continuing trip:", error);
      Alert.alert("Error", "Could not continue the trip. Please try again.");
    }
  };

  // Fetch nearby buses on routes
  const fetchActiveMinibuses = useCallback(async () => {
    try {
      // First, get all active buses
      const { data: busesData, error: busesError } = await supabase
        .from("buses")
        .select("id, plateNumber, currentLocation, route_id")
        .eq("status", "active");

      if (busesError) throw busesError;

      // Get all routes to check proximity
      const { data: routesData, error: routesError } = await supabase
        .from("routes")
        .select("id, name, geojson");

      if (routesError) throw routesError;

      if (!userLocation || !busesData || !routesData) {
        // Fallback to original behavior if no user location
        const formattedData =
          busesData?.map((bus) => {
            const [longitude, latitude] = bus.currentLocation
              .replace("POINT(", "")
              .replace(")", "")
              .split(" ")
              .map(Number);
            return { ...bus, currentLocation: { latitude, longitude } };
          }) || [];
        setBuses(formattedData);
        return;
      }

      // Filter buses that are on routes near the user
      const nearbyBuses = busesData.filter((bus) => {
        const [longitude, latitude] = bus.currentLocation
          .replace("POINT(", "")
          .replace(")", "")
          .split(" ")
          .map(Number);

        // Calculate distance from user to bus
        const distanceToBus = calculateDistance(
          userLocation.coords.latitude,
          userLocation.coords.longitude,
          latitude,
          longitude
        );

        // Only include buses within 5km of user
        if (distanceToBus > 5) return false;

        // If bus has a route_id, check if the route is near the user
        if (bus.route_id) {
          const route = routesData.find((r) => r.id === bus.route_id);
          if (route && route.geojson && route.geojson.coordinates) {
            // Check if any point on the route is within 2km of user
            const routePoints = route.geojson.coordinates;
            const isRouteNearUser = routePoints.some((point: number[]) => {
              const [lng, lat] = point;
              const distanceToRoute = calculateDistance(
                userLocation.coords.latitude,
                userLocation.coords.longitude,
                lat,
                lng
              );
              return distanceToRoute <= 2; // 2km radius for route proximity
            });
            return isRouteNearUser;
          }
        }

        // If no route_id or route data, include bus if it's close enough
        return distanceToBus <= 3; // 3km radius for buses without route data
      });

      // Format the data
      const formattedData = nearbyBuses.map((bus) => {
        const [longitude, latitude] = bus.currentLocation
          .replace("POINT(", "")
          .replace(")", "")
          .split(" ")
          .map(Number);
        return { ...bus, currentLocation: { latitude, longitude } };
      });

      setBuses(formattedData);
    } catch (error) {
      if (error instanceof Error) {
        Alert.alert("Error", "Could not fetch minibus locations.");
      }
    }
  }, [userLocation, calculateDistance]);

  // Handle route selection from route tab (for backward compatibility)
  useEffect(() => {
    console.log("=== ROUTE SELECTION DEBUG ===");
    console.log("Params:", params);
    console.log("Current selectedRouteId:", selectedRouteId);
    console.log("Current selectedRouteName:", selectedRouteName);

    // Check if we have route selection params (for backward compatibility)
    if (params.selectedRouteId && params.selectedRouteName) {
      console.log("Processing route selection from params");
      console.log("Setting selectedRouteId to:", params.selectedRouteId);
      console.log("Setting selectedRouteName to:", params.selectedRouteName);

      setSelectedRouteId(params.selectedRouteId as string);
      setSelectedRouteName(params.selectedRouteName as string);

      if (params.message) {
        setSelectedRouteMessage(params.message as string);
        // Clear the message after 8 seconds (longer for route selection)
        setTimeout(() => {
          setSelectedRouteMessage(null);
        }, 8000);
      }
    }
  }, [params.selectedRouteId, params.selectedRouteName, params.message]);

  useEffect(() => {
    const initialize = async () => {
      const hasSeenModal = await AsyncStorage.getItem("hasSeenWelcomeModal");
      if (!hasSeenModal) {
        setShowWelcomeModal(true);
      }
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission Denied",
          "Permission to access location was denied."
        );
        setInitialLoading(false);
        return;
      }
      let location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      updateLocationWithDebounce(location);
      await fetchActiveMinibuses();

      // Check for existing waiting trips (for app crash recovery)
      await checkForExistingTrip();

      setInitialLoading(false);
    };
    initialize();
    const subscription = supabase
      .channel("public:minibuses")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "minibuses" },
        () => fetchActiveMinibuses()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(subscription);
    };
  }, [fetchActiveMinibuses, checkForExistingTrip]);

  // Refetch buses when user location changes
  useEffect(() => {
    if (userLocation) {
      fetchActiveMinibuses();
    }
  }, [userLocation, fetchActiveMinibuses]);

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    if (searchQuery.length > 2) {
      setIsSearching(true);
      setNoResultsFound(false);
      timeoutRef.current = setTimeout(() => {
        fetchPredictions(searchQuery);
      }, 500);
    } else {
      setPredictions([]);
      setIsSearching(false);
      setNoResultsFound(false);
    }
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [searchQuery]);

  const fetchPredictions = async (query: string) => {
    if (!GOOGLE_MAPS_API_KEY) {
      console.error("Google Maps API Key is not configured.");
      Alert.alert(
        "Configuration Error",
        "The search feature is currently unavailable."
      );
      setIsSearching(false);
      return;
    }
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
      query
    )}&key=${GOOGLE_MAPS_API_KEY}&components=country:PH`;
    try {
      const response = await fetch(url);
      const data = await response.json();
      if (data.status === "ZERO_RESULTS") {
        setNoResultsFound(true);
        setPredictions([]);
      } else if (data.predictions) {
        setPredictions(data.predictions);
      }
    } catch (error) {
      console.error("Failed to fetch predictions:", error);
    } finally {
      setIsSearching(false);
    }
  };

  const handlePredictionSelect = async (placeId: string) => {
    Keyboard.dismiss();
    setPredictions([]);
    setIsSearching(true);
    if (!GOOGLE_MAPS_API_KEY) {
      console.error("Google Maps API Key is not configured.");
      setIsSearching(false);
      return;
    }
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${GOOGLE_MAPS_API_KEY}&fields=geometry,name`;
    try {
      const response = await fetch(url);
      const data = await response.json();
      if (data.result?.geometry?.location) {
        const { location } = data.result.geometry;
        const placeDetails: Place = {
          name: data.result.name,
          coordinate: { latitude: location.lat, longitude: location.lng },
        };
        setSelectedPlace(placeDetails);
        setSearchQuery(placeDetails.name);
        mapRef.current?.animateToRegion(
          {
            ...placeDetails.coordinate,
            latitudeDelta: 0.02,
            longitudeDelta: 0.01,
          },
          1000
        );
      }
    } catch (error) {
      console.error("Failed to fetch place details:", error);
    } finally {
      setIsSearching(false);
    }
  };

  // --- UI Handlers ---
  const handleSetDestinationOnMap = () => {
    setIsMapExpanded(true);
    setIsPinDropLoading(true);
    setIsPinDroppingMode(true);

    // Animate header and cards out
    Animated.parallel([
      Animated.timing(headerOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(cardsOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(headerTranslateY, {
        toValue: -100,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(cardsTranslateY, {
        toValue: -200,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    setTimeout(() => {
      setIsPinDropLoading(false);
    }, 600); // Adjust duration to match animation
  };

  const handleConfirmDestination = async () => {
    if (!droppedPinLocation) return;
    setIsGeocoding(true);
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${droppedPinLocation.latitude},${droppedPinLocation.longitude}&key=${GOOGLE_MAPS_API_KEY}`;
    try {
      const response = await fetch(url);
      const data = await response.json();
      if (data.results && data.results.length > 0) {
        setDropoffLocation(data.results[0].formatted_address);
        setConfirmedDestination(droppedPinLocation); // <-- Save the confirmed coordinates
        setIsPinDroppingMode(false);
        setDroppedPinLocation(null);
        setIsMapExpanded(false);

        // Animate header and cards back in
        Animated.parallel([
          Animated.timing(headerOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(cardsOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(headerTranslateY, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(cardsTranslateY, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();
      } else {
        Alert.alert(
          "Location Unrecognized",
          "Could not find a specific address. Please try a different spot."
        );
      }
    } catch (error) {
      console.error("Failed to fetch address:", error);
      Alert.alert(
        "Error",
        "Could not determine the address. Please check your connection."
      );
    } finally {
      setIsGeocoding(false);
    }
  };

  const handleCancelPinDrop = () => {
    setIsPinDroppingMode(false);
    setDroppedPinLocation(null);
    setIsMapExpanded(false);

    // Animate header and cards back in
    Animated.parallel([
      Animated.timing(headerOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(cardsOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(headerTranslateY, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(cardsTranslateY, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handleModalDismiss = async () => {
    await AsyncStorage.setItem("hasSeenWelcomeModal", "true");
    setShowWelcomeModal(false);
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    setPredictions([]);
    setSelectedPlace(null);
    setNoResultsFound(false);
    setIsMapExpanded(false);
    Keyboard.dismiss();
  };

  const handleResetRouteSelection = () => {
    console.log("=== RESET ROUTE SELECTION ===");
    console.log("Clearing all route selection state");

    setSelectedRouteId(null);
    setSelectedRouteName(null);
    setSelectedRouteMessage(null);
    setConfirmedDestination(null);
    setDropoffLocation("");
    setSelectedPlace(null);
    setSearchQuery("");
    setPredictions([]);
    setNoResultsFound(false);

    // Clear the params to ensure fresh route selection works
    router.replace("/(commuter)");
  };

  // Debounced location update to prevent flickering
  const updateLocationWithDebounce = useCallback(
    (location: Location.LocationObject) => {
      const now = Date.now();
      const timeSinceLastUpdate = now - lastLocationUpdate;

      // Only update if it's been more than 2 seconds since last update
      // or if the location has changed significantly (more than 10 meters)
      if (timeSinceLastUpdate > 2000 || !userLocation) {
        const distance = userLocation
          ? calculateDistance(
              userLocation.coords.latitude,
              userLocation.coords.longitude,
              location.coords.latitude,
              location.coords.longitude
            ) * 1000 // Convert to meters
          : 1000; // If no previous location, always update

        if (distance > 10) {
          // Only update if moved more than 10 meters
          setUserLocation(location);
          setLocationAccuracy(location.coords.accuracy || null);
          setLastLocationUpdate(now);

          // Smooth map animation
          mapRef.current?.animateToRegion(
            {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
              latitudeDelta: 0.02,
              longitudeDelta: 0.02,
            },
            1000
          );
        }
      }
    },
    [userLocation, lastLocationUpdate, calculateDistance]
  );

  const trackUserLocation = async () => {
    setLocationLoading(true);
    setLocationError(false);

    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        // Try to prompt enabling location services on Android
        try {
          // @ts-ignore - only available on Android
          await Location.enableNetworkProviderAsync?.();
        } catch (_) {}

        setLocationError(true);
        Alert.alert(
          "Enable Location Services",
          "Location services are turned off. Please enable them in Settings.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Open Settings",
              onPress: () => Linking.openSettings?.(),
            },
          ]
        );
        return;
      }

      let { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") {
        const req = await Location.requestForegroundPermissionsAsync();
        status = req.status;
      }
      if (status !== "granted") {
        setLocationError(true);
        Alert.alert(
          "Permission Required",
          "We need your permission to access your location. You can enable it in Settings.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Settings", onPress: () => Linking.openSettings?.() },
          ]
        );
        return;
      }

      // Check for cached location first for faster response
      const lastKnownPosition = await Location.getLastKnownPositionAsync({
        maxAge: 30000, // 30 seconds
        requiredAccuracy: 100, // 100 meters accuracy is acceptable
      });

      if (lastKnownPosition) {
        updateLocationWithDebounce(lastKnownPosition);
        setLocationLoading(false);
      }

      // Get more accurate current position
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced, // Balanced accuracy for faster response
      });

      updateLocationWithDebounce(location);
      setLocationError(false);
    } catch (error) {
      console.error("Failed to track user location:", error);
      setLocationError(true);
      Alert.alert("Error", "Unable to get your location. Please try again.");
    } finally {
      setLocationLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />

      {/* Loading screen for checking existing trips */}
      {isCheckingExistingTrip && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingTitle}>
              Checking for ongoing trips...
            </Text>
            <Text style={styles.loadingSubtext}>
              Looking for any trips that may have been interrupted
            </Text>
          </View>
        </View>
      )}

      {/* Safe Area for normal mode */}
      {!isPinDroppingMode && (
        <SafeAreaView
          style={[styles.safeArea, { backgroundColor }]}
          edges={["top", "left", "right"]}
        >
          {/* Enhanced Header Section */}
          <Animated.View
            style={[
              styles.header,
              {
                opacity: headerOpacity,
                transform: [{ translateY: headerTranslateY }],
              },
            ]}
          >
            <View style={styles.headerContent}>
              <View style={styles.headerIconContainer}>
                <Ionicons name="bus" size={28} color="#007AFF" />
              </View>
              <View style={styles.headerTextContainer}>
                <Text style={styles.title}>Commuter Dashboard</Text>
                <Text style={styles.subtitle}>Find your perfect ride</Text>
              </View>
            </View>
          </Animated.View>
        </SafeAreaView>
      )}

      {/* Full Screen Header for pin dropping mode */}
      {isPinDroppingMode && (
        <View style={styles.fullScreenHeader}>
          <View style={styles.headerContent}>
            <View style={styles.headerIconContainer}>
              <Ionicons name="bus" size={28} color="#fff" />
            </View>
            <View style={styles.headerTextContainer}>
              <Text style={styles.title}>
                {selectedRouteId
                  ? `Set Destination for ${selectedRouteName}`
                  : "Set Destination"}
              </Text>
              <Text style={styles.subtitle}>Tap on the map to drop a pin</Text>
            </View>
            <TouchableOpacity
              style={styles.fullScreenCloseButton}
              onPress={handleCancelPinDrop}
            >
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={[styles.contentContainer, { backgroundColor }]}>
        <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={true}
            scrollEnabled={!isPinDroppingMode}
            nestedScrollEnabled={true}
            keyboardShouldPersistTaps="handled"
            removeClippedSubviews={false}
            style={[styles.scrollView, { backgroundColor }]}
          >
            {/* Enhanced Status Cards */}
            <Animated.View
              style={[
                styles.statusCardsContainer,
                {
                  opacity: cardsOpacity,
                  transform: [{ translateY: cardsTranslateY }],
                },
              ]}
            >
              {/* Location Status Card */}
              <View style={[styles.statusCard, { backgroundColor }]}>
                <View style={styles.statusCardHeader}>
                  <Ionicons name="location" size={24} color="#007AFF" />
                  <Text style={[styles.statusCardTitle, { color: textColor }]}>
                    Location Status
                  </Text>
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
                  {userLocation && (
                    <View style={styles.locationDetailsContainer}>
                      <Text style={styles.coordinatesText}>
                        {userLocation.coords.latitude.toFixed(4)},{" "}
                        {userLocation.coords.longitude.toFixed(4)}
                      </Text>
                      {locationAccuracy && (
                        <Text style={styles.accuracyText}>
                          Accuracy: {Math.round(locationAccuracy)}m
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              </View>

              {/* Bus Status Card */}
              <View style={[styles.statusCard, { backgroundColor }]}>
                <View style={styles.statusCardHeader}>
                  <Ionicons name="bus-outline" size={24} color="#007AFF" />
                  <Text style={[styles.statusCardTitle, { color: textColor }]}>
                    Nearby Buses
                  </Text>
                </View>
                <View style={styles.statusCardContent}>
                  <View style={styles.statusItem}>
                    <Ionicons
                      name="bus"
                      size={20}
                      color={buses.length > 0 ? "#34C759" : "#8e8e93"}
                    />
                    <Text
                      style={[
                        styles.statusItemText,
                        buses.length > 0 && styles.statusItemTextActive,
                      ]}
                    >
                      {buses.length} bus{buses.length !== 1 ? "es" : ""} on
                      nearby routes
                    </Text>
                  </View>
                  <View style={styles.statusItem}>
                    <Ionicons
                      name="location-outline"
                      size={20}
                      color="#8e8e93"
                    />
                    <Text style={styles.statusItemText}>Within 5km radius</Text>
                  </View>
                  {buses.length > 0 && (
                    <View style={styles.statusItem}>
                      <Ionicons name="time-outline" size={20} color="#FF9500" />
                      <Text style={styles.statusItemText}>
                        Real-time tracking active
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </Animated.View>

            {/* Enhanced Map Card - Only show in normal mode */}
            {!isPinDroppingMode && (
              <View style={[styles.mapCard, { backgroundColor }]}>
                <View style={styles.mapHeader}>
                  <View style={styles.mapHeaderLeft}>
                    <Ionicons name="map" size={20} color="#007AFF" />
                    <Text style={[styles.mapTitle, { color: textColor }]}>
                      Current Location
                    </Text>
                  </View>
                  <View style={styles.mapHeaderRight}>
                    <TouchableOpacity
                      style={[
                        styles.mapActionButton,
                        locationLoading && styles.mapActionButtonDisabled,
                        { backgroundColor: buttonColor },
                      ]}
                      onPress={trackUserLocation}
                      disabled={locationLoading}
                    >
                      <Ionicons
                        name="refresh"
                        size={16}
                        color={locationLoading ? "#8e8e93" : buttonTextColor}
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
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                  }}
                  showsUserLocation
                  showsMyLocationButton={false}
                >
                  {selectedPlace && (
                    <Marker
                      coordinate={selectedPlace.coordinate}
                      title={selectedPlace.name}
                    />
                  )}
                  {buses.map((bus) => (
                    <Marker
                      key={bus.id}
                      coordinate={bus.currentLocation}
                      title={`Bus: ${bus.plateNumber}`}
                    >
                      <View style={styles.markerContainer}>
                        <FontAwesome name="bus" size={20} color="#fff" />
                      </View>
                    </Marker>
                  ))}
                </MapView>

                {/* Enhanced Map Controls */}
                <View style={styles.mapControls}>
                  <View style={styles.zoomControls}>
                    <TouchableOpacity
                      style={styles.zoomButton}
                      onPress={() => {
                        if (mapRef.current) {
                          const center = userLocation?.coords || {
                            latitude: 6.7536,
                            longitude: 125.356,
                          };
                          mapRef.current.animateCamera(
                            {
                              center,
                              zoom: 15,
                            },
                            { duration: 500 }
                          );
                        }
                      }}
                    >
                      <Ionicons name="add" size={16} color="#007AFF" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.zoomButton}
                      onPress={() => {
                        if (mapRef.current) {
                          const center = userLocation?.coords || {
                            latitude: 6.7536,
                            longitude: 125.356,
                          };
                          mapRef.current.animateCamera(
                            {
                              center,
                              zoom: 10,
                            },
                            { duration: 500 }
                          );
                        }
                      }}
                    >
                      <Ionicons name="remove" size={16} color="#007AFF" />
                    </TouchableOpacity>
                  </View>
                  {/* Center Button */}
                  <TouchableOpacity
                    style={styles.mapControlButton}
                    onPress={trackUserLocation}
                  >
                    <Ionicons name="locate" size={18} color="#007AFF" />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Route Selection Card */}
            <Animated.View
              style={[
                styles.routeCard,
                {
                  opacity: cardsOpacity,
                  transform: [{ translateY: cardsTranslateY }],
                },
                { backgroundColor },
              ]}
            >
              <View style={[styles.routeHeader, { backgroundColor }]}>
                <View style={styles.routeHeaderLeft}>
                  <Ionicons name="map" size={24} color="#007AFF" />
                  <Text style={[styles.routeTitle, { color: textColor }]}>
                    Plan Your Journey
                  </Text>
                </View>
                {selectedRouteId && (
                  <View style={styles.routeStatusBadge}>
                    <Ionicons
                      name="checkmark-circle"
                      size={16}
                      color="#4CAF50"
                    />
                    <Text style={styles.routeStatusText}>Route Selected</Text>
                  </View>
                )}
              </View>

              {/* Route Selection Message */}
              {selectedRouteMessage && (
                <View
                  style={[
                    styles.routeMessageContainer,
                    { backgroundColor: primaryColor },
                  ]}
                >
                  <Ionicons name="bus" size={20} color="#fff" />
                  <Text style={styles.routeMessageText}>
                    {selectedRouteMessage}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setSelectedRouteMessage(null)}
                    style={styles.closeMessageButton}
                  >
                    <Ionicons name="close" size={16} color="#fff" />
                  </TouchableOpacity>
                </View>
              )}

              {/* Destination Selection */}
              <View style={styles.destinationSection}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionLabel, { color: textColor }]}>
                    Destination
                  </Text>
                  {dropoffLocation && (
                    <View style={styles.destinationStatusBadge}>
                      <Ionicons
                        name="checkmark-circle"
                        size={14}
                        color="#4CAF50"
                      />
                      <Text style={styles.destinationStatusText}>Set</Text>
                    </View>
                  )}
                </View>
                <TouchableOpacity
                  style={[
                    styles.destinationContainer,
                    {
                      backgroundColor,
                      borderColor: dropoffLocation
                        ? "#4CAF50"
                        : "rgba(0, 0, 0, 0.1)",
                      borderWidth: dropoffLocation ? 2 : 1.5,
                    },
                  ]}
                  onPress={handleSetDestinationOnMap}
                >
                  <Ionicons
                    name="flag"
                    size={20}
                    color={dropoffLocation ? "#4CAF50" : "#007AFF"}
                  />
                  <View style={styles.destinationTextContainer}>
                    <Text
                      style={[
                        styles.destinationText,
                        { color: dropoffLocation ? textColor : "#8E8E93" },
                      ]}
                    >
                      {dropoffLocation || "Tap to set destination on map"}
                    </Text>
                    {dropoffLocation ? (
                      <Text
                        style={[
                          styles.destinationSubtext,
                          { color: "#4CAF50" },
                        ]}
                      >
                        ✓ Destination confirmed
                      </Text>
                    ) : (
                      <Text
                        style={[
                          styles.destinationSubtext,
                          { color: "#8E8E93" },
                        ]}
                      >
                        Tap to select on map
                      </Text>
                    )}
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={dropoffLocation ? "#4CAF50" : "#8E8E93"}
                  />
                </TouchableOpacity>
              </View>

              {/* Find Ride Button */}
              <TouchableOpacity
                style={[
                  styles.findRideButton,
                  {
                    backgroundColor:
                      userLocation && (confirmedDestination || selectedRouteId)
                        ? "#007AFF"
                        : "#8E8E93",
                    opacity:
                      userLocation && (confirmedDestination || selectedRouteId)
                        ? 1
                        : 0.6,
                  },
                ]}
                onPress={handleFindRide}
                disabled={
                  !userLocation || (!confirmedDestination && !selectedRouteId)
                }
              >
                <Ionicons
                  name={selectedRouteId ? "bus" : "search"}
                  size={20}
                  color="#fff"
                />
                <Text style={styles.findRideButtonText}>
                  {!userLocation
                    ? "Getting your location..."
                    : selectedRouteId
                    ? "Continue to Bus Selection"
                    : !confirmedDestination
                    ? "Set destination first"
                    : "Find Best Route"}
                </Text>
              </TouchableOpacity>
            </Animated.View>

            {/* Nearby Buses Section */}
            <Animated.View
              style={[
                styles.nearbySection,
                {
                  opacity: cardsOpacity,
                  transform: [{ translateY: cardsTranslateY }],
                },
              ]}
            >
              <View style={styles.nearbyHeader}>
                <Ionicons
                  name="bus-outline"
                  size={20}
                  color={buses.length > 0 ? "#007AFF" : "#8E8E93"}
                />
                <View style={styles.nearbyTextContainer}>
                  <Text style={[styles.nearbyTitle, { color: textColor }]}>
                    Buses on Nearby Routes
                  </Text>
                  <Text style={[styles.nearbySubtitle, { color: textColor }]}>
                    {buses.length > 0
                      ? `${buses.length} bus${
                          buses.length !== 1 ? "es" : ""
                        } within 5km on accessible routes`
                      : "No buses found within 5km radius"}
                  </Text>
                </View>
                {buses.length > 0 && (
                  <View style={styles.liveIndicator}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveText}>LIVE</Text>
                  </View>
                )}
              </View>

              {buses.length > 0 ? (
                <View style={styles.busesList}>
                  {buses.slice(0, 3).map((bus) => {
                    const distance = userLocation
                      ? calculateDistance(
                          userLocation.coords.latitude,
                          userLocation.coords.longitude,
                          bus.currentLocation.latitude,
                          bus.currentLocation.longitude
                        )
                      : 0;

                    return (
                      <View
                        key={bus.id}
                        style={[styles.busItem, { backgroundColor }]}
                      >
                        <Ionicons name="bus" size={16} color="#007AFF" />
                        <View style={styles.busInfo}>
                          <Text style={[styles.busPlate, { color: textColor }]}>
                            {bus.plateNumber}
                          </Text>
                          <Text
                            style={[styles.busStatus, { color: textColor }]}
                          >
                            {distance > 0
                              ? `${distance.toFixed(1)}km away`
                              : "Active"}{" "}
                            • On nearby route
                          </Text>
                        </View>
                        <View style={styles.busStatusIndicator}>
                          <View style={styles.statusDot} />
                        </View>
                      </View>
                    );
                  })}
                  {buses.length > 3 && (
                    <View
                      style={[styles.moreBusesContainer, { backgroundColor }]}
                    >
                      <Text
                        style={[styles.moreBusesText, { color: textColor }]}
                      >
                        +{buses.length - 3} more buses available
                      </Text>
                    </View>
                  )}
                </View>
              ) : (
                <View style={[styles.noBusesContainer, { backgroundColor }]}>
                  <Ionicons name="bus-outline" size={40} color="#8E8E93" />
                  <Text style={[styles.noBusesText, { color: textColor }]}>
                    No buses on nearby routes
                  </Text>
                  <Text style={[styles.noBusesSubtext, { color: "#8E8E93" }]}>
                    No active buses within 5km on accessible routes
                  </Text>
                </View>
              )}
            </Animated.View>
          </ScrollView>
        </TouchableWithoutFeedback>

        {/* Full-Screen Map for Pin Dropping */}
        {isPinDroppingMode && (
          <View style={styles.fullScreenMapContainer}>
            <MapView
              ref={mapRef}
              style={styles.fullScreenMap}
              provider="google"
              customMapStyle={theme === "dark" ? [...mapDarkStyle] : []}
              initialRegion={{
                latitude: 6.7536,
                longitude: 125.356,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              }}
              onPress={(e) => {
                if (isPinDroppingMode) {
                  setDroppedPinLocation(e.nativeEvent.coordinate);
                }
              }}
              showsUserLocation
              showsMyLocationButton={false}
            >
              {selectedPlace && (
                <Marker
                  coordinate={selectedPlace.coordinate}
                  title={selectedPlace.name}
                />
              )}
              {buses.map((bus) => (
                <Marker
                  key={bus.id}
                  coordinate={bus.currentLocation}
                  title={`Bus: ${bus.plateNumber}`}
                >
                  <View style={styles.markerContainer}>
                    <FontAwesome name="bus" size={20} color="#fff" />
                  </View>
                </Marker>
              ))}
              {droppedPinLocation && (
                <Marker
                  coordinate={droppedPinLocation}
                  draggable
                  onDragEnd={(e) =>
                    setDroppedPinLocation(e.nativeEvent.coordinate)
                  }
                  pinColor="tomato"
                />
              )}
            </MapView>
          </View>
        )}

        {/* Fixed Action Button */}
        <Animated.View
          style={[
            styles.fixedActionButtonContainer,
            {
              opacity: cardsOpacity,
              transform: [{ translateY: cardsTranslateY }],
            },
          ]}
        >
          {selectedRouteId && (
            <TouchableOpacity
              style={styles.resetButton}
              onPress={handleResetRouteSelection}
            >
              <Ionicons name="refresh" size={16} color="#ffffff" />
              <Text style={styles.resetButtonText}>Reset Route</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </View>

      {/* Search Bar Modal - Only show when showSearchBar is true and not in pin dropping mode */}
      {showSearchBar && !isPinDroppingMode && (
        <Modal
          animationType="slide"
          transparent={true}
          visible={showSearchBar}
          onRequestClose={handleCancelPinDrop}
        >
          <View style={styles.searchModalOverlay}>
            <View style={[styles.searchModalContent, { backgroundColor }]}>
              <View style={styles.searchModalHeader}>
                <Text style={[styles.searchModalTitle, { color: textColor }]}>
                  Set Destination
                </Text>
                <TouchableOpacity
                  onPress={handleCancelPinDrop}
                  style={styles.searchModalCloseButton}
                >
                  <Ionicons name="close" size={24} color={textColor} />
                </TouchableOpacity>
              </View>

              {/* Search Bar */}
              <View style={[styles.searchContainer, { backgroundColor }]}>
                <View style={styles.searchIconContainer}>
                  <Ionicons
                    name="search"
                    size={20}
                    color={placeholderTextColor}
                  />
                </View>
                <TextInput
                  placeholder="Search for a destination..."
                  placeholderTextColor={placeholderTextColor}
                  style={[styles.searchInput, { color: textColor }]}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={handleClearSearch}
                    style={styles.clearIcon}
                  >
                    <Ionicons
                      name="close-circle"
                      size={20}
                      color={placeholderTextColor}
                    />
                  </TouchableOpacity>
                )}
                {isSearching && (
                  <View style={styles.searchLoadingContainer}>
                    <ActivityIndicator size="small" color={primaryColor} />
                  </View>
                )}
              </View>

              {/* Search Results */}
              {predictions.length > 0 ? (
                <View
                  style={[styles.predictionsContainer, { backgroundColor }]}
                >
                  <View style={styles.predictionsHeader}>
                    <Ionicons
                      name="location-outline"
                      size={16}
                      color={placeholderTextColor}
                    />
                    <Text
                      style={[
                        styles.predictionsHeaderText,
                        { color: placeholderTextColor },
                      ]}
                    >
                      {predictions.length} result
                      {predictions.length !== 1 ? "s" : ""} found
                    </Text>
                  </View>
                  <FlatList
                    data={predictions}
                    keyExtractor={(item) => item.place_id}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={[
                          styles.predictionItem,
                          { borderBottomColor: separatorColor },
                        ]}
                        onPress={() => handlePredictionSelect(item.place_id)}
                      >
                        <Ionicons
                          name="location"
                          size={16}
                          color={primaryColor}
                        />
                        <Text
                          style={[styles.predictionText, { color: textColor }]}
                          numberOfLines={2}
                        >
                          {item.description}
                        </Text>
                        <Ionicons
                          name="chevron-forward"
                          size={16}
                          color={placeholderTextColor}
                        />
                      </TouchableOpacity>
                    )}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                  />
                </View>
              ) : (
                noResultsFound &&
                !isSearching && (
                  <View
                    style={[styles.noResultsContainer, { backgroundColor }]}
                  >
                    <Ionicons
                      name="search-outline"
                      size={24}
                      color={placeholderTextColor}
                    />
                    <Text style={[styles.noResultsText, { color: textColor }]}>
                      No results found
                    </Text>
                    <Text
                      style={[
                        styles.noResultsSubtext,
                        { color: placeholderTextColor },
                      ]}
                    >
                      Try a different search term
                    </Text>
                  </View>
                )
              )}
            </View>
          </View>
        </Modal>
      )}

      {/* Welcome Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={showWelcomeModal}
        onRequestClose={handleModalDismiss}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor }]}>
            <View style={styles.modalIconContainer}>
              <Ionicons name="bus" size={60} color="#007AFF" />
            </View>
            <Text style={[styles.modalTitle, { color: textColor }]}>
              Welcome to Miniway! 🚌
            </Text>
            <Text style={[styles.modalText, { color: placeholderTextColor }]}>
              Ready to find your ride? Track minibuses in real-time and travel
              smarter with our intelligent route planning.
            </Text>
            <View style={styles.modalFeatures}>
              <View style={styles.modalFeature}>
                <Ionicons name="location" size={20} color="#34C759" />
                <Text style={[styles.modalFeatureText, { color: textColor }]}>
                  Real-time bus tracking
                </Text>
              </View>
              <View style={styles.modalFeature}>
                <Ionicons name="map" size={20} color="#007AFF" />
                <Text style={[styles.modalFeatureText, { color: textColor }]}>
                  Smart route planning
                </Text>
              </View>
              <View style={styles.modalFeature}>
                <Ionicons name="time" size={20} color="#FF9500" />
                <Text style={[styles.modalFeatureText, { color: textColor }]}>
                  Live arrival times
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: primaryColor }]}
              onPress={handleModalDismiss}
            >
              <Ionicons name="arrow-forward" size={20} color="#fff" />
              <Text style={styles.modalButtonText}>Let's Get Started!</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Pin Dropping UI */}
      {isPinDroppingMode && (
        <>
          <View
            style={[
              styles.instructionContainer,
              droppedPinLocation && styles.instructionContainerWithPin,
            ]}
          >
            <Text style={styles.instructionText}>
              {droppedPinLocation
                ? "📍 Drag the pin to adjust location"
                : selectedRouteId
                ? "📍 Tap on the map to set your destination for this route"
                : "📍 Tap on the map to drop a pin"}
            </Text>
          </View>
          <View style={styles.pinActionContainer}>
            <TouchableOpacity
              style={[styles.pinActionButton, styles.cancelButton]}
              onPress={handleCancelPinDrop}
            >
              <Text style={styles.pinActionButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.pinActionButton,
                styles.confirmButton,
                droppedPinLocation && styles.confirmButtonActive,
                (!droppedPinLocation || isGeocoding) && styles.disabledButton,
              ]}
              onPress={handleConfirmDestination}
              disabled={!droppedPinLocation || isGeocoding}
            >
              {isGeocoding ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.pinActionButtonText}>
                  {droppedPinLocation ? "✓ Confirm" : "Confirm Pin"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}

      {isPinDropLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Preparing map for pin drop...</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  safeArea: {
    flex: 0,
  },
  contentContainer: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  scrollView: {
    flex: 1,
  },
  fullScreenHeader: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingTop: 50, // Account for status bar
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    zIndex: 1001,
  },
  fullScreenCloseButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 120, // Add more space for fixed button
    flexGrow: 1,
    minHeight: "100%",
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
    backgroundColor: "rgb(255, 255, 255)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  headerTextContainer: {
    flex: 1,
  },
  title: {
    fontSize: 20,
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
  statusItemTextActive: {
    color: "#34C759",
    fontWeight: "600",
  },
  gpsStatusContainer: {
    flex: 1,
    minWidth: 0, // Allow shrinking
  },
  locationDetailsContainer: {
    marginTop: 4,
  },
  coordinatesText: {
    fontSize: 10,
    color: "#8e8e93",
    fontFamily: "monospace",
    flexWrap: "wrap",
  },
  accuracyText: {
    fontSize: 9,
    color: "#8e8e93",
    marginTop: 2,
    fontWeight: "500",
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
    height: 260,
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
  fullScreenMapContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#ffffff",
    zIndex: 1000,
  },
  fullScreenMap: {
    flex: 1,
  },
  mapHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e7",
  },
  mapHeaderFullScreen: {
    paddingTop: 20, // Account for status bar
    backgroundColor: "#ffffff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
    zIndex: 1000, // Above the instruction container
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
    gap: 8,
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

  // Search Modal Styles
  searchModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    justifyContent: "flex-end",
  },
  searchModalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
    maxHeight: "60%",
  },
  searchModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  searchModalTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  searchModalCloseButton: {
    padding: 8,
  },

  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.05)",
    marginBottom: 16,
  },
  searchIconContainer: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
  },
  clearIcon: {
    padding: 4,
    marginRight: 8,
  },
  searchLoadingContainer: {
    marginRight: 8,
  },
  predictionsContainer: {
    borderRadius: 16,
    maxHeight: 300,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.05)",
    overflow: "hidden",
  },
  predictionsHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0, 0, 0, 0.05)",
  },
  predictionsHeaderText: {
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 8,
  },
  predictionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  predictionText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    marginLeft: 12,
    marginRight: 8,
  },
  noResultsContainer: {
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.05)",
  },
  noResultsText: {
    fontSize: 16,
    fontWeight: "600",
    marginTop: 12,
    textAlign: "center",
  },
  noResultsSubtext: {
    fontSize: 14,
    marginTop: 4,
    textAlign: "center",
  },

  // Destination Section Styles
  destinationSection: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  sectionLabel: {
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  destinationStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E8F5E8",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  destinationStatusText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#4CAF50",
    marginLeft: 4,
  },
  destinationContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1.5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  destinationTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  destinationText: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 3,
    lineHeight: 22,
  },
  destinationSubtext: {
    fontSize: 13,
    fontWeight: "500",
    opacity: 0.8,
  },

  // Find Ride Button
  findRideButton: {
    backgroundColor: "#007AFF",
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 18,
    flexDirection: "row",
    justifyContent: "center",
  },
  findRideButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    marginLeft: 8,
  },

  // Nearby Section Styles
  nearbySection: {
    marginTop: 12,
  },
  nearbyHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  nearbyTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  nearbyTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 4,
  },
  nearbySubtitle: {
    fontSize: 14,
    fontWeight: "500",
    opacity: 0.7,
  },
  liveIndicator: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FF3B30",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#fff",
    marginRight: 4,
  },
  liveText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.5,
  },
  busesList: {
    gap: 12,
  },
  busItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f2f5",
  },
  busInfo: {
    marginLeft: 12,
  },
  busPlate: {
    fontSize: 16,
    fontWeight: "600",
  },
  busStatus: {
    color: "#666",
  },
  busStatusIndicator: {
    marginLeft: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#34C759",
  },
  moreBusesContainer: {
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.08)",
    backgroundColor: "rgba(0, 122, 255, 0.05)",
  },
  moreBusesText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#007AFF",
  },
  noBusesContainer: {
    alignItems: "center",
    paddingVertical: 32,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.05)",
    backgroundColor: "rgba(0, 0, 0, 0.02)",
  },
  noBusesText: {
    textAlign: "center",
    color: "#888",
    marginTop: 16,
  },
  noBusesSubtext: {
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
    opacity: 0.7,
    lineHeight: 20,
  },

  // Fixed Action Button Container
  fixedActionButtonContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "transparent",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    borderTopWidth: 0,
    borderTopColor: "transparent",
    zIndex: 1000,
    pointerEvents: "box-none",
  },
  resetButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FF3B30",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
    alignSelf: "flex-end",
  },
  resetButtonText: {
    marginLeft: 6,
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },

  // Route Message Styles
  routeMessageContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  routeMessageText: {
    flex: 1,
    color: "#fff",
    fontSize: 14,
    marginLeft: 8,
    fontWeight: "500",
  },
  closeMessageButton: {
    padding: 4,
    marginLeft: 8,
  },

  // Pin Dropping Styles
  instructionContainer: {
    position: "absolute",
    top: 120, // Position below the full-screen header
    alignSelf: "center",
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    zIndex: 1002, // Above the map but below header
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },
  instructionContainerWithPin: {
    backgroundColor: "rgba(0, 122, 255, 0.9)",
    borderWidth: 2,
    borderColor: "#007AFF",
  },
  instructionText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  pinActionContainer: {
    position: "absolute",
    bottom: 40,
    left: 20,
    right: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 1002, // Above the map but below header
  },
  pinActionButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 8,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  confirmButton: {
    backgroundColor: "#007AFF",
  },
  confirmButtonActive: {
    backgroundColor: "#34C759",
    transform: [{ scale: 1.05 }],
  },
  cancelButton: {
    backgroundColor: "#6c757d",
  },
  disabledButton: {
    backgroundColor: "#8E8E93",
    opacity: 0.6,
  },
  pinActionButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.5,
  },

  // Loading Overlay
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingContainer: {
    alignItems: "center",
    backgroundColor: "white",
    borderRadius: 20,
    padding: 32,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  loadingTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
    marginTop: 16,
    marginBottom: 8,
    textAlign: "center",
  },
  loadingSubtext: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    lineHeight: 22,
  },
  loadingText: {
    marginTop: 10,
    color: "#fff",
    fontSize: 16,
  },

  // Marker Styles
  markerContainer: {
    backgroundColor: "#007AFF",
    padding: 8,
    borderRadius: 20,
    borderColor: "#fff",
    borderWidth: 2,
  },

  // Welcome Modal Styles
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  modalContent: {
    width: "90%",
    maxWidth: 400,
    borderRadius: 24,
    padding: 32,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 16,
  },
  modalIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(0, 122, 255, 0.1)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 16,
    textAlign: "center",
  },
  modalText: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 24,
  },
  modalFeatures: {
    width: "100%",
    marginBottom: 32,
  },
  modalFeature: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  modalFeatureText: {
    fontSize: 15,
    fontWeight: "500",
    marginLeft: 12,
  },
  modalButton: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 32,
    minWidth: 200,
    justifyContent: "center",
  },
  modalButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
    marginLeft: 8,
  },
});

export default CommuterHomeScreen;
