import { mapDarkStyle } from "@/constants/mapDarkStyle";
import { useAuth } from "@/contexts/AuthContext";
import { useCommuterUI } from "@/contexts/CommuterUIContext";
import { useBusesOnRoute, useRoute } from "@/contexts/RouteContext";
import { useAppTheme } from "@/contexts/ThemeContext";
import { useThemeColor } from "@/hooks/useThemeColor";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
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
  Image,
  Keyboard,
  LayoutAnimation,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  UIManager,
  View,
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path, Polygon } from "react-native-svg";

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

// Trip data types from database
interface BusData {
  id: string;
  plate_number: string;
  route_id: string;
  status: string;
}

interface TripData {
  id: string;
  current_location:
  | string
  | { latitude: number; longitude: number }
  | { type: string; coordinates: number[] }
  | null;
  bus_id: string;
  status: string;
  buses: BusData | BusData[];
}

interface BusWithLocation {
  id: string;
  plateNumber: string;
  route_id: string;
  currentLocation:
  | string
  | { latitude: number; longitude: number }
  | { type: string; coordinates: number[] };
}

// Type for trips_with_geojson view
interface TripWithGeoJSON {
  status: string;
  current_location: any; // GeoJSON object or string
  bus_id: string;
  plate_number: string;
  route_id: string;
  driver_id: string;
  driver_name: string;
}

interface RouteData {
  id: string;
  name: string;
  path: string | { coordinates: number[][] };
}

// --- Constants ---
const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLEMAPS_API;

export function CommuterHomeScreen() {
  // Hooks and State declarations remain the same...
  const { session } = useAuth();
  const { theme } = useAppTheme();
  // Route Context Hooks
  const { setCurrentRoute } = useRoute();
  const { buses: contextBuses } = useBusesOnRoute();

  const params = useLocalSearchParams();
  const mapRef = useRef<MapView>(null);
  const scrollViewRef = useRef<ScrollView>(null);
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
  const { isPinDroppingMode, setIsPinDroppingMode } = useCommuterUI();
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
  const [isMapExpanded, setIsMapExpanded] = useState(false); const [isCheckingExistingTrip, setIsCheckingExistingTrip] = useState(true);
  const [showPendingRequestModal, setShowPendingRequestModal] = useState(false);
  const [pendingRequestData, setPendingRequestData] = useState<any>(null);
  const [showContinueTripModal, setShowContinueTripModal] = useState(false);
  const [existingTripData, setExistingTripData] = useState<any>(null);
  const [showPinDropInstructions, setShowPinDropInstructions] = useState(true);
  // Animation values
  const headerOpacity = useRef(new Animated.Value(1)).current;
  const cardsOpacity = useRef(new Animated.Value(1)).current;
  const headerTranslateY = useRef(new Animated.Value(0)).current;
  const cardsTranslateY = useRef(new Animated.Value(0)).current;
  // Track ignored request ID to prevent modal re-appearing after navigation
  const ignoredRequestIdRef = useRef<string | null>(null);

  // Beating circle animation values for user location marker
  const beatingScale1 = useRef(new Animated.Value(0)).current;
  const beatingScale2 = useRef(new Animated.Value(0)).current;
  const beatingScale3 = useRef(new Animated.Value(0)).current;
  const beatingOpacity1 = useRef(new Animated.Value(1)).current;
  const beatingOpacity2 = useRef(new Animated.Value(1)).current;
  const beatingOpacity3 = useRef(new Animated.Value(1)).current;

  // Compass/Magnetometer state for direction indicator
  const [compassHeading, setCompassHeading] = useState(0);
  const [isMagnetometerAvailable, setIsMagnetometerAvailable] = useState(false);
  const [mapCameraHeading, setMapCameraHeading] = useState(0); // Track map rotation

  // Enable LayoutAnimation for Android
  useEffect(() => {
    if (Platform.OS === "android") {
      if (UIManager.setLayoutAnimationEnabledExperimental) {
        UIManager.setLayoutAnimationEnabledExperimental(true);
      }
    }
  }, []);

  // Compass heading using expo-location for better accuracy
  useEffect(() => {
    let headingSub: Location.LocationSubscription | null = null;

    const subscribe = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setIsMagnetometerAvailable(false);
          return;
        }

        // Check if heading is available
        const available = await Location.hasServicesEnabledAsync();
        setIsMagnetometerAvailable(available);
        if (!available) return;

        headingSub = await Location.watchHeadingAsync((h) => {
          // Use trueHeading if available (more accurate), otherwise use magHeading
          const bearing = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          setCompassHeading(Math.round(bearing));
        });
      } catch (error) {
        //console.error('Error setting up heading watch:', error);
        setIsMagnetometerAvailable(false);
      }
    };

    subscribe();
    return () => {
      if (headingSub) {
        headingSub.remove();
      }
    };
  }, []);


  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const primaryColor = useThemeColor({}, "tint");
  const buttonColor = useThemeColor({}, "buttonBackground");
  const buttonTextColor = useThemeColor({}, "buttonText");
  const placeholderTextColor = useThemeColor({}, "placeholderTextColor");
  const separatorColor = useThemeColor({}, "separatorColor");

  const handleFindRide = async () => {
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

    // Compute best route id up-front so we can pass `routeId` to route-details.
    // This helps RouteContext subscribe to realtime broadcast immediately.
    let bestRouteId: string | null = null;
    try {
      const { data: routeData, error: routeError } = await supabase.rpc(
        "find_best_route_for_trip",
        {
          origin_lon: userLocation.coords.longitude,
          origin_lat: userLocation.coords.latitude,
          dest_lon: confirmedDestination.longitude,
          dest_lat: confirmedDestination.latitude,
        }
      );
      if (!routeError && routeData && routeData.length > 0 && routeData[0]?.id) {
        bestRouteId = routeData[0].id as string;
      }
    } catch {
      // ignore; route-details will fall back to its own best-route fetch
    }

    const routeParams: any = {
      originLat: userLocation.coords.latitude,
      originLng: userLocation.coords.longitude,
      destLat: confirmedDestination.latitude,
      destLng: confirmedDestination.longitude,
      ...(bestRouteId ? { routeId: bestRouteId } : {}),
    };

    //console.log("Navigating to route-details with params:", routeParams);
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
  ); // Helper function to parse location data in various formats
  const parseLocation = useCallback(
    (location: any): { latitude: number; longitude: number } | null => {
      if (!location) return null;

      try {
        // Handle string format (POINT or GeoJSON string or binary)
        if (typeof location === "string") {
          // Check for binary format (starts with hex like 0101000020E6100000...)
          if (location.startsWith("01") && location.length > 20) {
            return null;
          }

          // Handle PostGIS POINT format: POINT(lng lat)
          if (location.startsWith("POINT(")) {
            const coordString = location.replace("POINT(", "").replace(")", "");
            const coords = coordString.split(" ");
            if (coords.length >= 2) {
              const [lng, lat] = coords.map(Number);
              if (!isNaN(lat) && !isNaN(lng)) {
                return { latitude: lat, longitude: lng };
              }
            }
            return null;
          }

          // Try to parse as GeoJSON string
          try {
            const geoJson = JSON.parse(location);
            if (
              geoJson.type === "Point" &&
              Array.isArray(geoJson.coordinates)
            ) {
              const [lng, lat] = geoJson.coordinates;
              if (!isNaN(lat) && !isNaN(lng)) {
                return { latitude: lat, longitude: lng };
              }
            }
          } catch (parseError) {
            // Not a JSON string, that's okay
          }

          // If we get here, it's an unrecognized string format
          return null;
        }

        // Handle object format (most common with trips_with_geojson view)
        if (typeof location === "object") {
          // GeoJSON Point format: { type: "Point", coordinates: [lng, lat] }
          if (
            location.type === "Point" &&
            Array.isArray(location.coordinates)
          ) {
            const [lng, lat] = location.coordinates;
            if (!isNaN(lat) && !isNaN(lng)) {
              return { latitude: lat, longitude: lng };
            }
          }

          // Direct lat/lng object format
          if (location.latitude && location.longitude) {
            const { latitude, longitude } = location;
            if (!isNaN(latitude) && !isNaN(longitude)) {
              return { latitude, longitude };
            }
          }
        }

        return null;
      } catch (error) {
        // Silently fail parsing errors
        return null;
      }
    },
    []
  );
  // Function to check for existing waiting trips (for app crash recovery)
  // PRIORITY FUNCTION: This must be called first to handle trip recovery
  const checkForExistingTrip = useCallback(async () => {
    if (!session?.user?.id) {
      setIsCheckingExistingTrip(false);
      return;
    }

    try {


      // 1. Check for ANY PENDING pickup request first
      // This is the most important state for the commuter
      const { data: pendingRequests, error: pendingError } = await supabase
        .from("pickup_requests")
        .select(`
          id,
          trip_id,
          bus_id,
          status,
          pickup_lat,
          pickup_lng,
          dest_lat,
          dest_lng,
          created_at,
          buses!inner(plate_number, route_id)
        `)
        .eq("commuter_id", session.user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1);

      if (pendingRequests && pendingRequests.length > 0) {
        const pendingRequest = pendingRequests[0];


        // Check if we've already ignored/handled this request
        if (pendingRequest.id === ignoredRequestIdRef.current) {

          setIsCheckingExistingTrip(false);
          return;
        }

        let plateNumber = "Unknown";
        let routeId = null;
        if (pendingRequest.buses) {
          const busData = Array.isArray(pendingRequest.buses) ? pendingRequest.buses[0] : pendingRequest.buses;
          plateNumber = busData?.plate_number || "Unknown";
          routeId = busData?.route_id;
        }

        // Fetch the corresponding trip_passengers record ID for cancellation
        const { data: tpRecord } = await supabase
          .from("trip_passengers")
          .select("id")
          .eq("trip_id", pendingRequest.trip_id)
          .eq("passenger_id", session.user.id)
          .maybeSingle();

        setPendingRequestData({
          request: pendingRequest,
          plateNumber,
          routeId,
          tpRecordId: tpRecord?.id
        });
        setShowPendingRequestModal(true);
        setIsCheckingExistingTrip(false);
        return;
      }

      // 2. If no pending request, check for ongoing trips (boarded or waiting to board)
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
            buses!inner(plate_number, route_id),
            trips!inner(status)
          `
        )
        .eq("passenger_id", session.user.id)
        .in("status", ["boarded", "waiting"])
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) {
        //console.error("Error checking for existing trips:", error);
        setIsCheckingExistingTrip(false);
        return;
      } if (existingTrips && existingTrips.length > 0) {
        const existingTrip = existingTrips[0];


        let plateNumber = "Unknown";
        if (existingTrip.buses) {
          if (
            Array.isArray(existingTrip.buses) &&
            existingTrip.buses.length > 0
          ) {
            plateNumber = existingTrip.buses[0]?.plate_number || "Unknown";
          } else if (
            typeof existingTrip.buses === "object" &&
            (existingTrip.buses as any).plate_number
          ) {
            plateNumber = (existingTrip.buses as any).plate_number;
          }
        }

        // Show custom modal instead of native Alert
        setExistingTripData({
          trip: existingTrip,
          plateNumber: plateNumber,
        });
        setShowContinueTripModal(true);
      } else {

      }
    } catch (error) {
      //console.error("Error in checkForExistingTrip:", error);
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

      // Also cancel any pending pickup requests for this user to be safe
      if (session?.user?.id) {
        await supabase
          .from("pickup_requests")
          .update({ status: "cancelled" })
          .eq("commuter_id", session.user.id)
          .eq("status", "pending");
      }

      if (error) {
        //console.error("Error cancelling existing trip:", error);
        Alert.alert(
          "Error",
          "Could not cancel the existing trip. Please try again."
        );
      } else {

      }
    } catch (error) {
      //console.error("Error cancelling trip:", error);
    }
  };
  // Function to continue existing trip
  const continueExistingTrip = (existingTrip: any) => {
    try {

      let plateNumber = "Unknown";
      if (existingTrip.buses) {
        if (
          Array.isArray(existingTrip.buses) &&
          existingTrip.buses.length > 0
        ) {
          plateNumber = existingTrip.buses[0]?.plate_number || "Unknown";
        } else if (
          typeof existingTrip.buses === "object" &&
          (existingTrip.buses as any).plate_number
        ) {
          plateNumber = (existingTrip.buses as any).plate_number;
        }
      }


      // Navigate to trip screen with the existing trip data
      const tripParams = {
        busId: existingTrip.bus_id,
        busPlateNumber: plateNumber,
        tripId: existingTrip.trip_id,
        passengerCount: existingTrip.passenger_count || 1,
        pickupLat: existingTrip.pickup_lat.toString(),
        pickupLng: existingTrip.pickup_lng.toString(),
        destLat: existingTrip.dest_lat.toString(),
        destLng: existingTrip.dest_lng.toString(),
        routePath: "[]", // Will be fetched in trip screen
      };


      router.push({
        pathname: "/trip",
        params: tripParams,
      });
    } catch (error) {
      //console.error("Error continuing trip:", error);
      Alert.alert("Error", "Could not continue the trip. Please try again.");
    }
  }; // Fetch nearby buses on routes
  const fetchActiveMinibuses = useCallback(async () => {
    // If a route is selected, let RouteContext handle the buses
    if (selectedRouteId) return;

    try {


      // Get active trips with bus information and current location
      // Include both 'waiting' and 'ongoing' trips to show all available buses
      // Use trips_with_geojson view which converts location to GeoJSON format
      const { data: activeTripsData, error: tripsError } = await supabase
        .from("trips_with_geojson")
        .select(
          `
          status,
          current_location,
          bus_id,
          plate_number,
          route_id,
          driver_id,
          driver_name
        `
        )
        .in("status", ["waiting", "ongoing"]);

      if (tripsError) {
        //console.error("Error fetching trips:", tripsError);
        throw tripsError;
      }

      // Transform the data to match expected format
      // Filter out trips with invalid/binary location data
      const busesData =
        activeTripsData
          ?.filter((trip: TripWithGeoJSON) => {
            // Check if location is valid
            if (!trip.current_location) {

              return false;
            }



            // GeoJSON view should return objects, but handle strings just in case
            if (typeof trip.current_location === "string") {
              // Check for binary format
              const isBinaryFormat = trip.current_location.startsWith("01");
              if (isBinaryFormat) {

                return false;
              }
            }

            return true;
          })
          .map((trip: TripWithGeoJSON): BusWithLocation => {
            //console.log(
            //  `🚌 Bus ${trip.plate_number} - Status: ${trip.status} - Location:`,
            //  trip.current_location
            //);
            return {
              id: trip.bus_id, // Use bus_id as the identifier
              plateNumber: trip.plate_number,
              route_id: trip.route_id,
              currentLocation: trip.current_location, // GeoJSON or text location from view
            };
          }) || [];

      // Get all routes with geojson data to check proximity
      const { data: routesData, error: routesError } = await supabase
        .from("routes_with_geojson")
        .select("id, name, path");

      if (routesError) {
        //console.error("Error fetching routes:", routesError);
        throw routesError;
      }



      if (!busesData || busesData.length === 0) {

        setBuses([]);
        return;
      }
      if (!userLocation) {

        // Fallback to showing all buses if no user location
        const formattedData = busesData.map((bus: BusWithLocation) => {
          const parsedLocation = parseLocation(bus.currentLocation);
          const latitude = parsedLocation?.latitude || 6.7536; // Default Davao coordinates
          const longitude = parsedLocation?.longitude || 125.356;

          return {
            id: bus.id,
            plateNumber: bus.plateNumber,
            currentLocation: { latitude, longitude },
          };
        });

        setBuses(formattedData);
        return;
      } // Filter buses that are on routes near the user
      const nearbyBuses = busesData.filter((bus: BusWithLocation) => {
        const parsedLocation = parseLocation(bus.currentLocation);

        if (!parsedLocation) {

          return false;
        }

        const { latitude, longitude } = parsedLocation;

        // Calculate distance from user to bus
        const distanceToBus = calculateDistance(
          userLocation.coords.latitude,
          userLocation.coords.longitude,
          latitude,
          longitude
        );



        // Only include buses within 5km of user
        if (distanceToBus > 5) return false;

        return true;

        /* Temporarily simplified to show all buses within 5km regardless of route path proximity
        // If bus has a route_id, check if the route is near the user
        if (bus.route_id && routesData) {
          const route = routesData.find((r) => r.id === bus.route_id);
          if (route && route.path) {
            try {
              // Parse the PostGIS geography data from the path field
              let routePoints: number[][] = [];

              if (typeof route.path === "string") {
                // Handle PostGIS LineString format: LINESTRING(lng lat, lng lat, ...)
                if (route.path.startsWith("LINESTRING(")) {
                  const coordinateString = route.path
                    .replace("LINESTRING(", "")
                    .replace(")", "");
                  routePoints = coordinateString.split(",").map((coord) => {
                    const [lng, lat] = coord.trim().split(" ").map(Number);
                    return [lng, lat];
                  });
                }
              } else if (route.path && route.path.coordinates) {
                // Handle GeoJSON format
                routePoints = route.path.coordinates;
              }

              if (routePoints.length > 0) {
                // Check if any point on the route is within 2km of user
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
            } catch (error) {
              console.error("Error parsing route path:", error);
            }
          }
        }

        // If no route_id or route data, include bus if it's close enough
        return distanceToBus <= 3; // 3km radius for buses without route data
        */
      });


      // Format the data
      const formattedData = nearbyBuses.map((bus: BusWithLocation) => {
        const parsedLocation = parseLocation(bus.currentLocation);
        const latitude = parsedLocation?.latitude || 6.7536;
        const longitude = parsedLocation?.longitude || 125.356;

        return {
          id: bus.id,
          plateNumber: bus.plateNumber,
          currentLocation: { latitude, longitude },
        };
      });

      setBuses(formattedData);

      // Log final bus data for debugging

    } catch (error) {
      //console.error("❌ Error in fetchActiveMinibuses:", error);
      setBuses([]); // Set empty array on error

      // Don't show alert for database errors as they're usually temporary
      if (error instanceof Error && !error.message.includes("column")) {
        Alert.alert("Error", "Could not fetch bus locations: " + error.message);
      }
    }
  }, [userLocation, calculateDistance, parseLocation, selectedRouteId]);

  // Handle route selection from route tab (for backward compatibility)
  useEffect(() => {


    // Check if we have route selection params (for backward compatibility)
    if (params.selectedRouteId && params.selectedRouteName) {


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

  // Sync selected route with RouteContext for real-time updates
  useEffect(() => {
    setCurrentRoute(selectedRouteId);
  }, [selectedRouteId, setCurrentRoute]);

  // Update local buses state from RouteContext when a route is selected
  useEffect(() => {
    // Only use context buses if a specific route is selected
    if (selectedRouteId) {
      // Map BusOnRoute to Minibus format
      // contextBuses is already an array of BusOnRoute objects
      const formattedBuses = contextBuses.map((bus: any) => ({
        id: bus.id,
        plateNumber: bus.plateNumber,
        currentLocation: bus.location || { latitude: 0, longitude: 0 },
      })).filter((bus: any) => bus.currentLocation.latitude !== 0 && bus.currentLocation.longitude !== 0);

      // Only update if we have buses, or if we want to show empty state for that route
      // We should be careful not to flicker
      //console.log(`🚌 Real-time update: ${formattedBuses.length} buses on route ${selectedRouteId}`);
      setBuses(formattedBuses);
    }
  }, [selectedRouteId, contextBuses]);

  // Handle destination name from history screen navigation
  useEffect(() => {
    if (params.destinationName) {
      const destinationName = params.destinationName as string;


      // Set the search query with the destination name
      setSearchQuery(destinationName);
      setDropoffLocation(destinationName);

      // Show the search bar and trigger search
      setShowSearchBar(true);

      // Fetch place predictions for the destination
      const fetchPredictions = async () => {
        if (!GOOGLE_MAPS_API_KEY) return;

        try {
          setIsSearching(true);
          const response = await fetch(
            `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
              destinationName
            )}&key=${GOOGLE_MAPS_API_KEY}&components=country:ph`
          );
          const data = await response.json();
          if (data.predictions && data.predictions.length > 0) {
            setPredictions(data.predictions);
          }
        } catch (error) {
          //console.error("Error fetching predictions:", error);
        } finally {
          setIsSearching(false);
        }
      };

      fetchPredictions();
    }
  }, [params.destinationName]);

  // PRIORITY EFFECT: Check for existing trips immediately when session is available
  // This runs BEFORE any other initialization to ensure trip recovery happens first
  useEffect(() => {
    if (session?.user?.id) {

      checkForExistingTrip();
    }
  }, [session?.user?.id, checkForExistingTrip]);

  useEffect(() => {
    const initialize = async () => {
      // PRIORITY: Check for existing waiting trips first (for app crash recovery)
      // This must run before other initialization to handle trip recovery
      await checkForExistingTrip();

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

      setInitialLoading(false);
    };
    initialize();
    const subscription = supabase
      .channel("public:trips")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trips" },
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

  // Beating circle animation for user location marker
  useEffect(() => {
    const startBeatingAnimation = () => {
      const createBeatingSequence = (
        scaleValue: Animated.Value,
        opacityValue: Animated.Value,
        delay: number
      ) => {
        return Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.parallel([
              Animated.timing(scaleValue, {
                toValue: 3,
                duration: 2000,
                useNativeDriver: true,
              }),
              Animated.timing(opacityValue, {
                toValue: 0,
                duration: 2000,
                useNativeDriver: true,
              }),
            ]),
            Animated.parallel([
              Animated.timing(scaleValue, {
                toValue: 0,
                duration: 0,
                useNativeDriver: true,
              }),
              Animated.timing(opacityValue, {
                toValue: 1,
                duration: 0,
                useNativeDriver: true,
              }),
            ]),
          ])
        );
      };

      // Start three beating circles with different delays
      Animated.parallel([
        createBeatingSequence(beatingScale1, beatingOpacity1, 0),
        createBeatingSequence(beatingScale2, beatingOpacity2, 600),
        createBeatingSequence(beatingScale3, beatingOpacity3, 1200),
      ]).start();
    };

    if (userLocation) {
      startBeatingAnimation();
    }
  }, [
    userLocation,
    beatingScale1,
    beatingScale2,
    beatingScale3,
    beatingOpacity1,
    beatingOpacity2,
    beatingOpacity3,
  ]);

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
      //console.error("Google Maps API Key is not configured.");
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
      //console.error("Failed to fetch predictions:", error);
    } finally {
      setIsSearching(false);
    }
  };

  const handlePredictionSelect = async (placeId: string) => {
    Keyboard.dismiss();
    setPredictions([]);
    setIsSearching(true);
    if (!GOOGLE_MAPS_API_KEY) {
      //console.error("Google Maps API Key is not configured.");
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
      //console.error("Failed to fetch place details:", error);
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
      //console.error("Failed to fetch address:", error);
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
    //console.log("=== RESET ROUTE SELECTION ===");
    //console.log("Clearing all route selection state");

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
        } catch (_) { }

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

        // Force center the map on cached location
        mapRef.current?.animateToRegion(
          {
            latitude: lastKnownPosition.coords.latitude,
            longitude: lastKnownPosition.coords.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          },
          1000
        );
      }

      // Get more accurate current position
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced, // Balanced accuracy for faster response
      });

      updateLocationWithDebounce(location);
      setLocationError(false);

      // Force center the map on user location when manually tracking
      mapRef.current?.animateToRegion(
        {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        1000
      );
    } catch (error) {
      //console.error("Failed to track user location:", error);
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
          {/* Enhanced Header Section with Premium Gradient */}
          <Animated.View
            style={[
              styles.headerWrapper,
              {
                opacity: headerOpacity,
                transform: [{ translateY: headerTranslateY }],
              },
            ]}
          >
            <LinearGradient
              colors={theme === "dark"
                ? ["#1a365d", "#2563eb", "#3b82f6"]
                : ["#0052d4", "#4364f7", "#6fb1fc"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.headerGradient}
            >
              {/* Decorative circles for premium look */}
              <View style={styles.headerDecorativeCircle1} />
              <View style={styles.headerDecorativeCircle2} />

              <View style={styles.headerContent}>
                <View style={styles.headerIconContainer}>
                  <LinearGradient
                    colors={["#ffffff", "#f0f9ff"]}
                    style={styles.headerIconGradient}
                  >
                    <Ionicons name="bus" size={28} color="#0066FF" />
                  </LinearGradient>
                </View>
                <View style={styles.headerTextContainer}>
                  <Text style={styles.title}>Commuter Dashboard</Text>
                  <Text style={styles.subtitle}>Find your perfect ride</Text>
                </View>
                <View style={styles.headerBadge}>
                  <View style={styles.headerBadgeDot} />
                  <Text style={styles.headerBadgeText}>LIVE</Text>
                </View>
              </View>
            </LinearGradient>
          </Animated.View>
        </SafeAreaView>
      )}

      {/* Full Screen Header for pin dropping mode */}
      {/* Full Screen Header for pin dropping mode */}
      {isPinDroppingMode && (
        <View style={styles.pinDropHeaderContainer}>
          <LinearGradient
            colors={theme === "dark"
              ? ["#1a365d", "#2563eb", "#3b82f6"]
              : ["#0052d4", "#4364f7", "#6fb1fc"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.pinDropHeaderGradient}
          >
            {/* Decorative elements */}
            <View style={styles.pinDropDecorCircle1} />
            <View style={styles.pinDropDecorCircle2} />

            {/* Main Header Row */}
            <View style={styles.pinDropHeaderRow}>
              <View style={styles.headerIconContainer}>
                <LinearGradient
                  colors={["#ffffff", "#f0f9ff"]}
                  style={styles.headerIconGradient}
                >
                  <Ionicons name="location" size={28} color="#0066FF" />
                </LinearGradient>
              </View>
              <View style={styles.headerTextContainer}>
                <Text style={styles.title}>
                  {selectedRouteId
                    ? `Set Destination for ${selectedRouteName}`
                    : "Set Your Drop-off Point"}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.fullScreenCloseButton}
                onPress={handleCancelPinDrop}
              >
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.pinDropInstructionsHeader}
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setShowPinDropInstructions(!showPinDropInstructions);
              }}
              activeOpacity={0.8}
            >
              <View style={styles.pinDropInstructionsHeaderLeft}>
                <Ionicons name="help-circle" size={18} color="#fff" />
                <Text style={styles.pinDropInstructionsHeaderText}>
                  How to drop a pin
                </Text>
              </View>
              <View style={styles.pinDropInstructionsToggle}>
                <Ionicons
                  name={showPinDropInstructions ? "chevron-up" : "chevron-down"}
                  size={18}
                  color="#fff"
                />
              </View>
            </TouchableOpacity>

            {showPinDropInstructions && (
              <View style={styles.pinDropInstructionsContainer}>
                {/* Step 1 */}
                <View style={styles.pinDropStep}>
                  <View style={styles.pinDropStepNumber}>
                    <Text style={styles.pinDropStepNumberText}>1</Text>
                  </View>
                  <Text style={styles.pinDropStepText}>
                    Find a highway or national road on the map.
                  </Text>
                </View>

                {/* Step 2 */}
                <View style={styles.pinDropStep}>
                  <View style={styles.pinDropStepNumber}>
                    <Text style={styles.pinDropStepNumberText}>2</Text>
                  </View>
                  <Text style={styles.pinDropStepText}>
                    Tap to drop your pin where you want to drop off.
                  </Text>
                </View>

                {/* Step 3 */}
                <View style={styles.pinDropStep}>
                  <View style={styles.pinDropStepNumber}>
                    <Text style={styles.pinDropStepNumberText}>3</Text>
                  </View>
                  <Text style={styles.pinDropStepText}>
                    Tap "Confirm Destination" to save your drop-off location.
                  </Text>
                </View>

                {/* Important Notice */}
                <View style={styles.pinDropWarningBanner}>
                  <View style={styles.pinDropWarningIcon}>
                    <Ionicons name="warning" size={16} color="#F59E0B" />
                  </View>
                  <Text style={styles.pinDropWarningText}>
                    Only drop a pin on <Text style={styles.pinDropWarningBold}>highways or national roads</Text> where the bus can safely stop.
                  </Text>
                </View>
              </View>
            )}
          </LinearGradient>
        </View>
      )}

      <View style={[styles.contentContainer, { backgroundColor }]}>
        <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
          <ScrollView
            ref={scrollViewRef}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={true}
            scrollEnabled={!isPinDroppingMode}
            nestedScrollEnabled={true}
            keyboardShouldPersistTaps="handled"
            removeClippedSubviews={false}
            style={[styles.scrollView, { backgroundColor }]}
          >
            {/* Premium Status Cards with Glassmorphism */}
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
              <View style={[styles.statusCard, theme === "dark" && styles.statusCardDark]}>
                <LinearGradient
                  colors={theme === "dark"
                    ? ["rgba(59, 130, 246, 0.1)", "rgba(37, 99, 235, 0.05)"]
                    : ["rgba(59, 130, 246, 0.08)", "rgba(37, 99, 235, 0.02)"]}
                  style={styles.statusCardGradient}
                />
                <View style={styles.statusCardHeader}>
                  <View style={styles.statusIconWrapper}>
                    <LinearGradient
                      colors={locationError ? ["#FF6B6B", "#EE5A5A"] : ["#3B82F6", "#2563EB"]}
                      style={styles.statusIconGradient}
                    >
                      <Ionicons name="navigate" size={18} color="#fff" />
                    </LinearGradient>
                  </View>
                  <Text style={[styles.statusCardTitle, { color: textColor }]}>
                    GPS Status
                  </Text>
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
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.gpsIndicator}
                    >
                      {locationLoading ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <View style={styles.gpsDot} />
                      )}
                      <Text style={styles.gpsText}>
                        {locationLoading
                          ? "Locating..."
                          : locationError
                            ? "GPS Error"
                            : "Connected"}
                      </Text>
                    </LinearGradient>
                  </View>
                  {userLocation && (
                    <View style={styles.locationDetailsContainer}>
                      <View style={styles.coordinatesRow}>
                        <Ionicons name="location-outline" size={12} color={theme === "dark" ? "#60A5FA" : "#3B82F6"} />
                        <Text style={[styles.coordinatesText, { color: theme === "dark" ? "#60A5FA" : "#3B82F6" }]}>
                          {userLocation.coords.latitude.toFixed(4)},{" "}
                          {userLocation.coords.longitude.toFixed(4)}
                        </Text>
                      </View>
                      {locationAccuracy && (
                        <Text style={styles.accuracyText}>
                          ±{Math.round(locationAccuracy)}m accuracy
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              </View>

              {/* Bus Status Card */}
              <View style={[styles.statusCard, theme === "dark" && styles.statusCardDark]}>
                <LinearGradient
                  colors={theme === "dark"
                    ? ["rgba(16, 185, 129, 0.1)", "rgba(5, 150, 105, 0.05)"]
                    : ["rgba(16, 185, 129, 0.08)", "rgba(5, 150, 105, 0.02)"]}
                  style={styles.statusCardGradient}
                />
                <View style={styles.statusCardHeader}>
                  <View style={styles.statusIconWrapper}>
                    <LinearGradient
                      colors={buses.length > 0 ? ["#10B981", "#059669"] : ["#6B7280", "#4B5563"]}
                      style={styles.statusIconGradient}
                    >
                      <Ionicons name="bus" size={18} color="#fff" />
                    </LinearGradient>
                  </View>
                  <Text style={[styles.statusCardTitle, { color: textColor }]}>
                    Nearby
                  </Text>
                </View>
                <View style={styles.statusCardContent}>
                  <View style={styles.busCountContainer}>
                    <Text style={[styles.busCountNumber, { color: buses.length > 0 ? "#10B981" : textColor }]}>
                      {buses.length}
                    </Text>
                    <Text style={[styles.busCountLabel, { color: theme === "dark" ? "#9CA3AF" : "#6B7280" }]}>
                      {buses.length === 1 ? "Bus" : "Buses"}
                    </Text>
                  </View>
                  <View style={styles.statusDivider} />
                  <View style={styles.statusItem}>
                    <Ionicons
                      name="radio-outline"
                      size={14}
                      color={buses.length > 0 ? "#10B981" : "#9CA3AF"}
                    />
                    <Text style={[styles.statusItemText, { color: theme === "dark" ? "#9CA3AF" : "#6B7280" }]}>
                      5km radius
                    </Text>
                  </View>
                  {buses.length > 0 && (
                    <View style={styles.statusItem}>
                      <View style={styles.pulsingDot} />
                      <Text style={[styles.statusItemText, { color: "#10B981" }]}>
                        Live tracking
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </Animated.View>

            {/* Premium Map Card with Gradient Header */}
            {!isPinDroppingMode && (
              <View style={[styles.mapCard, theme === "dark" && styles.mapCardDark]}>
                <LinearGradient
                  colors={theme === "dark"
                    ? ["#1F2937", "#111827"]
                    : ["#F8FAFC", "#F1F5F9"]}
                  style={styles.mapHeader}
                >
                  <View style={styles.mapHeaderLeft}>
                    <View style={styles.mapIconWrapper}>
                      <LinearGradient
                        colors={["#3B82F6", "#2563EB"]}
                        style={styles.mapIconGradient}
                      >
                        <Ionicons name="map" size={16} color="#fff" />
                      </LinearGradient>
                    </View>
                    <View>
                      <Text style={[styles.mapTitle, { color: textColor }]}>
                        Live Map
                      </Text>
                      <Text style={[styles.mapSubtitle, { color: theme === "dark" ? "#9CA3AF" : "#6B7280" }]}>
                        Your current area
                      </Text>
                    </View>
                  </View>
                  <View style={styles.mapHeaderRight}>
                    <TouchableOpacity
                      style={[
                        styles.mapActionButton,
                        locationLoading && styles.mapActionButtonDisabled,
                      ]}
                      onPress={trackUserLocation}
                      disabled={locationLoading}
                      activeOpacity={0.7}
                    >
                      <LinearGradient
                        colors={locationLoading
                          ? ["#9CA3AF", "#6B7280"]
                          : ["#3B82F6", "#2563EB"]}
                        style={styles.mapActionGradient}
                      >
                        <Ionicons
                          name="locate"
                          size={16}
                          color="#fff"
                        />
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                </LinearGradient>
                <MapView
                  ref={mapRef}
                  style={styles.map}
                  googleRenderer="LEGACY"
                  customMapStyle={theme === "dark" ? [...mapDarkStyle] : []}
                  initialRegion={{
                    latitude: 6.7536,
                    longitude: 125.356,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                  }}
                  showsUserLocation={false}
                  showsMyLocationButton={false}
                >
                  {/* Custom User Location Marker */}
                  {userLocation && (
                    <Marker
                      coordinate={{
                        latitude: userLocation.coords.latitude,
                        longitude: userLocation.coords.longitude,
                      }}
                      title="Your Location"
                      anchor={{ x: 0.5, y: 0.5 }}
                    >
                      <View style={[styles.userMarkerWithCompass, { display: "flex" }]}>
                        {/* Compass Cone Direction Indicator */}
                        {isMagnetometerAvailable && (
                          <View
                            pointerEvents="none"
                            style={[
                              styles.compassConeContainer,
                              { transform: [{ rotate: `${(compassHeading - mapCameraHeading + 360) % 360}deg` }] },
                            ]}
                          >
                            <Svg width={80} height={80} viewBox="0 0 120 120">
                              <Path
                                d="M60,60 L60,8 A52,52 0 0,1 95,25 Z"
                                fill="rgba(59, 130, 246, 0.25)"
                              />
                              <Path
                                d="M60,60 L95,25 A52,52 0 0,1 100,40 Z"
                                fill="rgba(59, 130, 246, 0.25)"
                              />
                              <Path
                                d="M60,60 L25,25 A52,52 0 0,1 60,8 Z"
                                fill="rgba(59, 130, 246, 0.25)"
                              />
                              <Path
                                d="M60,60 L20,40 A52,52 0 0,1 25,25 Z"
                                fill="rgba(59, 130, 246, 0.25)"
                              />
                              <Polygon
                                points="60,10 55,30 60,25 65,30"
                                fill="rgba(59, 130, 246, 0.6)"
                              />
                            </Svg>
                          </View>
                        )}
                        {/* Beating Circle Animation */}
                        <Animated.View
                          style={[
                            styles.userLocationBeatingCircle,
                            {
                              transform: [{ scale: beatingScale1 }],
                              opacity: beatingOpacity1,
                            },
                          ]}
                        />
                        <Animated.View
                          style={[
                            styles.userLocationBeatingCircle,
                            {
                              transform: [{ scale: beatingScale2 }],
                              opacity: beatingOpacity2,
                            },
                          ]}
                        />
                        <Animated.View
                          style={[
                            styles.userLocationBeatingCircle,
                            {
                              transform: [{ scale: beatingScale3 }],
                              opacity: beatingOpacity3,
                            },
                          ]}
                        />

                        {/* User Pin Image */}
                        <Image
                          source={require("../../assets/images/user-pin.png")}
                          style={[styles.userMarkerIcon, { display: "flex" }]}
                          resizeMode="contain"
                        />
                      </View>
                    </Marker>
                  )}

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
                        <Image
                          source={require("@/assets/images/bus-icon.png")}
                          style={styles.busIcon}
                        />
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

            {/* Premium Route Selection Card */}
            <Animated.View
              style={[
                styles.routeCard,
                theme === "dark" && styles.routeCardDark,
                {
                  opacity: cardsOpacity,
                  transform: [{ translateY: cardsTranslateY }],
                },
              ]}
            >
              {/* Gradient Header */}
              <LinearGradient
                colors={theme === "dark"
                  ? ["#1F2937", "#111827"]
                  : ["#F8FAFC", "#F1F5F9"]}
                style={styles.routeHeader}
              >
                <View style={styles.routeHeaderLeft}>
                  <View style={styles.routeIconWrapper}>
                    <LinearGradient
                      colors={["#8B5CF6", "#7C3AED"]}
                      style={styles.routeIconGradient}
                    >
                      <Ionicons name="compass" size={18} color="#fff" />
                    </LinearGradient>
                  </View>
                  <View>
                    <Text style={[styles.routeTitle, { color: textColor }]}>
                      Plan Your Journey
                    </Text>
                    <Text style={[styles.routeSubtitle, { color: theme === "dark" ? "#9CA3AF" : "#6B7280" }]}>
                      Set your destination below
                    </Text>
                  </View>
                </View>
                {selectedRouteId && (
                  <LinearGradient
                    colors={["#10B981", "#059669"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.routeStatusBadge}
                  >
                    <Ionicons
                      name="checkmark-circle"
                      size={14}
                      color="#fff"
                    />
                    <Text style={styles.routeStatusText}>Ready</Text>
                  </LinearGradient>
                )}
              </LinearGradient>

              {/* Route Selection Message */}
              {selectedRouteMessage && (
                <LinearGradient
                  colors={["#3B82F6", "#2563EB"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.routeMessageContainer}
                >
                  <Ionicons name="information-circle" size={20} color="#fff" />
                  <Text style={styles.routeMessageText}>
                    {selectedRouteMessage}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setSelectedRouteMessage(null)}
                    style={styles.closeMessageButton}
                  >
                    <Ionicons name="close-circle" size={20} color="rgba(255,255,255,0.8)" />
                  </TouchableOpacity>
                </LinearGradient>
              )}

              {/* How to Complete a Ride - Instructions Section */}
              {!confirmedDestination && !selectedRouteId && (
                <View style={[styles.instructionsSection, theme === "dark" && styles.instructionsSectionDark]}>
                  <View style={styles.instructionsHeader}>
                    <Ionicons name="help-circle" size={18} color={theme === "dark" ? "#60A5FA" : "#3B82F6"} />
                    <Text style={[styles.instructionsTitle, { color: textColor }]}>
                      How to Complete a Ride
                    </Text>
                  </View>

                  {/* Option 1 - Set Destination First */}
                  <View style={styles.instructionOption}>
                    <View style={[styles.optionNumberBadge, { backgroundColor: theme === "dark" ? "#065F46" : "#ECFDF5" }]}>
                      <Text style={[styles.optionNumber, { color: "#10B981" }]}>1</Text>
                    </View>
                    <View style={styles.optionContent}>
                      <Text style={[styles.optionTitle, { color: textColor }]}>
                        Set Your Destination First
                      </Text>
                      <Text style={[styles.optionDescription, { color: theme === "dark" ? "#9CA3AF" : "#6B7280" }]}>
                        Tap "Destination" below → Pin your drop-off location → Tap "Find Best Route" to see available buses
                      </Text>
                    </View>
                  </View>

                  {/* Divider with OR */}
                  <View style={styles.orDividerContainer}>
                    <View style={[styles.orDividerLine, { backgroundColor: theme === "dark" ? "#374151" : "#E5E7EB" }]} />
                    <Text style={[styles.orDividerText, { color: theme === "dark" ? "#6B7280" : "#9CA3AF" }]}>OR</Text>
                    <View style={[styles.orDividerLine, { backgroundColor: theme === "dark" ? "#374151" : "#E5E7EB" }]} />
                  </View>

                  {/* Option 2 - View Route and Select */}
                  <View style={styles.instructionOption}>
                    <View style={[styles.optionNumberBadge, { backgroundColor: theme === "dark" ? "#1E3A5F" : "#EFF6FF" }]}>
                      <Text style={[styles.optionNumber, { color: "#3B82F6" }]}>2</Text>
                    </View>
                    <View style={styles.optionContent}>
                      <Text style={[styles.optionTitle, { color: textColor }]}>
                        Browse Routes Directly
                      </Text>
                      <Text style={[styles.optionDescription, { color: theme === "dark" ? "#9CA3AF" : "#6B7280" }]}>
                        View Routes Tab → Select Route → Choose your drop-off point on the route
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Destination Selection */}
              <View style={styles.destinationSection}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionLabelRow}>
                    <Ionicons
                      name="flag"
                      size={16}
                      color={dropoffLocation ? "#10B981" : (theme === "dark" ? "#9CA3AF" : "#6B7280")}
                    />
                    <Text style={[styles.sectionLabel, { color: textColor }]}>
                      Destination
                    </Text>
                  </View>
                  {dropoffLocation && (
                    <LinearGradient
                      colors={["#10B981", "#059669"]}
                      style={styles.destinationStatusBadge}
                    >
                      <Ionicons
                        name="checkmark"
                        size={12}
                        color="#fff"
                      />
                      <Text style={styles.destinationStatusText}>Set</Text>
                    </LinearGradient>
                  )}
                </View>
                <TouchableOpacity
                  style={[
                    styles.destinationContainer,
                    theme === "dark" && styles.destinationContainerDark,
                    dropoffLocation && styles.destinationContainerActive,
                  ]}
                  onPress={handleSetDestinationOnMap}
                  activeOpacity={0.7}
                >
                  <View style={styles.destinationIconWrapper}>
                    <LinearGradient
                      colors={dropoffLocation ? ["#10B981", "#059669"] : ["#6B7280", "#4B5563"]}
                      style={styles.destinationIconGradient}
                    >
                      <Ionicons
                        name="location"
                        size={18}
                        color="#fff"
                      />
                    </LinearGradient>
                  </View>
                  <View style={styles.destinationTextContainer}>
                    <Text
                      style={[
                        styles.destinationText,
                        { color: dropoffLocation ? textColor : (theme === "dark" ? "#9CA3AF" : "#6B7280") },
                      ]}
                      numberOfLines={2}
                    >
                      {dropoffLocation || "Tap to set your destination"}
                    </Text>
                    {dropoffLocation ? (
                      <View style={styles.destinationConfirmedRow}>
                        <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                        <Text style={styles.destinationSubtextConfirmed}>
                          Destination confirmed
                        </Text>
                      </View>
                    ) : (
                      <Text style={[styles.destinationSubtext, { color: theme === "dark" ? "#6B7280" : "#9CA3AF" }]}>
                        Select on interactive map
                      </Text>
                    )}
                  </View>
                  <View style={styles.destinationArrow}>
                    <Ionicons
                      name="chevron-forward"
                      size={20}
                      color={dropoffLocation ? "#10B981" : (theme === "dark" ? "#6B7280" : "#9CA3AF")}
                    />
                  </View>
                </TouchableOpacity>
              </View>

              {/* Premium Find Ride Button */}
              <TouchableOpacity
                style={styles.findRideButtonWrapper}
                onPress={handleFindRide}
                disabled={
                  !userLocation || (!confirmedDestination && !selectedRouteId)
                }
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={
                    userLocation && (confirmedDestination || selectedRouteId)
                      ? ["#3B82F6", "#2563EB", "#1D4ED8"]
                      : ["#9CA3AF", "#6B7280"]
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.findRideButton}
                >
                  <View style={styles.findRideIconWrapper}>
                    <Ionicons
                      name={selectedRouteId ? "bus" : "search"}
                      size={22}
                      color="#fff"
                    />
                  </View>
                  <Text style={styles.findRideButtonText}>
                    {!userLocation
                      ? "Getting your location..."
                      : selectedRouteId
                        ? "Continue to Bus Selection"
                        : !confirmedDestination
                          ? "Set destination first"
                          : "Find Best Route"}
                  </Text>
                  <Ionicons name="arrow-forward" size={20} color="rgba(255,255,255,0.8)" />
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>

            {/* Premium Nearby Buses Section */}
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
                <View style={styles.nearbyIconWrapper}>
                  <LinearGradient
                    colors={buses.length > 0 ? ["#F59E0B", "#D97706"] : ["#6B7280", "#4B5563"]}
                    style={styles.nearbyIconGradient}
                  >
                    <Ionicons name="bus" size={18} color="#fff" />
                  </LinearGradient>
                </View>
                <View style={styles.nearbyTextContainer}>
                  <Text style={[styles.nearbyTitle, { color: textColor }]}>
                    Nearby Mini Buses
                  </Text>
                  <Text style={[styles.nearbySubtitle, { color: theme === "dark" ? "#9CA3AF" : "#6B7280" }]}>
                    {buses.length > 0
                      ? `${buses.length} mini bus${buses.length !== 1 ? "es" : ""} within 5km`
                      : "No mini buses found nearby"}
                  </Text>
                </View>
                {buses.length > 0 && (
                  <LinearGradient
                    colors={["#EF4444", "#DC2626"]}
                    style={styles.liveIndicator}
                  >
                    <View style={styles.liveDotAnimated} />
                    <Text style={styles.liveText}>LIVE</Text>
                  </LinearGradient>
                )}
              </View>

              {buses.length > 0 ? (
                <View style={styles.busesList}>
                  {buses.map((bus, index) => {
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
                        style={[
                          styles.busItemCard,
                          theme === "dark" && styles.busItemCardDark
                        ]}
                      >
                        <View style={styles.busItemContent}>
                          {/* Left Icon Section with Gradient */}
                          <View style={styles.busIconContainer}>
                            <LinearGradient
                              colors={["#3B82F6", "#2563EB"]}
                              style={styles.busIconGradient}
                            >
                              <Ionicons name="bus" size={22} color="#fff" />
                            </LinearGradient>
                          </View>

                          {/* Middle Info Section */}
                          <View style={styles.busInfo}>
                            <Text style={[styles.busPlate, { color: textColor }]}>
                              {bus.plateNumber}
                            </Text>
                            <View style={styles.busMetaContainer}>
                              <LinearGradient
                                colors={["rgba(59, 130, 246, 0.15)", "rgba(37, 99, 235, 0.1)"]}
                                style={styles.distanceBadge}
                              >
                                <Ionicons name="navigate" size={12} color="#3B82F6" />
                                <Text style={styles.distanceText}>
                                  {distance > 0 ? `${distance.toFixed(1)} km` : "Nearby"}
                                </Text>
                              </LinearGradient>
                              <View style={styles.statusBadge}>
                                <View style={styles.activeStatusDot} />
                                <Text style={[styles.busStatusText, { color: "#10B981" }]}>
                                  Active
                                </Text>
                              </View>
                            </View>
                          </View>

                          {/* Right Action Section - Premium Track Button */}
                          <TouchableOpacity
                            style={styles.trackButtonWrapper}
                            onPress={() => {
                              // Scroll to top to show the map
                              scrollViewRef.current?.scrollTo({ y: 0, animated: true });
                              // Animate map to the bus location
                              setTimeout(() => {
                                mapRef.current?.animateToRegion({
                                  latitude: bus.currentLocation.latitude,
                                  longitude: bus.currentLocation.longitude,
                                  latitudeDelta: 0.005,
                                  longitudeDelta: 0.005,
                                }, 1000);
                              }, 300);
                            }}
                            activeOpacity={0.7}
                          >
                            <LinearGradient
                              colors={["#3B82F6", "#2563EB"]}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 1, y: 0 }}
                              style={styles.trackButton}
                            >
                              <Text style={styles.trackButtonText}>Track</Text>
                              <Ionicons name="locate" size={14} color="#fff" />
                            </LinearGradient>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <View style={[styles.noBusesContainer, theme === "dark" && styles.noBusesContainerDark]}>
                  <LinearGradient
                    colors={["rgba(107, 114, 128, 0.1)", "rgba(75, 85, 99, 0.05)"]}
                    style={styles.noBusesIconWrapper}
                  >
                    <Ionicons name="bus-outline" size={36} color={theme === "dark" ? "#6B7280" : "#9CA3AF"} />
                  </LinearGradient>
                  <Text style={[styles.noBusesText, { color: textColor }]}>
                    No minibuses nearby
                  </Text>
                  <Text style={[styles.noBusesSubtext, { color: theme === "dark" ? "#6B7280" : "#9CA3AF" }]}>
                    Check back soon for available buses
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
              showsUserLocation={false}
              showsMyLocationButton={false}
            >
              {/* Custom User Location Marker */}
              {userLocation && (
                <Marker
                  coordinate={{
                    latitude: userLocation.coords.latitude,
                    longitude: userLocation.coords.longitude,
                  }}
                  title="Your Location"
                  anchor={{ x: 0.5, y: 0.5 }}
                >
                  <View style={styles.userMarkerWithCompass}>
                    {/* Compass Cone Direction Indicator */}
                    {isMagnetometerAvailable && (
                      <View
                        pointerEvents="none"
                        style={[
                          styles.compassConeContainer,
                          { transform: [{ rotate: `${compassHeading}deg` }] },
                        ]}
                      >
                        <Svg width={70} height={70} viewBox="0 0 120 120">
                          <Path
                            d="M60,60 L60,8 A52,52 0 0,1 95,25 Z"
                            fill="rgba(59, 130, 246, 0.25)"
                          />
                          <Path
                            d="M60,60 L95,25 A52,52 0 0,1 100,40 Z"
                            fill="rgba(59, 130, 246, 0.25)"
                          />
                          <Path
                            d="M60,60 L25,25 A52,52 0 0,1 60,8 Z"
                            fill="rgba(59, 130, 246, 0.25)"
                          />
                          <Path
                            d="M60,60 L20,40 A52,52 0 0,1 25,25 Z"
                            fill="rgba(59, 130, 246, 0.25)"
                          />
                          <Polygon
                            points="60,10 55,30 60,25 65,30"
                            fill="rgba(59, 130, 246, 0.6)"
                          />
                        </Svg>
                      </View>
                    )}
                    {/* Beating Circle Animation */}
                    <Animated.View
                      style={[
                        styles.userLocationBeatingCircle,
                        {
                          transform: [{ scale: beatingScale1 }],
                          opacity: beatingOpacity1,
                        },
                      ]}
                    />
                    <Animated.View
                      style={[
                        styles.userLocationBeatingCircle,
                        {
                          transform: [{ scale: beatingScale2 }],
                          opacity: beatingOpacity2,
                        },
                      ]}
                    />
                    <Animated.View
                      style={[
                        styles.userLocationBeatingCircle,
                        {
                          transform: [{ scale: beatingScale3 }],
                          opacity: beatingOpacity3,
                        },
                      ]}
                    />

                    {/* User Pin Image */}
                    <Image
                      source={require("../../assets/images/user-pin.png")}
                      style={styles.userMarkerIcon}
                      resizeMode="contain"
                    />
                  </View>
                </Marker>
              )}

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
                    <Image
                      source={require("@/assets/images/bus-icon.png")}
                      style={styles.busIcon}
                    />
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
                  anchor={{ x: 0.5, y: 1 }}
                >
                  <View style={styles.destinationMarkerContainer}>
                    <Image
                      source={require("../../assets/images/destination-flag.png")}
                      style={[styles.destinationIcon, { display: "flex" }]}
                      resizeMode="contain"
                    />
                  </View>
                </Marker>
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

      <Modal
        animationType="slide"
        transparent={true}
        visible={showPendingRequestModal}
        onRequestClose={() => setShowPendingRequestModal(false)}
      >
        <BlurView intensity={theme === 'dark' ? 80 : 40} style={styles.modalOverlay}>
          <View style={[styles.modalContent, theme === "dark" && styles.modalContentDark, { paddingBottom: 30 }]}>
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <LinearGradient
                colors={["#F59E0B", "#D97706"]}
                style={styles.pendingIconContainer}
              >
                <Ionicons name="time" size={32} color="#fff" />
              </LinearGradient>
              <Text style={[styles.modalTitle, { color: textColor, marginTop: 15 }]}>
                Request Pending
              </Text>
            </View>

            <Text style={[styles.modalText, { textAlign: 'center', marginBottom: 30, lineHeight: 22, color: theme === 'dark' ? '#D1D5DB' : '#4B5563' }]}>
              Your pickup request for <Text style={{ fontWeight: 'bold', color: primaryColor }}>Bus {pendingRequestData?.plateNumber}</Text> is still waiting for approval from the driver.
              {"\n\n"}
              Please wait a moment while the driver reviews your request.
            </Text>

            <View style={styles.modalButtonGroup}>
              <TouchableOpacity
                style={styles.modalButtonSecondary}
                onPress={async () => {
                  try {
                    // Cancel the pickup request first
                    if (pendingRequestData?.request?.id) {
                      const { error: requestError } = await supabase
                        .from("pickup_requests")
                        .update({ status: "cancelled" })
                        .eq("id", pendingRequestData.request.id);

                      if (requestError) {
                        //console.error("Error cancelling pickup request:", requestError);
                      } else {
                        //console.log("✅ Pickup request cancelled successfully");
                      }
                    }

                    // Also cancel any trip_passengers record if it exists
                    if (pendingRequestData?.tpRecordId) {
                      const { error: tpError } = await supabase
                        .from("trip_passengers")
                        .update({ status: "cancelled" })
                        .eq("id", pendingRequestData.tpRecordId);

                      if (tpError) {
                        //console.error("Error cancelling trip passenger:", tpError);
                      } else {
                        //console.log("✅ Trip passenger record cancelled successfully");
                      }
                    }

                    setShowPendingRequestModal(false);
                    setPendingRequestData(null);
                  } catch (error) {
                    //console.error("Error during cancellation:", error);
                    Alert.alert("Error", "Could not cancel the request. Please try again.");
                  }
                }}
              >
                <Text style={styles.modalButtonSecondaryText}>Cancel Request</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalButtonPrimary}
                onPress={() => {
                  // Mark this request as handled/ignored so it doesn't pop up again immediately
                  if (pendingRequestData?.request?.id) {
                    ignoredRequestIdRef.current = pendingRequestData.request.id;
                  }
                  setShowPendingRequestModal(false);
                  router.push({
                    pathname: "/route-details",
                    params: {
                      restorePickupRequestId: pendingRequestData.request.id,
                      originLat: pendingRequestData.request.pickup_lat.toString(),
                      originLng: pendingRequestData.request.pickup_lng.toString(),
                      destLat: pendingRequestData.request.dest_lat.toString(),
                      destLng: pendingRequestData.request.dest_lng.toString(),
                      routeId: pendingRequestData.routeId
                    }
                  });
                }}
              >
                <LinearGradient
                  colors={["#3B82F6", "#2563EB"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.modalButtonGradient}
                >
                  <Text style={styles.modalButtonPrimaryText}>Go to Waiting Screen</Text>
                  <Ionicons name="chevron-forward" size={18} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </BlurView>
      </Modal>

      {/* Continue Trip Modal - Premium UI */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={showContinueTripModal}
        onRequestClose={() => setShowContinueTripModal(false)}
      >
        <BlurView intensity={theme === 'dark' ? 80 : 50} style={styles.modalOverlay}>
          <View style={[styles.continueTripModalContent, theme === "dark" && styles.modalContentDark]}>
            {/* Decorative Background Elements */}
            <View style={styles.continueTripDecoCircle1} />
            <View style={styles.continueTripDecoCircle2} />

            {/* Icon Container with Animation-style Background */}
            <View style={styles.continueTripIconWrapper}>
              <LinearGradient
                colors={["#3B82F6", "#2563EB", "#1D4ED8"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.continueTripIconContainer}
              >
                <Ionicons name="bus" size={36} color="#fff" />
              </LinearGradient>
              {/* Pulse rings */}
              <View style={styles.continueTripPulseRing1} />
              <View style={styles.continueTripPulseRing2} />
            </View>

            {/* Title */}
            <Text style={[styles.continueTripTitle, { color: textColor }]}>
              Continue Your Trip?
            </Text>

            {/* Trip Info Card */}
            <View style={[styles.continueTripInfoCard, theme === "dark" && { backgroundColor: 'rgba(59, 130, 246, 0.1)', borderColor: 'rgba(59, 130, 246, 0.2)' }]}>
              <View style={styles.continueTripInfoRow}>
                <View style={styles.continueTripInfoIcon}>
                  <Ionicons name="bus-outline" size={18} color="#3B82F6" />
                </View>
                <View style={styles.continueTripInfoTextContainer}>
                  <Text style={[styles.continueTripInfoLabel, { color: theme === "dark" ? "#9CA3AF" : "#6B7280" }]}>
                    Bus Number
                  </Text>
                  <Text style={[styles.continueTripInfoValue, { color: textColor }]}>
                    {existingTripData?.plateNumber || "Unknown"}
                  </Text>
                </View>
              </View>

              <View style={styles.continueTripInfoDivider} />

              <View style={styles.continueTripInfoRow}>
                <View style={[styles.continueTripInfoIcon, { backgroundColor: theme === "dark" ? 'rgba(16, 185, 129, 0.15)' : '#ECFDF5' }]}>
                  <Ionicons name="navigate-outline" size={18} color="#10B981" />
                </View>
                <View style={styles.continueTripInfoTextContainer}>
                  <Text style={[styles.continueTripInfoLabel, { color: theme === "dark" ? "#9CA3AF" : "#6B7280" }]}>
                    Status
                  </Text>
                  <View style={styles.continueTripStatusBadge}>
                    <View style={styles.continueTripStatusDot} />
                    <Text style={styles.continueTripStatusText}>In Progress</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Description */}
            <Text style={[styles.continueTripDescription, { color: theme === "dark" ? "#9CA3AF" : "#6B7280" }]}>
              You have an ongoing trip. Would you like to continue where you left off or start a new journey?
            </Text>

            {/* Action Buttons */}
            <View style={styles.continueTripButtonGroup}>
              {/* Secondary Button - Start New */}
              <TouchableOpacity
                style={[styles.continueTripButtonSecondary, theme === "dark" && { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)' }]}
                onPress={() => {
                  setShowContinueTripModal(false);
                  if (existingTripData?.trip?.id) {
                    cancelExistingTrip(existingTripData.trip.id);
                  }
                  setExistingTripData(null);
                }}
              >
                <Ionicons name="close-circle-outline" size={20} color="#EF4444" />
                <Text style={styles.continueTripButtonSecondaryText}>Start New</Text>
              </TouchableOpacity>

              {/* Primary Button - Continue */}
              <TouchableOpacity
                style={styles.continueTripButtonPrimary}
                onPress={() => {
                  setShowContinueTripModal(false);
                  if (existingTripData?.trip) {
                    continueExistingTrip(existingTripData.trip);
                  }
                  setExistingTripData(null);
                }}
              >
                <LinearGradient
                  colors={["#3B82F6", "#2563EB"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.continueTripButtonGradient}
                >
                  <Text style={styles.continueTripButtonPrimaryText}>Continue Trip</Text>
                  <Ionicons name="arrow-forward" size={18} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </BlurView>
      </Modal>

      {/* Premium Welcome Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={showWelcomeModal}
        onRequestClose={handleModalDismiss}
      >
        <BlurView intensity={50} style={styles.modalOverlay}>
          <View style={[styles.modalContent, theme === "dark" && styles.modalContentDark]}>
            {/* Premium Gradient Icon */}
            <LinearGradient
              colors={["#3B82F6", "#2563EB", "#1D4ED8"]}
              style={styles.modalIconContainer}
            >
              <Ionicons name="bus" size={48} color="#fff" />
            </LinearGradient>

            <Text style={[styles.modalTitle, { color: textColor }]}>
              Welcome to Miniway!
            </Text>
            <Text style={[styles.modalTagline, { color: theme === "dark" ? "#60A5FA" : "#3B82F6" }]}>
              Your smart transit companion
            </Text>
            <Text style={[styles.modalText, { color: theme === "dark" ? "#9CA3AF" : "#6B7280" }]}>
              Track minibuses in real-time and travel smarter with intelligent route planning.
            </Text>

            <View style={styles.modalFeatures}>
              <View style={styles.modalFeature}>
                <LinearGradient colors={["#10B981", "#059669"]} style={styles.featureIconGradient}>
                  <Ionicons name="location" size={18} color="#fff" />
                </LinearGradient>
                <View style={styles.featureTextContainer}>
                  <Text style={[styles.modalFeatureTitle, { color: textColor }]}>
                    Real-time Tracking
                  </Text>
                  <Text style={[styles.modalFeatureSubtext, { color: theme === "dark" ? "#9CA3AF" : "#6B7280" }]}>
                    See buses move live on map
                  </Text>
                </View>
              </View>
              <View style={styles.modalFeature}>
                <LinearGradient colors={["#8B5CF6", "#7C3AED"]} style={styles.featureIconGradient}>
                  <Ionicons name="compass" size={18} color="#fff" />
                </LinearGradient>
                <View style={styles.featureTextContainer}>
                  <Text style={[styles.modalFeatureTitle, { color: textColor }]}>
                    Smart Planning
                  </Text>
                  <Text style={[styles.modalFeatureSubtext, { color: theme === "dark" ? "#9CA3AF" : "#6B7280" }]}>
                    Intelligent route suggestions
                  </Text>
                </View>
              </View>
              <View style={styles.modalFeature}>
                <LinearGradient colors={["#F59E0B", "#D97706"]} style={styles.featureIconGradient}>
                  <Ionicons name="time" size={18} color="#fff" />
                </LinearGradient>
                <View style={styles.featureTextContainer}>
                  <Text style={[styles.modalFeatureTitle, { color: textColor }]}>
                    Live ETAs
                  </Text>
                  <Text style={[styles.modalFeatureSubtext, { color: theme === "dark" ? "#9CA3AF" : "#6B7280" }]}>
                    Accurate arrival times
                  </Text>
                </View>
              </View>
            </View>

            <TouchableOpacity
              style={styles.modalButtonWrapper}
              onPress={handleModalDismiss}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={["#3B82F6", "#2563EB", "#1D4ED8"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.modalButton}
              >
                <Text style={styles.modalButtonText}>
                  Get Started
                </Text>
                <Ionicons name="arrow-forward" size={20} color="#fff" />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </BlurView>
      </Modal>

      {/* Pin Dropping UI */}
      {isPinDroppingMode && (
        <>
          {/* <View
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
          </View> */}
          <View style={styles.pinActionWrapper}>
            <LinearGradient
              colors={theme === "dark"
                ? ["rgba(31, 41, 55, 0.95)", "rgba(17, 24, 39, 0.98)"]
                : ["rgba(255, 255, 255, 0.95)", "rgba(248, 250, 252, 0.98)"]}
              style={styles.pinActionContainer}
            >
              {/* Status indicator when pin is dropped */}
              {droppedPinLocation && (
                <View style={styles.pinStatusIndicator}>
                  <View style={styles.pinStatusDot} />
                  <Text style={styles.pinStatusText}>Pin placed - Ready to confirm</Text>
                </View>
              )}

              <View style={styles.pinActionButtonsRow}>
                <TouchableOpacity
                  style={[styles.pinActionButton, styles.cancelButton]}
                  onPress={handleCancelPinDrop}
                  activeOpacity={0.8}
                >
                  <Ionicons name="close-circle-outline" size={20} color="#fff" />
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
                  activeOpacity={0.8}
                >
                  {isGeocoding ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Ionicons
                        name={droppedPinLocation ? "checkmark-circle" : "location-outline"}
                        size={20}
                        color="#fff"
                      />
                      <Text style={styles.pinActionButtonText}>
                        {droppedPinLocation ? "Confirm Destination" : "Drop a Pin First"}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </LinearGradient>
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

  // Enhanced Pin Drop Header Styles
  pinDropHeaderContainer: {
    zIndex: 1001,
  },
  pinDropHeaderGradient: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingTop: 50, // Account for status bar
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    position: "relative",
    overflow: "hidden",
  },
  pinDropDecorCircle1: {
    position: "absolute",
    top: -40,
    right: -40,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  pinDropDecorCircle2: {
    position: "absolute",
    top: 60,
    right: 30,
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  pinDropHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pinDropInstructionsContainer: {
    marginTop: 16,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  pinDropStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  pinDropStepNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(255, 255, 255, 0.25)",
    justifyContent: "center",
    alignItems: "center",
  },
  pinDropStepNumberText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
  },
  pinDropStepText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
    color: "#fff",
    lineHeight: 18,
  },
  pinDropWarningBanner: {
    marginTop: 14,
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.3)",
  },
  pinDropWarningIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(245, 158, 11, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  pinDropWarningText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "500",
    color: "#fff",
    lineHeight: 18,
  },
  pinDropWarningBold: {
    fontWeight: "800",
    color: "#FCD34D",
  },
  // Collapsible Instructions Header
  pinDropInstructionsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 14,
  },
  pinDropInstructionsHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  pinDropInstructionsHeaderText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  pinDropInstructionsToggle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    justifyContent: "center",
    alignItems: "center",
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
    borderRadius: 20,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.04)",
  },
  routeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  routeHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  routeTitle: {
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  routeStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    gap: 4,
  },
  routeStatusText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.3,
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
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  destinationStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    gap: 4,
  },
  destinationStatusText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.3,
  },
  destinationContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1.5,
    borderColor: "rgba(0, 0, 0, 0.08)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  destinationTextContainer: {
    flex: 1,
    marginLeft: 0,
  },
  destinationText: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
    lineHeight: 20,
  },
  destinationSubtext: {
    fontSize: 13,
    fontWeight: "400",
    marginTop: 2,
  },

  // Find Ride Button
  findRideButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 16,
    marginHorizontal: 18,
    marginBottom: 12,
    gap: 4,
  },
  findRideButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    flex: 1,
    textAlign: "center",
    letterSpacing: 0.3,
  },

  // Nearby Section Styles
  nearbySection: {
    marginTop: 8,
    paddingBottom: 20,
  },
  nearbyHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  nearbyTextContainer: {
    flex: 1,
    marginLeft: 0,
  },
  nearbyTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 3,
    letterSpacing: -0.3,
  },
  nearbySubtitle: {
    fontSize: 13,
    fontWeight: "400",
  },
  liveIndicator: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    gap: 4,
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
    flex: 1,
    marginLeft: 0,
  },
  busPlate: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  busStatus: {
    color: "#666",
  },

  // Enhanced Bus Item Styles
  busItemCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.04)",
    overflow: "hidden",
  },
  busItemContent: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
  },
  busIconContainer: {
    marginRight: 14,
  },
  busMetaContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 5,
    gap: 10,
  },
  distanceBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 5,
  },
  distanceText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#3B82F6",
  },
  busStatusText: {
    fontSize: 12,
    fontWeight: "500",
  },
  trackButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    gap: 5,
  },
  trackButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#fff",
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
  // Enhanced Pin Action Container
  pinActionWrapper: {
    position: "absolute",
    bottom: 30, // Navbar is hidden in pin dropping mode, so we can position lower
    left: 15,
    right: 15,
    zIndex: 1002,
  },
  pinActionContainer: {
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.2)",
  },
  pinStatusIndicator: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    gap: 8,
  },
  pinStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#10B981",
  },
  pinStatusText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#10B981",
  },
  pinActionButtonsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  pinActionButton: {
    flex: 1,
    flexDirection: "row",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  confirmButton: {
    backgroundColor: "#3B82F6",
    flex: 1.5,
  },
  confirmButtonActive: {
    backgroundColor: "#10B981",
  },
  cancelButton: {
    backgroundColor: "#6B7280",
    flex: 0.8,
  },
  disabledButton: {
    backgroundColor: "#9CA3AF",
    opacity: 0.7,
  },
  pinActionButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.3,
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
  busIcon: { width: 34, height: 34 },
  // Marker Styles
  markerContainer: {
    padding: 8,
  },  // User Marker Styles
  userMarkerContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  userMarkerIcon: {
    width: 44,
    height: 44,
    zIndex: 3,
  },

  // Destination Marker Styles
  destinationMarkerContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  destinationIcon: {
    width: 48,
    height: 48,
    zIndex: 3,
  },

  // Beating Circle Animation Style
  userLocationBeatingCircle: {
    position: "absolute",
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0, 122, 255, 0.2)",
    borderWidth: 1,
    borderColor: "rgba(0, 122, 255, 0.4)",
  },

  // Welcome Modal Styles
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "90%",
    maxWidth: 400,
    borderRadius: 28,
    padding: 28,
    alignItems: "center",
    backgroundColor: "#ffffff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 20,
  },
  modalContentDark: {
    backgroundColor: "#1F2937",
  },
  modalIconContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 8,
    textAlign: "center",
    letterSpacing: -0.5,
  },
  modalTagline: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 16,
    textAlign: "center",
  },
  modalText: {
    fontSize: 15,
    textAlign: "center",
    marginBottom: 28,
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  modalFeatures: {
    width: "100%",
    marginBottom: 28,
    gap: 16,
  },
  modalFeature: {
    flexDirection: "row",
    alignItems: "center",
  },
  featureIconGradient: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  featureTextContainer: {
    flex: 1,
  },
  modalFeatureTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 2,
  },
  modalFeatureSubtext: {
    fontSize: 13,
    fontWeight: "400",
  },
  modalFeatureText: {
    fontSize: 15,
    fontWeight: "500",
    marginLeft: 12,
  },
  modalButtonWrapper: {
    width: "100%",
  },
  modalButton: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 28,
    justifyContent: "center",
    gap: 10,
  },
  modalButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 17,
    letterSpacing: 0.3,
  },

  // Premium Header Styles
  headerWrapper: {
    overflow: "hidden",
  },
  headerGradient: {
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    position: "relative",
    overflow: "hidden",
  },
  headerDecorativeCircle1: {
    position: "absolute",
    top: -30,
    right: -30,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  headerDecorativeCircle2: {
    position: "absolute",
    top: 40,
    right: 50,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  headerIconGradient: {
    width: 50,
    height: 50,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  headerBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 5,
  },
  headerBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#10B981",
  },
  headerBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.5,
  },

  // Premium Status Card Styles
  statusCardDark: {
    backgroundColor: "#1F2937",
    borderColor: "#374151",
  },
  statusCardGradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
  },
  statusIconWrapper: {
    marginRight: 10,
  },
  statusIconGradient: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  coordinatesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  busCountContainer: {
    alignItems: "center",
    marginBottom: 8,
  },
  busCountNumber: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  busCountLabel: {
    fontSize: 12,
    fontWeight: "500",
  },
  statusDivider: {
    height: 1,
    backgroundColor: "rgba(0, 0, 0, 0.05)",
    marginVertical: 8,
  },
  pulsingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#10B981",
    marginRight: 6,
  },

  // Premium Map Card Styles
  mapCardDark: {
    backgroundColor: "#1F2937",
    borderColor: "#374151",
  },
  mapIconWrapper: {
    marginRight: 12,
  },
  mapIconGradient: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  mapSubtitle: {
    fontSize: 12,
    fontWeight: "400",
    marginTop: 2,
  },
  mapActionGradient: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },

  // Premium Route Card Styles
  routeCardDark: {
    backgroundColor: "#1F2937",
    borderColor: "#374151",
  },
  routeIconWrapper: {
    marginRight: 12,
  },
  routeIconGradient: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  routeSubtitle: {
    fontSize: 13,
    fontWeight: "400",
    marginTop: 2,
  },
  sectionLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  destinationContainerDark: {
    backgroundColor: "#1F2937",
    borderColor: "#374151",
  },
  destinationContainerActive: {
    borderColor: "#10B981",
    borderWidth: 2,
  },
  destinationIconWrapper: {
    marginRight: 14,
  },
  destinationIconGradient: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  destinationConfirmedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  destinationSubtextConfirmed: {
    fontSize: 13,
    fontWeight: "600",
    color: "#10B981",
  },
  destinationArrow: {
    marginLeft: 8,
  },
  findRideButtonWrapper: {
    width: "100%",
  },
  findRideIconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },

  // Instructions Section Styles
  instructionsSection: {
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderStyle: "dashed",
  },
  instructionsSectionDark: {
    backgroundColor: "rgba(30, 58, 95, 0.3)",
    borderColor: "#374151",
  },
  instructionsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  instructionsTitle: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  instructionOption: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 8,
  },
  optionNumberBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
  },
  optionNumber: {
    fontSize: 14,
    fontWeight: "800",
  },
  optionContent: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  optionDescription: {
    fontSize: 12,
    fontWeight: "400",
    lineHeight: 18,
  },
  orDividerContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 10,
    paddingHorizontal: 8,
  },
  orDividerLine: {
    flex: 1,
    height: 1,
  },
  orDividerText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginHorizontal: 12,
  },

  // Premium Nearby Section Styles
  nearbyIconWrapper: {
    marginRight: 14,
  },
  nearbyIconGradient: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  liveDotAnimated: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#fff",
    marginRight: 5,
  },
  busItemCardDark: {
    backgroundColor: "#1F2937",
    borderColor: "#374151",
  },
  busIconGradient: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
  },
  activeStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#10B981",
    marginRight: 5,
  },
  trackButtonWrapper: {
    overflow: "hidden",
    borderRadius: 20,
  },
  noBusesContainerDark: {
    backgroundColor: "rgba(31, 41, 55, 0.5)",
    borderColor: "#374151",
  },
  noBusesIconWrapper: {
    width: 72,
    height: 72,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  pendingIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#F59E0B",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  modalButtonGroup: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  modalButtonPrimary: {
    flex: 1.2,
    borderRadius: 14,
    overflow: "hidden",
  },
  modalButtonSecondary: {
    flex: 0.8,
    borderRadius: 14,
    backgroundColor: "rgba(156, 163, 175, 0.1)",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 14,
  },
  modalButtonGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    gap: 8,
  }, modalButtonPrimaryText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 12,
  },
  modalButtonSecondaryText: {
    color: "#9CA3AF",
    fontWeight: "600",
    fontSize: 12,
  },

  // Continue Trip Modal Styles
  continueTripModalContent: {
    width: "90%",
    maxWidth: 380,
    borderRadius: 28,
    padding: 28,
    alignItems: "center",
    backgroundColor: "#ffffff",
    shadowColor: "#3B82F6",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.2,
    shadowRadius: 32,
    elevation: 24,
    overflow: "hidden",
    position: "relative",
  },
  continueTripDecoCircle1: {
    position: "absolute",
    top: -60,
    right: -60,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(59, 130, 246, 0.08)",
  },
  continueTripDecoCircle2: {
    position: "absolute",
    bottom: -40,
    left: -40,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(59, 130, 246, 0.05)",
  },
  continueTripIconWrapper: {
    position: "relative",
    marginBottom: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  continueTripIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#3B82F6",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
    zIndex: 2,
  },
  continueTripPulseRing1: {
    position: "absolute",
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 2,
    borderColor: "rgba(59, 130, 246, 0.2)",
    zIndex: 1,
  },
  continueTripPulseRing2: {
    position: "absolute",
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.1)",
    zIndex: 0,
  },
  continueTripTitle: {
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 20,
    textAlign: "center",
    letterSpacing: -0.5,
  },
  continueTripInfoCard: {
    width: "100%",
    backgroundColor: "#F0F9FF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#BAE6FD",
  },
  continueTripInfoRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  continueTripInfoIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#DBEAFE",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  continueTripInfoTextContainer: {
    flex: 1,
  },
  continueTripInfoLabel: {
    fontSize: 12,
    fontWeight: "500",
    marginBottom: 2,
  },
  continueTripInfoValue: {
    fontSize: 16,
    fontWeight: "700",
  },
  continueTripInfoDivider: {
    height: 1,
    backgroundColor: "rgba(59, 130, 246, 0.15)",
    marginVertical: 12,
  },
  continueTripStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: "flex-start",
  },
  continueTripStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#10B981",
    marginRight: 6,
  },
  continueTripStatusText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#059669",
  },
  continueTripDescription: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 21,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  continueTripButtonGroup: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  continueTripButtonSecondary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: 14,
    paddingVertical: 14,
  },
  continueTripButtonSecondaryText: {
    color: "#EF4444",
    fontWeight: "600",
    fontSize: 13,
  },
  continueTripButtonPrimary: {
    flex: 1.3,
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: "#3B82F6",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  continueTripButtonGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    gap: 8,
  },
  continueTripButtonPrimaryText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },

  // Compass Direction Indicator Styles
  userMarkerWithCompass: {
    width: 80,
    height: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  compassConeContainer: {
    position: "absolute",
    width: 80,
    height: 80,
    justifyContent: "center",
    alignItems: "center",
  },
});

export default CommuterHomeScreen;
