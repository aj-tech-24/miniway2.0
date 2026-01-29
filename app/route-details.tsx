import SafeText from "@/components/SafeText";
import { mapDarkStyle } from "@/constants/mapDarkStyle";
import { useAuth } from "@/contexts/AuthContext";
import { useBusesOnRoute, useCurrentRoute, useRoute } from "@/contexts/RouteContext";
import { useAppTheme } from "@/contexts/ThemeContext";
import { useThemeColor } from "@/hooks/useThemeColor";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  InteractionManager,
  LayoutAnimation,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  Vibration,
  View
} from "react-native";
import MapView, { Camera, LatLng, Marker, Polyline } from "react-native-maps";
import Svg, { Path, Polygon } from "react-native-svg";

// --- Constants for Short Distance Testing ---
// NOTE: Keep these conservative to avoid excessive re-renders/animations on Android.
const LOCATION_UPDATE_INTERVAL = 750; // ms
const CAMERA_ANIMATION_DURATION = 500; // ms
const MARKER_ANIMATION_DURATION = 700; // ms
const DISTANCE_THRESHOLD = 5; // meters

// --- Helper Functions ---
const decodePolyline = (encoded: string) => {
  const poly = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let b;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    poly.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return poly;
};

// --- Data Types ---
type Driver = {
  id: string;
  fullName: string;
};

type Bus = {
  id: string;
  plate_number: string;
  route_id: string;
  status: "active" | "inactive" | "waiting";
  location: LatLng | null;
  driver: Driver | null;
  capacity?: number | null;
  passengers?: number | null;
};

type Route = {
  id: string;
  name: string;
  start_address?: string | null;
  end_address?: string | null;
  path: {
    type: "LineString";
    coordinates: [number, number][];
  };
};

// --- Helper Functions ---
const calculateBearing = (start: LatLng, end: LatLng) => {
  const toRadians = (deg: number) => deg * (Math.PI / 180);
  const toDegrees = (rad: number) => rad * (180 / Math.PI);
  const lat1 = toRadians(start.latitude);
  const lon1 = toRadians(start.longitude);
  const lat2 = toRadians(end.latitude);
  const lon2 = toRadians(end.longitude);
  const deltaLon = lon2 - lon1;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  let bearing = toDegrees(Math.atan2(y, x));
  bearing = (bearing + 360) % 360;
  return bearing;
};

const getCurrentLocation = async (
  setCurrentLocation: (location: LatLng) => void,
  setLocationLoading: (loading: boolean) => void,
  setShowLocationPermissionAlert: (show: boolean) => void
) => {
  try {
    setLocationLoading(true);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      setShowLocationPermissionAlert(true);
      return;
    }

    // Check for cached location first for faster response
    const lastKnownPosition = await Location.getLastKnownPositionAsync({
      maxAge: 30000, // 30 seconds
      requiredAccuracy: 100, // 100 meters accuracy is acceptable
    });

    if (lastKnownPosition) {
      const currentLatLng: LatLng = {
        latitude: lastKnownPosition.coords.latitude,
        longitude: lastKnownPosition.coords.longitude,
      };
      setCurrentLocation(currentLatLng);
      setLocationLoading(false);
    }

    // Get more accurate current position
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced, // Balanced accuracy for faster response
    });
    const currentLatLng: LatLng = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    };
    setCurrentLocation(currentLatLng);
  } catch (error) {
    //console.error("Error getting location:", error);
    Alert.alert(
      "Location Error",
      "Unable to get your current location. Please try again or select a location on the map.",
      [{ text: "OK" }]
    );
  } finally {
    setLocationLoading(false);
  }
};

const AvailableSeatsColor = (seats: number) => {
  if (seats > 5) return "#4CAF50";
  if (seats > 2) return "#FFC107";
  return "#FF5252";
};

// --- Clamp to Route Constants and Helpers ---
// Clamp threshold in meters - if bus is within this distance of route, snap to it
const ROUTE_CLAMP_THRESHOLD = 20; // 20 meters

// Helper: Calculate distance between two LatLng points (Haversine formula)
const getDistance = (a: LatLng, b: LatLng): number => {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;

  const x = dLat / 2;
  const y = dLon / 2;
  const aVal =
    Math.sin(x) * Math.sin(x) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(y) * Math.sin(y);
  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
  return R * c;
};

// Helper: Find the closest point on a line segment to a given point
const closestPointOnSegment = (
  point: LatLng,
  segmentStart: LatLng,
  segmentEnd: LatLng
): LatLng => {
  const dx = segmentEnd.longitude - segmentStart.longitude;
  const dy = segmentEnd.latitude - segmentStart.latitude;

  // If segment is a point (start == end), return the start point
  if (dx === 0 && dy === 0) {
    return segmentStart;
  }

  // Calculate the projection of the point onto the line segment
  // t is a value between 0 and 1 representing where on the segment the closest point lies
  const t = Math.max(0, Math.min(1, (
    (point.longitude - segmentStart.longitude) * dx +
    (point.latitude - segmentStart.latitude) * dy
  ) / (dx * dx + dy * dy)));

  return {
    latitude: segmentStart.latitude + t * dy,
    longitude: segmentStart.longitude + t * dx,
  };
};

// Helper: Find the closest point on a route polyline
const getClosestPointOnRoute = (
  location: LatLng,
  route: LatLng[]
): { point: LatLng; distance: number } => {
  if (!location || route.length === 0) {
    return { point: location, distance: Infinity };
  }

  if (route.length === 1) {
    return { point: route[0], distance: getDistance(location, route[0]) };
  }

  let closestPoint = route[0];
  let minDistance = Infinity;

  for (let i = 0; i < route.length - 1; i++) {
    const segmentClosest = closestPointOnSegment(location, route[i], route[i + 1]);
    const segmentDistance = getDistance(location, segmentClosest);

    if (segmentDistance < minDistance) {
      minDistance = segmentDistance;
      closestPoint = segmentClosest;
    }
  }

  return { point: closestPoint, distance: minDistance };
};

// Helper: Clamp bus location to route if within threshold distance
const clampToRoute = (
  busLocation: LatLng,
  route: LatLng[]
): LatLng => {
  if (!busLocation || route.length === 0) {
    return busLocation;
  }

  const { point, distance } = getClosestPointOnRoute(busLocation, route);

  // If within threshold, snap to the route
  if (distance <= ROUTE_CLAMP_THRESHOLD) {
    return point;
  }

  // Otherwise, return the original location
  return busLocation;
};

export default function RouteDetailsScreen() {
  const { theme } = useAppTheme();
  const { session } = useAuth();
  const params = useLocalSearchParams();
  const [loading, setLoading] = useState(true);
  const [nearestRoute, setNearestRoute] = useState<Route | null>(null);
  const [buses, setBuses] = useState<Bus[]>([]);
  const [selectedBus, setSelectedBus] = useState<Bus | null>(null);
  const [initialCamera, setInitialCamera] = useState<Camera | null>(null);
  const [showPickupSelection, setShowPickupSelection] = useState(false);
  const [pickupLocation, setPickupLocation] = useState<LatLng | null>(null);
  const [currentLocation, setCurrentLocation] = useState<LatLng | null>(null);
  const [userLocation, setUserLocation] =
    useState<Location.LocationObject | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const mapRef = useRef<MapView>(null);
  const [showBusModal, setShowBusModal] = useState(false);
  const [modalBus, setModalBus] = useState<Bus | null>(null);

  const textColor = useThemeColor({}, "text");

  const {
    setCurrentRoute: setContextRoute,
    subscribeToBus,
    unsubscribeFromBus,
    unsubscribeFromAllBusesExcept,
    unsubscribeFromRoute,
  } = useRoute();
  const { buses: contextBuses } = useBusesOnRoute();
  const { routeId: contextRouteId } = useCurrentRoute();

  // When route changes, we should be in "static" mode until user selects a bus.
  const [isLiveTrackingSelectedBus, setIsLiveTrackingSelectedBus] = useState(false);

  // Only keep route active for discovery/initial load. Once a bus is selected, stop route-wide realtime.
  useEffect(() => {
    if (isLiveTrackingSelectedBus) {
      // Stop receiving updates for all buses via route-level channels.
      unsubscribeFromRoute();
    }
  }, [isLiveTrackingSelectedBus, unsubscribeFromRoute]);

  // Subscribe to route broadcasts ASAP using the routeId param.
  // This ensures we start receiving `driver_location` broadcasts immediately,
  // even before the route/buses DB fetch finishes.
  const routeIdParam = params.routeId as string;
  useEffect(() => {
    if (routeIdParam && routeIdParam !== contextRouteId) {
      setContextRoute(routeIdParam);
    }
    // No cleanup: keep route active while navigating within the commuter stack.
  }, [routeIdParam, setContextRoute, contextRouteId]);



  // Enhanced UX states
  const [isSubmittingPickup, setIsSubmittingPickup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showLocationPermissionAlert, setShowLocationPermissionAlert] =
    useState(false);
  const [showWaitingModal, setShowWaitingModal] = useState(false);
  const [waitingPickupRequest, setWaitingPickupRequest] = useState<any>(null);
  const [passengerCount, setPassengerCount] = useState(1);
  const [showInstructions, setShowInstructions] = useState(true);
  const [showBusList, setShowBusList] = useState(true);
  const [showDropoffInstructions, setShowDropoffInstructions] = useState(true);
  const [showPickupForm, setShowPickupForm] = useState(true);

  // Animated bus positions for smooth marker transitions
  const [animatedBusPositions, setAnimatedBusPositions] = useState<Map<string, LatLng>>(new Map());
  // References to bus markers for native animation (Android)
  const busMarkerRefs = useRef<Map<string, any>>(new Map());

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

  // Memoized route coordinates for clamp-to-route functionality
  const routeCoordinates = React.useMemo(() => {
    if (!nearestRoute?.path?.coordinates) return [];
    return nearestRoute.path.coordinates.map(([lng, lat]) => ({
      latitude: lat,
      longitude: lng,
    }));
  }, [nearestRoute?.path?.coordinates]);

  // Handle broadcast bus location updates with smooth animation and clamp-to-route
  useEffect(() => {
    if (!contextBuses || contextBuses.length === 0) return;

    // Update animated positions for smooth marker transitions
    contextBuses.forEach((bus: any) => {
      if (bus.location) {
        let newPosition: LatLng = {
          latitude: bus.location.latitude,
          longitude: bus.location.longitude,
        };

        // Clamp bus position to route if within 20m threshold
        if (routeCoordinates.length > 0) {
          newPosition = clampToRoute(newPosition, routeCoordinates);
        }

        // Animate marker on Android using native method
        if (Platform.OS === 'android') {
          const markerRef = busMarkerRefs.current.get(bus.id);
          if (markerRef) {
            markerRef.animateMarkerToCoordinate(newPosition, MARKER_ANIMATION_DURATION);
          }
        }

        // Update state for all platforms
        setAnimatedBusPositions((prev) => {
          const updated = new Map(prev);
          updated.set(bus.id, newPosition);
          return updated;
        });
      }
    });
  }, [contextBuses, routeCoordinates]);


  const originCoords: LatLng = {
    latitude: parseFloat((params.originLat as string) || "0"),
    longitude: parseFloat((params.destLng as string) || "0"),
  };
  const destCoords: LatLng = {
    latitude: parseFloat((params.destLat as string) || "0"),
    longitude: parseFloat((params.destLng as string) || "0"),
  };

  // --- Data Fetching ---
  useEffect(() => {
    const routeId = params.routeId as string;

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        // If we have a specific route ID, fetch it directly from the routes table
        if (routeId) {
          //console.log("Fetching route directly by ID:", routeId);

          // Fetch the route directly by ID with its actual path data using the existing function
          const { data: routeData, error: routeError } = await supabase.rpc(
            "get_route_geojson",
            { route_id: routeId }
          );

          if (routeError) {
            //console.error("Route fetch error:", routeError);
            throw routeError;
          }

          if (!routeData) {
            //console.error("Route not found with ID:", routeId);
            Alert.alert(
              "Route Not Found",
              `The selected route (ID: ${routeId}) could not be found. Please try selecting a different route.`,
              [{ text: "OK", onPress: () => router.back() }]
            );
            setNearestRoute(null);
            setLoading(false);
            return;
          }

          // Use the actual stored route path from the database
          let routePath;
          const rawRoute = routeData[0];

          if (rawRoute && rawRoute.geojson) {
            // Use the actual stored route path from the database
            //console.log("Using stored route geojson from database");
            routePath = rawRoute.geojson;
          } else {
            // Fallback to direct line if no geojson data
            // //console.log(
            //   "No stored route geojson, using direct line from origin to destination"
            // );
            routePath = {
              type: "LineString",
              coordinates: [
                [originCoords.longitude, originCoords.latitude],
                [destCoords.longitude, destCoords.latitude],
              ],
            };
          }

          const fetchedRoute = {
            id: rawRoute.id,
            name: rawRoute.name,
            start_address: rawRoute.start_address,
            end_address: rawRoute.end_address,
            path: routePath,
          } as Route;
          setNearestRoute(fetchedRoute);

          // NOTE: No need to call setContextRoute here; the ASAP effect above already does it.

          // Set initial camera based on route path
          if (
            fetchedRoute.path?.coordinates &&
            fetchedRoute.path.coordinates.length >= 2
          ) {
            const coords = fetchedRoute.path.coordinates;
            const startPoint = {
              latitude: coords[0][1],
              longitude: coords[0][0],
            };
            const endPoint = {
              latitude: coords[coords.length - 1][1],
              longitude: coords[coords.length - 1][0],
            };
            const heading = calculateBearing(startPoint, endPoint);
            setMapCameraHeading(heading); // Store map rotation
            setInitialCamera({
              center: startPoint,
              pitch: 60,
              heading: heading,
              zoom: 18,
            });
          }

          // Get active buses for this specific route
          const { data: busesData, error: busesError } = await supabase
            .from("buses")
            .select(
              `
              id,
              plate_number,
              route_id,
              status,
              capacity,
              passengers,
              driver_id,
              driver:users!fk_driver (
                id,
                fullName
              )
            `
            )
            .eq("route_id", rawRoute.id)
            .eq("status", "active");
          if (busesError) throw busesError;
          if (!Array.isArray(busesData)) throw new Error("Invalid data.");

          // Get trips for these buses
          const busIds = busesData.map((bus: any) => bus.id);
          const { data: tripsData, error: tripsError } = await supabase.rpc(
            "get_active_trips_with_geojson",
            { bus_ids: busIds }
          );
          // Map bus to its latest trip location
          const formattedBuses: Bus[] = (busesData ?? []).map((bus: any) => {
            const trip = (tripsData ?? []).find(
              (t: any) =>
                t.bus_id === bus.id &&
                (t.status === "ongoing" || t.status === "waiting")
            );
            let location = null;
            if (trip?.current_location) {
              try {
                const geo = JSON.parse(trip.current_location);
                location = {
                  latitude: geo.coordinates[1],
                  longitude: geo.coordinates[0],
                };
              } catch {
                location = null;
              }
            }
            return {
              id: bus.id,
              plate_number: bus.plate_number,
              route_id: bus.route_id,
              status: bus.status,
              passengers: bus.passengers,
              capacity: bus.capacity,
              driver: bus.driver
                ? { id: bus.driver.id, fullName: bus.driver.fullName }
                : null,
              location,
            };
          });
          setBuses(formattedBuses);
        } else {
          // Original logic for finding best route when no specific route ID
          if (!destCoords.latitude) {
            Alert.alert("Error", "Missing destination.", [
              { text: "OK", onPress: () => router.back() },
            ]);
            setLoading(false);
            return;
          }

          const { data: routeData, error: routeError } = await supabase.rpc(
            "find_best_route_for_trip",
            {
              origin_lon: originCoords.longitude,
              origin_lat: originCoords.latitude,
              dest_lon: destCoords.longitude,
              dest_lat: destCoords.latitude,
            }
          );
          if (routeError) throw routeError;
          if (!routeData || routeData.length === 0) {
            setNearestRoute(null);
            setLoading(false);
            return;
          }

          // Handle WKT geometry conversion for best route as well
          let routePath;
          const rawRoute = routeData[0];
          if (typeof rawRoute.path === "string") {
            // Use origin and destination coordinates for best route
            //console.log(
            //  "Using origin and destination coordinates for best route path"
            //);
            // Use origin and destination since coordinate columns don't exist
            routePath = {
              type: "LineString",
              coordinates: [
                [originCoords.longitude, originCoords.latitude],
                [destCoords.longitude, destCoords.latitude],
              ],
            };
          } else {
            routePath = rawRoute.path;
          }

          const fetchedRoute = {
            ...rawRoute,
            path: routePath,
          } as Route;
          setNearestRoute(fetchedRoute);

          // NOTE: No need to call setContextRoute here; this flow doesn't have a stable routeId param.

          if (
            fetchedRoute.path?.coordinates &&
            fetchedRoute.path.coordinates.length >= 2
          ) {
            const coords = fetchedRoute.path.coordinates;
            const startPoint = {
              latitude: coords[0][1],
              longitude: coords[0][0],
            };
            const endPoint = {
              latitude: coords[coords.length - 1][1],
              longitude: coords[coords.length - 1][0],
            };

            //Zoom out to show the entire route
            const heading = calculateBearing(startPoint, endPoint);
            setInitialCamera({
              center: startPoint,
              pitch: 60,
              heading: heading,
              zoom: 18,
            });
          }

          // Get active buses for the route
          const { data: busesData, error: busesError } = await supabase
            .from("buses")
            .select(
              `
            id,
            plate_number,
            route_id,
            status,
            capacity,
            passengers,
            driver_id,
            driver:users!fk_driver (
              id,
              fullName
            )
          `
            )
            .eq("route_id", fetchedRoute.id)
            .eq("status", "active");

          if (busesError) throw busesError;
          if (!Array.isArray(busesData)) throw new Error("Invalid data.");

          // Get trips for these buses
          const busIds = busesData.map((bus: any) => bus.id);
          const { data: tripsData, error: tripsError } = await supabase.rpc(
            "get_active_trips_with_geojson",
            { bus_ids: busIds }
          );

          // Map bus to its latest trip location
          const formattedBuses: Bus[] = (busesData ?? []).map((bus: any) => {
            const trip = (tripsData ?? []).find(
              (t: any) =>
                t.bus_id === bus.id &&
                (t.status === "ongoing" || t.status === "waiting")
            );

            let location = null;
            if (trip?.current_location) {
              try {
                const geo = JSON.parse(trip.current_location);
                location = {
                  latitude: geo.coordinates[1],
                  longitude: geo.coordinates[0],
                };
              } catch {
                location = null;
              }
            }

            return {
              id: bus.id,
              plate_number: bus.plate_number,
              route_id: bus.route_id,
              status: bus.status,
              passengers: bus.passengers,
              capacity: bus.capacity,
              driver: bus.driver
                ? { id: bus.driver.id, fullName: bus.driver.fullName }
                : null,
              location,
            };
          });
          setBuses(formattedBuses);
        }
      } catch (err) {
        //console.error("Error fetching data:", err);
        setError(
          "Failed to load route information. Please check your connection and try again."
        );
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [destCoords.latitude, destCoords.longitude, params.routeId]);

  // Real-time user location tracking - Only when screen is focused
  useFocusEffect(
    useCallback(() => {
      let locationSubscription: Location.LocationSubscription | null = null;

      const startLocationUpdates = async () => {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== "granted") {
            //console.log("Location permission denied");
            return;
          }

          // Start watching position for real-time updates
          locationSubscription = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.High,
              timeInterval: LOCATION_UPDATE_INTERVAL,
              distanceInterval: DISTANCE_THRESHOLD, // Use constant for short distance testing
            },
            (location) => {
              setUserLocation(location);

              // Log location update for debugging
              // console.log("📍 Commuter location updated (focused):", {
              //   latitude: location.coords.latitude,
              //   longitude: location.coords.longitude,
              // });
            }
          );
        } catch (error) {
          //console.error("Error starting location updates:", error);
        }
      };

      startLocationUpdates();

      return () => {
        if (locationSubscription) {
          locationSubscription.remove();
        }
      };
    }, [])
  );

  // Refresh function
  const onRefresh = async () => {
    setRefreshing(true);
    setError(null);

    try {
      const routeId = params.routeId as string;

      if (routeId) {
        // Re-fetch route data
        const { data: routeData, error: routeError } = await supabase.rpc(
          "get_route_geojson",
          { route_id: routeId }
        );

        if (routeError) throw routeError;

        if (routeData && routeData[0]) {
          const rawRoute = routeData[0];
          let routePath;

          if (rawRoute && rawRoute.geojson) {
            routePath = rawRoute.geojson;
          } else {
            routePath = {
              type: "LineString",
              coordinates: [
                [originCoords.longitude, originCoords.latitude],
                [destCoords.longitude, destCoords.latitude],
              ],
            };
          }

          const fetchedRoute = {
            id: rawRoute.id,
            name: rawRoute.name,
            start_address: rawRoute.start_address,
            end_address: rawRoute.end_address,
            path: routePath,
          } as Route;
          setNearestRoute(fetchedRoute);

          // Re-fetch buses
          const { data: busesData, error: busesError } = await supabase
            .from("buses")
            .select(
              `
              id,
              plate_number,
              route_id,
              status,
              capacity,
              passengers,
              driver_id,
              driver:users!fk_driver (
                id,
                fullName
              )
            `
            )
            .eq("route_id", rawRoute.id)
            .eq("status", "active");

          if (busesError) throw busesError;

          const busIds = busesData?.map((bus: any) => bus.id) || [];
          const { data: tripsData } = await supabase.rpc(
            "get_active_trips_with_geojson",
            { bus_ids: busIds }
          );

          const formattedBuses: Bus[] = (busesData ?? []).map((bus: any) => {
            const trip = (tripsData ?? []).find(
              (t: any) =>
                t.bus_id === bus.id &&
                (t.status === "ongoing" || t.status === "waiting")
            );

            let location = null;
            if (trip?.current_location) {
              try {
                const geo = JSON.parse(trip.current_location);
                location = {
                  latitude: geo.coordinates[1],
                  longitude: geo.coordinates[0],
                };
              } catch {
                location = null;
              }
            }

            return {
              id: bus.id,
              plate_number: bus.plate_number,
              route_id: bus.route_id,
              status: bus.status,
              passengers: bus.passengers,
              capacity: bus.capacity,
              driver: bus.driver
                ? { id: bus.driver.id, fullName: bus.driver.fullName }
                : null,
              location,
            };
          });
          setBuses(formattedBuses);
        }
      }
    } catch (err) {
      //console.error("Error refreshing data:", err);
      setError("Failed to refresh data. Please try again.");
    } finally {
      setRefreshing(false);
    }
  };

  // Track selected bus updates to animate camera
  useEffect(() => {
    if (selectedBus) {
      const updatedBus = buses.find((b) => b.id === selectedBus.id);
      if (updatedBus && updatedBus.location) {
        // Animate camera to follow bus
        if (mapRef.current) {
          mapRef.current.animateCamera(
            {
              center: {
                latitude: updatedBus.location.latitude,
                longitude: updatedBus.location.longitude,
              },
              zoom: 19, // High zoom for short distance visibility
              pitch: 60,
              heading: 0,
            },
            { duration: CAMERA_ANIMATION_DURATION }
          );
        }
      }
    }
  }, [buses, selectedBus]);

  // Manage subscription for selected bus
  useEffect(() => {
    if (!selectedBus?.id) return;

    //console.log("Subscribing to selected bus:", selectedBus.id);

    // Switch into live-follow mode.
    setIsLiveTrackingSelectedBus(true);

    // Only keep the selected bus live; stop everything else.
    subscribeToBus(selectedBus.id);
    unsubscribeFromAllBusesExcept(selectedBus.id);
    unsubscribeFromRoute();

    return () => {
      //console.log("Unsubscribing from selected bus:", selectedBus.id);
      unsubscribeFromBus(selectedBus.id);
    };
  }, [selectedBus?.id, subscribeToBus, unsubscribeFromBus, unsubscribeFromAllBusesExcept, unsubscribeFromRoute]);



  // REMOVED: Continuous sync of contextBuses to local buses state.
  // This was causing buses to continuously update from realtime context,
  // violating the requirement to keep buses static until user selects one.
  // The gated effect above (lines 839-852) handles updating ONLY the selected bus.

  // Sync buses from Context to local state for real-time updates of markers
  useEffect(() => {
    // NEW UX: before selecting a bus, the screen should stay on the static DB snapshot.
    // Once a bus is selected, we only live-update that selected bus (others stay frozen in list + map).
    if (!isLiveTrackingSelectedBus || !selectedBus?.id) return;
    if (!contextBuses) return;

    const selectedFromContext = contextBuses.find((b) => b.id === selectedBus.id);
    if (!selectedFromContext) return;

    // Update only the selected bus in-place to prevent list items disappearing/reappearing.
    setBuses((prev) =>
      prev
        .map((bus) => {
          if (bus.id !== selectedBus.id) return bus;
          return {
            ...bus,
            status: selectedFromContext.status as any,
            location: selectedFromContext.location ?? bus.location,
            capacity: selectedFromContext.capacity ?? bus.capacity,
            passengers: selectedFromContext.passengers ?? bus.passengers,
            driver: selectedFromContext.driverId
              ? {
                id: selectedFromContext.driverId,
                fullName: selectedFromContext.driverName || bus.driver?.fullName || "Driver",
              }
              : bus.driver,
          };
        })
        .sort((a, b) => a.plate_number.localeCompare(b.plate_number))
    );

    // Keep the marker position map accurate for the selected bus.
    if (selectedFromContext.location) {
      setAnimatedBusPositions((prev) => {
        const next = new Map(prev);
        next.set(selectedBus.id, selectedFromContext.location!);
        return next;
      });
    }
  }, [contextBuses, isLiveTrackingSelectedBus, selectedBus?.id]);

  // Restore waiting state if requested
  useEffect(() => {
    const restoreState = async () => {
      if (params.restorePickupRequestId && nearestRoute) {
        //console.log("Restoring pickup request state:", params.restorePickupRequestId);
        try {
          const { data: request, error } = await supabase
            .from("pickup_requests")
            .select(`
              *,
              bus:buses (
                id,
                plate_number,
                driver:users!fk_driver (
                  id,
                  fullName
                )
              )
            `)
            .eq("id", params.restorePickupRequestId)
            .single();

          if (error || !request) {
            //console.error("Error fetching restored request:", error);
            return;
          }

          if (request.status !== 'pending') {
            //console.log("Restored request is not pending:", request.status);
            return;
          }

          setWaitingPickupRequest({
            id: request.id,
            busPlateNumber: request.bus?.plate_number || "Unknown",
            driverName: request.bus?.driver?.fullName || "Unknown Driver",
            pickupLocation: {
              latitude: request.pickup_lat,
              longitude: request.pickup_lng
            },
            destCoords: {
              latitude: request.dest_lat,
              longitude: request.dest_lng
            },
            createdAt: request.created_at,
          });

          setShowWaitingModal(true);

          // Restart listener
          startListeningForPickupResponse(
            request.id,
            request.bus_id,
            request.trip_id,
            request.bus?.plate_number,
            { latitude: request.pickup_lat, longitude: request.pickup_lng },
            nearestRoute,
            session?.user?.id || ""
          );

        } catch (e) {
          //console.error("Error restoring state:", e);
        }
      }
    };

    restoreState();
  }, [params.restorePickupRequestId, nearestRoute]);

  // --- Handlers ---
  const handleBusSelect = (bus: Bus) => {
    if (bus.status !== "active") {
      Alert.alert("Bus Inactive", "This bus is not currently active.");
      return;
    }

    setSelectedBus(bus);
    setShowPickupSelection(true);
    setPickupLocation(null);
    setCurrentLocation(null);

    // Focus camera on the selected bus
    setTimeout(() => {
      if (bus.location) {
        // If bus has live location, focus on it
        if (mapRef.current) {
          mapRef.current.animateCamera(
            {
              center: {
                latitude: bus.location.latitude,
                longitude: bus.location.longitude,
              },
              zoom: 18,
              pitch: 60,
              heading: 0,
            },
            { duration: 1000 }
          );
        }
      } else if (
        nearestRoute?.path?.coordinates &&
        nearestRoute.path.coordinates.length > 0
      ) {
        // If no live location, focus on the route start point as fallback
        const startCoord = nearestRoute.path.coordinates[0];
        const fallbackLocation = {
          latitude: startCoord[1],
          longitude: startCoord[0],
        };
        //console.log("Focusing on fallback location:", fallbackLocation);
        if (mapRef.current) {
          mapRef.current.animateCamera(
            {
              center: {
                latitude: fallbackLocation.latitude,
                longitude: fallbackLocation.longitude,
              },
              zoom: 19,
              pitch: 60,
              heading: 0,
            },
            { duration: 1000 }
          );
        }
      }
    }, 300);
  };

  const handleUseCurrentLocation = () => {
    getCurrentLocation(
      (location) => {
        setPickupLocation(location);
        mapRef.current?.animateCamera(
          {
            center: location,
            zoom: 19,
            pitch: 60,
            heading: 0,
          },
          { duration: 1000 }
        );
      },
      setLocationLoading,
      setShowLocationPermissionAlert
    );
  };

  const handlePinLocation = (coordinate: LatLng) => {
    if (showPickupSelection) {
      setPickupLocation(coordinate);
    }
  };

  const handleConfirmPickup = async () => {
    if (!pickupLocation || !selectedBus || !nearestRoute) {
      Alert.alert(
        "Missing Information",
        "Please select a pickup location before confirming your request.",
        [{ text: "OK" }]
      );
      return;
    }

    if (!session?.user?.id) {
      Alert.alert(
        "Authentication Required",
        "Please sign in to request a pickup.",
        [{ text: "OK" }]
      );
      return;
    }

    setIsSubmittingPickup(true);
    setError(null);

    try {
      // Get user profile information
      const { data: userProfile, error: profileError } = await supabase
        .from("users")
        .select("fullName, contact_number")
        .eq("id", session.user.id)
        .single();

      if (profileError) {
        //console.error("Error fetching user profile:", profileError);
        setError("Could not fetch your profile information. Please try again.");
        return;
      }

      // Validate passenger count against bus capacity
      if (
        selectedBus.capacity &&
        typeof selectedBus.passengers === "number" &&
        passengerCount > selectedBus.capacity - selectedBus.passengers
      ) {
        setError(
          `Cannot request ${passengerCount} seats. Only ${selectedBus.capacity - selectedBus.passengers
          } seats available.`
        );
        return;
      }

      // Check if there's an active trip for this bus
      const { data: existingTrip, error: tripError } = await supabase
        .from("trips")
        .select("id")
        .eq("bus_id", selectedBus.id)
        .in("status", ["waiting", "ongoing"])
        .maybeSingle();

      let tripId: string;

      if (!existingTrip || tripError) {
        // No active trip exists for this bus, create one

        const { data: newTrip, error: createError } = await supabase
          .from("trips")
          .insert({
            bus_id: selectedBus.id,
            status: "waiting",
          })
          .select("id")
          .single();

        if (createError) {
          //console.error("Error creating trip:", createError);
          setError(
            "Unable to create a trip for this bus. Please try again or contact support."
          );
          return;
        }

        tripId = newTrip.id;
      } else {
        tripId = existingTrip.id;
      } // Check if trip_passengers record already exists for this specific trip and passenger
      const { data: existingTripPassenger, error: checkError } = await supabase
        .from("trip_passengers")
        .select("id, status, created_at")
        .eq("bus_id", selectedBus.id)
        .eq("passenger_id", session.user.id)
        .eq("trip_id", tripId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // console.log("Existing trip_passengers record check:", {
      //   existingRecord: existingTripPassenger,
      //   error: checkError,
      //   busId: selectedBus.id,
      //   passengerId: session.user.id,
      //   tripId: tripId,
      // });

      let tripPassengerId;
      if (existingTripPassenger && !checkError) {
        // Update existing record
        tripPassengerId = existingTripPassenger.id;

        const { error: updateError } = await supabase
          .from("trip_passengers")
          .update({
            pickup_lat: pickupLocation.latitude,
            pickup_lng: pickupLocation.longitude,
            dest_lat: destCoords.latitude,
            dest_lng: destCoords.longitude,
            status: "waiting",
            passenger_count: passengerCount,
          })
          .eq("id", tripPassengerId);

        if (updateError) {
          //console.error("Error updating trip_passengers record:", updateError);
          setError("Failed to update passenger record. Please try again.");
          return;
        }
      } else {
        // Create new record only if none exists

        const { data: tripPassenger, error: tripPassengerError } =
          await supabase
            .from("trip_passengers")
            .insert({
              bus_id: selectedBus.id,
              trip_id: tripId,
              passenger_id: session.user.id,
              pickup_lat: pickupLocation.latitude,
              pickup_lng: pickupLocation.longitude,
              dest_lat: destCoords.latitude,
              dest_lng: destCoords.longitude,
              status: "waiting",
              passenger_count: passengerCount,
            })
            .select("id")
            .single();

        if (tripPassengerError) {
          // console.error(
          //   "Error creating trip_passengers record:",
          //   tripPassengerError
          // );
          setError("Failed to create passenger record. Please try again.");
          return;
        }

        tripPassengerId = tripPassenger.id;
      }

      // Also create pickup request to notify the driver
      const { data: pickupRequest, error: pickupError } = await supabase
        .from("pickup_requests")
        .insert({
          bus_id: selectedBus.id,
          commuter_id: session.user.id,
          trip_id: tripId,
          pickup_lat: pickupLocation.latitude,
          pickup_lng: pickupLocation.longitude,
          dest_lat: destCoords.latitude,
          dest_lng: destCoords.longitude,
          status: "pending",
          commuter_name: userProfile.fullName || "Unknown",
          commuter_phone: userProfile.contact_number || null,
          notes:
            passengerCount > 1
              ? `Group pickup - ${passengerCount} passengers`
              : null,
          passenger_count: passengerCount,
        })
        .select("id")
        .single();

      if (pickupError) {
        //console.error("Error creating pickup request:", pickupError);
        setError("Failed to create pickup request. Please try again.");
        return;
      }

      //console.log("Pickup request created successfully:", pickupRequest);

      // Show waiting modal instead of alert
      setWaitingPickupRequest({
        id: pickupRequest.id,
        busPlateNumber: selectedBus.plate_number,
        driverName: selectedBus.driver?.fullName || "Unknown Driver",
        pickupLocation,
        destCoords,
        createdAt: new Date().toISOString(),
      });
      setShowWaitingModal(true);

      // Reset pickup selection UI but keep the request active
      setShowPickupSelection(false);

      // Start listening for pickup request status changes
      startListeningForPickupResponse(
        pickupRequest.id,
        selectedBus.id,
        tripId,
        selectedBus.plate_number,
        pickupLocation,
        nearestRoute,
        session.user.id
      );

      // Reset after starting the listener
      setSelectedBus(null);
      setPickupLocation(null);
    } catch (error) {
      //console.error("Error in handleConfirmPickup:", error);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmittingPickup(false);
    }
  };

  const handleCancelPickup = () => {
    setShowPickupSelection(false);
    setSelectedBus(null);
    setPickupLocation(null);
  };

  const startListeningForPickupResponse = (
    pickupRequestId: string,
    busId: string,
    tripId: string,
    busPlateNumber: string,
    pickupLocation: LatLng,
    nearestRoute: Route,
    passengerId: string
  ) => {
    // console.log(
    //   "Starting to listen for pickup request response:",
    //   pickupRequestId
    // );

    // Define channels first
    const pickupChannel = supabase
      .channel(`pickup-request-${pickupRequestId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "pickup_requests",
          filter: `id=eq.${pickupRequestId}`,
        },
        async (payload) => {
          //console.log("Pickup request status updated:", payload);
          const newStatus = payload.new.status;

          if (newStatus === "accepted") {
            // console.log(
            //   "Pickup request accepted! Navigating to trip screen..."
            // );

            // Vibrate to notify user
            Vibration.vibrate();

            // Close waiting modal
            setShowWaitingModal(false);
            setWaitingPickupRequest(null);

            // Navigate directly to trip screen
            // console.log(
            //   "Navigating to trip with passenger count:",
            //   passengerCount
            // );
            router.push({
              pathname: "/trip",
              params: {
                busId: busId,
                busPlateNumber: busPlateNumber,
                tripId: tripId,
                pickupLat: pickupLocation.latitude.toString(),
                pickupLng: pickupLocation.longitude.toString(),
                destLat: destCoords.latitude.toString(),
                destLng: destCoords.longitude.toString(),
                routePath: JSON.stringify(nearestRoute.path.coordinates),
                passengerCount: passengerCount.toString(),
              },
            });

            // Unsubscribe from both channels
            safeRemove(pickupChannel);
            safeRemove(tripPassengerChannel);
          } else if (newStatus === "declined") {
            //console.log("Pickup request declined by driver");

            // Close waiting modal
            setShowWaitingModal(false);
            setWaitingPickupRequest(null);

            Alert.alert(
              "Pickup Request Declined",
              "The driver has declined your pickup request. Please try selecting another bus.",
              [
                {
                  text: "OK",
                  onPress: () => {
                    // Stay on the route details screen to select another bus
                    safeRemove(pickupChannel);
                    safeRemove(tripPassengerChannel);
                  },
                },
              ]
            );
          }
        }
      );

    const tripPassengerChannel = supabase
      .channel(`trip-passenger-${passengerId}-${busId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "trip_passengers",
          filter: `passenger_id=eq.${passengerId} AND bus_id=eq.${busId}`,
        },
        async (payload) => {
          //console.log("Trip passenger status updated:", payload);
          const newStatus = payload.new.status;

          if (newStatus === "boarded") {
            //console.log("Passenger boarded! Navigating to trip screen...");

            // Navigate to trip screen
            router.push({
              pathname: "/trip",
              params: {
                busId: busId,
                busPlateNumber: busPlateNumber,
                tripId: tripId,
                pickupLat: pickupLocation.latitude.toString(),
                pickupLng: pickupLocation.longitude.toString(),
                destLat: destCoords.latitude.toString(),
                destLng: destCoords.longitude.toString(),
                routePath: JSON.stringify(nearestRoute.path.coordinates),
                passengerCount: passengerCount.toString(),
              },
            });

            // Unsubscribe from both channels
            safeRemove(pickupChannel);
            safeRemove(tripPassengerChannel);
          } else if (newStatus === "cancelled") {
            //console.log("Trip cancelled by driver");
            Alert.alert(
              "Trip Cancelled",
              "The driver has cancelled your trip. Please try selecting another bus.",
              [
                {
                  text: "OK",
                  onPress: () => {
                    safeRemove(pickupChannel);
                    safeRemove(tripPassengerChannel);
                  },
                },
              ]
            );
          }
        }
      );

    // Subscribe to both channels
    pickupChannel.subscribe((status) => {
      //console.log("Pickup request channel subscription status:", status);
      if (status === "SUBSCRIBED") {
        //console.log("✅ Successfully subscribed to pickup request updates");
      } else if (status === "CHANNEL_ERROR") {
        //console.error("❌ Failed to subscribe to pickup request updates");
      }
    });

    tripPassengerChannel.subscribe((status) => {
      //console.log("Trip passenger channel subscription status:", status);
      if (status === "SUBSCRIBED") {
        //console.log("✅ Successfully subscribed to trip passenger updates");
      } else if (status === "CHANNEL_ERROR") {
        //console.error("❌ Failed to subscribe to trip passenger updates");
      }
    });

    // Fallback: Poll for pickup request status every 3 seconds as backup
    const pollInterval = setInterval(async () => {
      try {
        //console.log("Polling for pickup request status...");
        const { data: requestData, error } = await supabase
          .from("pickup_requests")
          .select("status")
          .eq("id", pickupRequestId)
          .single();

        if (error) {
          //console.error("Error polling pickup request:", error);
          return;
        }

        if (requestData) {
          //console.log("Polled pickup request status:", requestData.status);

          if (requestData.status === "accepted") {
            //console.log(
            //  "Pickup request accepted via polling! Navigating to trip screen..."
            //);
            clearInterval(pollInterval);

            // Vibrate to notify user
            Vibration.vibrate();

            // Close waiting modal
            setShowWaitingModal(false);
            setWaitingPickupRequest(null);

            // Navigate directly to trip screen
            //console.log(
            //  "Navigating to trip with passenger count:",
            //  passengerCount
            //);
            router.push({
              pathname: "/trip",
              params: {
                busId: busId,
                busPlateNumber: busPlateNumber,
                tripId: tripId,
                pickupLat: pickupLocation.latitude.toString(),
                pickupLng: pickupLocation.longitude.toString(),
                destLat: destCoords.latitude.toString(),
                destLng: destCoords.longitude.toString(),
                routePath: JSON.stringify(nearestRoute.path.coordinates),
                passengerCount: passengerCount.toString(),
              },
            });

            // Unsubscribe from both channels
            safeRemove(pickupChannel);
            safeRemove(tripPassengerChannel);
          } else if (requestData.status === "declined") {
            //console.log("Pickup request declined via polling");
            clearInterval(pollInterval);

            // Close waiting modal
            setShowWaitingModal(false);
            setWaitingPickupRequest(null);

            Alert.alert(
              "Pickup Request Declined",
              "The driver has declined your pickup request. Please try selecting another bus.",
              [
                {
                  text: "OK",
                  onPress: () => {
                    // Stay on the route details screen to select another bus
                    safeRemove(pickupChannel);
                    safeRemove(tripPassengerChannel);
                  },
                },
              ]
            );
          }
        }
      } catch (error) {
        //console.error("Error in polling interval:", error);
      }
    }, 3000); // Poll every 3 seconds

    // IMPORTANT:
    // Do NOT override/monkey-patch `supabase.removeChannel`.
    // That global override can unintentionally affect RouteContext and other screens.
    // Instead, ensure we clear polling when we explicitly remove our channels.
    const stopPolling = () => clearInterval(pollInterval);

    const safeRemove = (channel: any) => {
      try {
        supabase.removeChannel(channel);
      } finally {
        stopPolling();
      }
    };

    // Replace direct removals below with safeRemove
    // ...existing code...
  };

  // --- Loading and Error States ---
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading route details...</Text>
        <Text style={styles.loadingSubtext}>
          Finding available buses for your route
        </Text>
      </View>
    );
  }

  if (error && !nearestRoute) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle" size={64} color="#dc3545" />
        <Text style={styles.errorTitle}>Unable to Load Route</Text>
        <Text style={styles.errorText}>{error}</Text>
        <View style={styles.errorButtonRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.actionButton, styles.cancelButton]}
          >
            <Text style={styles.buttonText}>Go Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onRefresh}
            style={[styles.actionButton, styles.confirmButton]}
          >
            <Text style={styles.buttonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!nearestRoute || !initialCamera) {
    return (
      <View style={styles.centered}>
        <Ionicons name="map" size={64} color="#6c757d" />
        <Text style={styles.errorTitle}>No Route Found</Text>
        <Text style={styles.errorText}>
          We couldn&apos;t find a route for your destination. Please try
          selecting a different destination.
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.goBackButton}
        >
          <Text style={styles.buttonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const polylineCoords = nearestRoute.path.coordinates.map(([lng, lat]) => ({
    latitude: lat,
    longitude: lng,
  }));

  return (
    <View style={styles.container}>

      <MapView
        ref={mapRef}
        googleRenderer="LEGACY"
        customMapStyle={theme === "dark" ? [...mapDarkStyle] : []}
        style={StyleSheet.absoluteFill}
        pitchEnabled={true}
        initialCamera={initialCamera}
        showsCompass={false}
        onPress={(e) => handlePinLocation(e.nativeEvent.coordinate)}
      >
        {/* Enhanced Destination Marker */}
        <Marker
          coordinate={destCoords}
          title="Your Destination"
          anchor={{ x: 0.5, y: 1 }}
        >
          <View style={styles.destinationMarkerContainer}>
            <Image
              source={require("../assets/images/destination-flag.png")}
              style={styles.destinationIcon}
              resizeMode="contain"
            />
          </View>
        </Marker>
        <Polyline
          coordinates={polylineCoords}
          strokeColor="#007AFF"
          strokeWidth={8}
        />

        {/* Route Start Marker */}
        {nearestRoute.path.coordinates.length > 0 && (
          <Marker
            coordinate={{
              latitude: nearestRoute.path.coordinates[0][1],
              longitude: nearestRoute.path.coordinates[0][0],
            }}
            title="Route Start"
            description={nearestRoute.start_address || "Starting point"}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.routeMarkerContainer}>
              <Image
                source={require("../assets/images/start-route.png")}
                style={styles.routeMarkerIcon}
                resizeMode="contain"
              />
            </View>
          </Marker>
        )}

        {/* Route End Marker */}
        {nearestRoute.path.coordinates.length > 0 && (
          <Marker
            coordinate={{
              latitude: nearestRoute.path.coordinates[nearestRoute.path.coordinates.length - 1][1],
              longitude: nearestRoute.path.coordinates[nearestRoute.path.coordinates.length - 1][0],
            }}
            title="Route End"
            description={nearestRoute.end_address || "End point"}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.routeMarkerContainer}>
              <Image
                source={require("../assets/images/end-route.png")
                }
                style={styles.routeMarkerIcon}
                resizeMode="contain"
              />
            </View>
          </Marker>
        )}

        {/* Enhanced Pickup Location Marker */}
        {pickupLocation && (
          <Marker
            coordinate={pickupLocation}
            title="Your Pickup Spot"
            anchor={{ x: 0.5, y: 1 }}
          >
            <View style={styles.pickupMarkerContainer}>
              <View style={styles.pickupMarkerHead}>
                <Ionicons name="hand-right" size={18} color="#fff" />
              </View>
              <View style={styles.pickupMarkerPoint} />
            </View>
          </Marker>
        )}
        {/* Enhanced User Location Marker */}
        {currentLocation && (
          <Marker
            coordinate={currentLocation}
            title="Your Location"
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.userMarkerContainer}>
              <View style={styles.userLocationDot}>
                <Ionicons name="person" size={16} color="#fff" />
              </View>
              <View style={styles.userLocationRipple} />
            </View>
          </Marker>
        )}

        {/* User Location Marker with Custom Pin */}
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
                    { transform: [{ rotate: `${(compassHeading - mapCameraHeading + 360) % 360}deg` }] },
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
              <Image
                source={require("../assets/images/user-pin.png")}
                style={styles.userMarkerIcon}
                resizeMode="contain"
              />
            </View>
          </Marker>
        )}

        {buses.map((bus) => {
          const isActive = bus.status === "active";
          const isSelected = selectedBus?.id === bus.id;
          const startCoord = nearestRoute.path.coordinates?.[0];
          const fallbackLocation = startCoord
            ? { latitude: startCoord[1], longitude: startCoord[0] }
            : null;

          // Use animated position if available, otherwise fall back to bus location or fallback
          const animatedPos = animatedBusPositions.get(bus.id);
          const markerCoordinate = animatedPos || bus.location || fallbackLocation;

          const availableSeats =
            typeof bus.capacity === "number" &&
              typeof bus.passengers === "number"
              ? Math.max(bus.capacity - bus.passengers, 0)
              : 0;

          if (!markerCoordinate) return null;

          return (
            <Marker
              key={bus.id}
              ref={(ref) => {
                if (ref) {
                  busMarkerRefs.current.set(bus.id, ref);
                } else {
                  busMarkerRefs.current.delete(bus.id);
                }
              }}
              coordinate={markerCoordinate}
              tracksViewChanges={false}
              onPress={() => {
                // Use InteractionManager to defer state update safely on Android
                InteractionManager.runAfterInteractions(() => {
                  setModalBus(bus);
                  setShowBusModal(true);
                });
              }}
            >
              <View style={styles.busMarkerContainer}>
                <Image
                  source={require("../assets/images/bus-icon.png")}
                  style={styles.busMarkerIcon}
                  resizeMode="contain"
                />
              </View>
            </Marker>
          );
        })}
      </MapView>

      {/* Enhanced Header with Route Info and Instructions */}
      <SafeAreaView style={styles.enhancedHeaderContainer}>
        <LinearGradient
          colors={theme === "dark"
            ? ["#1a365d", "#2563eb", "#3b82f6"]
            : ["#0052d4", "#4364f7", "#6fb1fc"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.enhancedHeaderGradient}
        >
          {/* Decorative elements */}
          <View style={styles.headerDecorCircle1} />
          <View style={styles.headerDecorCircle2} />

          {/* Main Header Row */}
          <View style={styles.enhancedHeaderRow}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.enhancedBackButton}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.enhancedHeaderInfo}>
              <Text style={styles.enhancedHeaderTitle}>
                {showPickupSelection ? "Set Pickup Location" : "Select a Bus"}
              </Text>
              <Text style={styles.enhancedHeaderSubtitle}>
                {nearestRoute?.name || "Loading..."}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onRefresh}
              style={[styles.enhancedRefreshButton, refreshing && styles.refreshingButton]}
              disabled={refreshing}
              activeOpacity={0.7}
            >
              <Ionicons
                name="refresh"
                size={20}
                color="#fff"
                style={refreshing ? { transform: [{ rotate: "180deg" }] } : {}}
              />
            </TouchableOpacity>
          </View>

          {/* Collapsible Instructions Section */}
          {!showPickupSelection && (
            <>
              <TouchableOpacity
                style={styles.instructionsHeader}
                onPress={() => {
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setShowInstructions(!showInstructions);
                }}
                activeOpacity={0.8}
              >
                <View style={styles.instructionsHeaderLeft}>
                  <Ionicons name="help-circle" size={18} color="#fff" />
                  <Text style={styles.instructionsHeaderText}>
                    How to book a ride
                  </Text>
                </View>
                <View style={styles.instructionsToggle}>
                  <Ionicons
                    name={showInstructions ? "chevron-up" : "chevron-down"}
                    size={18}
                    color="#fff"
                  />
                </View>
              </TouchableOpacity>

              {showInstructions && (
                <View style={styles.instructionsContainer}>
                  {/* Step 1 */}
                  <View style={styles.instructionStep}>
                    <View style={styles.instructionStepNumber}>
                      <Text style={styles.instructionStepNumberText}>1</Text>
                    </View>
                    <Text style={styles.instructionStepText}>
                      View the available buses on the map below.
                    </Text>
                  </View>

                  {/* Step 2 */}
                  <View style={styles.instructionStep}>
                    <View style={styles.instructionStepNumber}>
                      <Text style={styles.instructionStepNumberText}>2</Text>
                    </View>
                    <Text style={styles.instructionStepText}>
                      Tap a bus card to view details (seats, driver).
                    </Text>
                  </View>

                  {/* Step 3 */}
                  <View style={styles.instructionStep}>
                    <View style={styles.instructionStepNumber}>
                      <Text style={styles.instructionStepNumberText}>3</Text>
                    </View>
                    <Text style={styles.instructionStepText}>
                      Tap "Select This Bus" to proceed.
                    </Text>
                  </View>

                  {/* Step 4 */}
                  <View style={styles.instructionStep}>
                    <View style={styles.instructionStepNumber}>
                      <Text style={styles.instructionStepNumberText}>4</Text>
                    </View>
                    <Text style={styles.instructionStepText}>
                      Set your pickup location on the route.
                    </Text>
                  </View>

                  {/* Tip */}
                  <View style={styles.instructionTipBanner}>
                    <View style={styles.instructionTipIcon}>
                      <Ionicons name="bulb" size={16} color="#F59E0B" />
                    </View>
                    <Text style={styles.instructionTipText}>
                      <Text style={styles.instructionStepBold}>Tip:</Text> Choose a bus with available seats that is closest to your location.
                    </Text>
                  </View>
                </View>
              )}
            </>
          )}

          {/* Drop-off Instructions when in pickup selection mode */}
          {/* Drop-off Instructions when in pickup selection mode */}
          {showPickupSelection && (
            <View>
              <TouchableOpacity
                onPress={() => {
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setShowDropoffInstructions(!showDropoffInstructions);
                }}
                style={styles.instructionsHeader}
              >
                <View style={styles.instructionsHeaderLeft}>
                  <Ionicons name="information-circle" size={20} color="#fff" />
                  <SafeText style={styles.instructionsHeaderText}>
                    Drop-off Instructions
                  </SafeText>
                </View>
                <View style={styles.instructionsToggle}>
                  <Ionicons
                    name={showDropoffInstructions ? "chevron-up" : "chevron-down"}
                    size={16}
                    color="#fff"
                  />
                </View>
              </TouchableOpacity>

              {showDropoffInstructions && (
                <View style={styles.dropoffInstructionsContainer}>
                  <View style={styles.instructionStep}>
                    <View style={[styles.instructionStepNumber, { backgroundColor: "rgba(16, 185, 129, 0.3)" }]}>
                      <Ionicons name="location" size={14} color="#fff" />
                    </View>
                    <Text style={styles.instructionStepText}>
                      Tap on the map or use your current location to set where you want to be dropped off.
                    </Text>
                  </View>
                  <View style={styles.instructionTipBanner}>
                    <View style={styles.instructionTipIcon}>
                      <Ionicons name="warning" size={16} color="#F59E0B" />
                    </View>
                    <Text style={styles.instructionTipText}>
                      Only select locations on <Text style={styles.instructionStepBold}>highways or national roads</Text> where the bus can safely stop.
                    </Text>
                  </View>
                </View>
              )}
            </View>
          )}
        </LinearGradient>
      </SafeAreaView>



      {/* Error Banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={20} color="#dc3545" />
          <Text style={styles.errorBannerText}>{error}</Text>
          <TouchableOpacity onPress={() => setError(null)}>
            <Ionicons name="close" size={20} color="#dc3545" />
          </TouchableOpacity>
        </View>
      )}

      {/* Enhanced Bottom Panel with Gradient */}
      <LinearGradient
        colors={theme === 'dark' ? ['#1e293b', '#0f172a'] : ['#ffffff', '#f1f5f9']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.bottomPanel}
      >
        {showPickupSelection ? (
          <View>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setShowPickupForm(!showPickupForm);
              }}
              style={styles.pickupHeaderContainer}
            >
              <View style={styles.pickupIconCircle}>
                <Ionicons name="location" size={24} color="#007AFF" />
              </View>
              <View style={{ flex: 1 }}>
                <SafeText style={styles.pickupTitle}>Set Pickup Location</SafeText>
                <View style={styles.pickupSubtitleRow}>
                  <Ionicons name="bus" size={12} color="#6B7280" />
                  <SafeText style={styles.pickupSubtitle}>
                    Bus: <Text style={{ fontWeight: '600', color: '#111827' }}>{selectedBus?.plate_number || "Unknown"}</Text>
                  </SafeText>
                </View>
              </View>
              <Ionicons
                name={showPickupForm ? "chevron-up" : "chevron-down"}
                size={22}
                color="#9CA3AF"
              />
            </TouchableOpacity>

            {showPickupForm && (
              <>
                {!pickupLocation ? (
                  <View style={styles.pickupInstructionBanner}>
                    <Ionicons name="navigate-circle-outline" size={22} color="#007AFF" />
                    <Text style={styles.pickupInstructionText}>
                      Tap anywhere on the <Text style={{ fontWeight: '700' }}>blue route line</Text> or use your current location.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.pickupSelectedBanner}>
                    <Ionicons name="checkmark-circle" size={22} color="#10B981" />
                    <Text style={styles.pickupSelectedText}>
                      Pickup location selected successfully!
                    </Text>
                  </View>
                )}

                {pickupLocation && (
                  <View style={styles.passengerCard}>
                    <View style={styles.passengerCardHeader}>
                      <Ionicons name="people-circle" size={22} color="#4B5563" />
                      <Text style={styles.passengerLabel}>Number of Passengers</Text>
                    </View>

                    <View style={styles.passengerControlsContainer}>
                      <TouchableOpacity
                        style={[
                          styles.passengerBtn,
                          passengerCount <= 1 && styles.passengerBtnDisabled,
                        ]}
                        onPress={() =>
                          setPassengerCount((prev) => Math.max(1, prev - 1))
                        }
                        disabled={passengerCount <= 1}
                      >
                        <Ionicons name="remove" size={24} color={passengerCount <= 1 ? "#D1D5DB" : "#007AFF"} />
                      </TouchableOpacity>

                      <View style={styles.passengerCountDisplay}>
                        <Text style={styles.passengerCountNum}>{passengerCount}</Text>
                        <Text style={styles.passengerCountLabelSmall}>person{passengerCount !== 1 ? 's' : ''}</Text>
                      </View>

                      <TouchableOpacity
                        style={[
                          styles.passengerBtn,
                          selectedBus &&
                            typeof selectedBus.capacity === "number" &&
                            passengerCount >=
                            selectedBus.capacity - (selectedBus.passengers || 0)
                            ? styles.passengerBtnDisabled
                            : undefined,
                        ]}
                        onPress={() => setPassengerCount((prev) => prev + 1)}
                        disabled={
                          !!(
                            selectedBus &&
                            typeof selectedBus.capacity === "number" &&
                            passengerCount >=
                            selectedBus.capacity - (selectedBus.passengers || 0)
                          )
                        }
                      >
                        <Ionicons name="add" size={24} color="#007AFF" />
                      </TouchableOpacity>
                    </View>

                    {selectedBus && typeof selectedBus.capacity === "number" && (
                      <View style={styles.seatsAvailableContainer}>
                        <Text style={styles.seatsAvailableText}>
                          <Text style={{ fontWeight: '700', color: '#10B981' }}>{selectedBus.capacity - (selectedBus.passengers || 0)}</Text> seats available on this bus
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                <TouchableOpacity
                  style={[
                    styles.currentLocationButtonEnhanced,
                    locationLoading ? styles.disabledButton : undefined,
                  ]}
                  onPress={handleUseCurrentLocation}
                  disabled={locationLoading}
                >
                  {locationLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="locate" size={18} color="#fff" />
                      <Text style={styles.buttonTextEnhanced}>Use My Current Location</Text>
                    </>
                  )}
                </TouchableOpacity>

                <View style={styles.actionButtonRowEnhanced}>
                  <TouchableOpacity
                    style={[styles.actionButtonEnhanced, styles.cancelButtonEnhanced]}
                    onPress={handleCancelPickup}
                  >
                    <Text style={styles.cancelButtonTextEnhanced}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.actionButtonEnhanced,
                      styles.confirmButtonEnhanced,
                      (!pickupLocation || isSubmittingPickup) &&
                      styles.disabledButtonEnhanced,
                    ]}
                    onPress={handleConfirmPickup}
                    disabled={!pickupLocation || isSubmittingPickup}
                  >
                    {isSubmittingPickup ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <>
                        <Text style={styles.confirmButtonTextEnhanced}>Confirm Pickup</Text>
                        <Ionicons name="arrow-forward" size={18} color="#fff" />
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        ) : (
          <>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setShowBusList(!showBusList);
              }}
              style={styles.pickupHeaderContainer}
            >
              <View style={styles.pickupIconCircle}>
                <Ionicons name="map" size={24} color="#007AFF" />
              </View>
              <View style={{ flex: 1 }}>
                <SafeText style={styles.pickupTitle}>{nearestRoute?.name || "Unknown Route"}</SafeText>
                <View style={styles.pickupSubtitleRow}>
                  <Ionicons name="bus" size={12} color="#6B7280" />
                  <SafeText style={styles.pickupSubtitle}>
                    <Text style={{ fontWeight: '600', color: '#111827' }}>
                      {buses.filter((bus) => bus.status === "active").length}
                    </Text> Active Buses Nearby
                  </SafeText>
                </View>
              </View>
              <Ionicons
                name={showBusList ? "chevron-down" : "chevron-up"}
                size={22}
                color="#9CA3AF"
              />
            </TouchableOpacity>

            {showBusList && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 8, paddingHorizontal: 4 }}>
                {buses.map((bus) => {
                  const availableSeats =
                    typeof bus.capacity === "number" &&
                      typeof bus.passengers === "number"
                      ? Math.max(bus.capacity - bus.passengers, 0)
                      : 0;
                  const isActive = bus.status === "active";
                  const isSelected = selectedBus?.id === bus.id;

                  return (
                    <TouchableOpacity
                      key={bus.id}
                      style={[
                        styles.busCard,
                        {
                          backgroundColor: "#fff",
                          borderColor: isSelected
                            ? "#007AFF"
                            : isActive
                              ? "rgba(0,0,0,0.1)"
                              : "#ffebee",
                          borderWidth: isSelected ? 2 : 1,
                          shadowColor: isSelected ? "#007AFF" : "#000",
                          shadowOpacity: isSelected ? 0.15 : 0.08,
                          shadowRadius: isSelected ? 8 : 4,
                          elevation: isSelected ? 4 : 2,
                          transform: isSelected
                            ? [{ scale: 1.02 }]
                            : [{ scale: 1 }],
                        },
                      ]}
                      onPress={() => {
                        setModalBus(bus);
                        setShowBusModal(true);
                      }}
                      disabled={!isActive}
                      activeOpacity={0.8}
                    >
                      <View style={styles.busCardHeader}>
                        <View style={[styles.busIconBadge, { backgroundColor: isActive ? "#E3F2FD" : "#FFEBEE" }]}>
                          <Ionicons name="bus" size={20} color={isActive ? "#007AFF" : "#FF5252"} />
                        </View>
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <Text style={[styles.busPlate, { color: textColor, marginBottom: 0 }]}>
                            {bus.plate_number || "N/A"}
                          </Text>
                          <Text style={[styles.busStatusText, { color: isActive ? "#4CAF50" : "#FF5252" }]}>
                            {isActive ? "• Active Now" : "• Inactive"}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.busCardBody}>
                        <View style={styles.busInfoItem}>
                          <Ionicons name="person-circle-outline" size={16} color="#666" />
                          <Text style={styles.busInfoText} numberOfLines={1}>
                            {bus.driver?.fullName || "No driver"}
                          </Text>
                        </View>
                        <View style={styles.busInfoItem}>
                          <Ionicons name="people-outline" size={16} color="#666" />
                          <Text style={[styles.busInfoText, { color: AvailableSeatsColor(availableSeats) }]}>
                            {availableSeats} seats left
                          </Text>
                        </View>
                      </View>

                      {availableSeats > 0 && (
                        <View style={styles.capacityBar}>
                          <View
                            style={[
                              styles.capacityFill,
                              {
                                width: `${((bus.passengers || 0) / (bus.capacity || 1)) *
                                  100
                                  }%`,
                                backgroundColor:
                                  availableSeats > 5
                                    ? "#4CAF50"
                                    : availableSeats > 2
                                      ? "#FFC107"
                                      : "#FF5252",
                              },
                            ]}
                          />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
                {buses.length === 0 && (
                  <View style={styles.noBusesContainer}>
                    <View style={styles.noBusesIconCircle}>
                      <Ionicons name="bus-outline" size={32} color="#999" />
                    </View>
                    <Text style={styles.noBusesText}>
                      No buses available nearby
                    </Text>
                    <Text style={styles.noBusesSubtext}>
                      Wait a moment or pull down to refresh
                    </Text>
                  </View>
                )}
              </ScrollView>
            )}
          </>
        )}
      </LinearGradient>

      {/* Enhanced Bus Details Modal */}
      <Modal
        visible={showBusModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowBusModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentCard}>
            {/* Premium Gradient Header */}
            <LinearGradient
              colors={['#007AFF', '#0055CC']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.modalHeader}
            >
              <View style={styles.modalHeaderIcon}>
                <Ionicons name="bus" size={36} color="#fff" />
              </View>
              <Text style={styles.modalTitle}>Bus Details</Text>
              <Text style={styles.modalSubtitle}>Vehicle Information</Text>
            </LinearGradient>

            <View style={styles.modalBody}>
              {/* Plate Number & Status Row */}
              <View style={styles.detailRow}>
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Plate Number</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                    <Ionicons name="card" size={18} color="#007AFF" style={{ marginRight: 8 }} />
                    <Text style={styles.detailValue}>{modalBus?.plate_number}</Text>
                  </View>
                </View>
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Status</Text>
                  <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: modalBus?.status === 'active' ? '#E8F5E9' : '#FFEBEE',
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 20,
                    marginTop: 4,
                    alignSelf: 'flex-start',
                  }}>
                    <View style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: modalBus?.status === 'active' ? '#4CAF50' : '#FF5252',
                      marginRight: 6,
                    }} />
                    <Text style={{
                      fontSize: 13,
                      fontWeight: '700',
                      color: modalBus?.status === 'active' ? '#2E7D32' : '#C62828',
                    }}>
                      {modalBus?.status === 'active' ? 'Active' : 'Inactive'}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Driver Section */}
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Driver</Text>
                <View style={styles.driverRow}>
                  <LinearGradient
                    colors={['#E3F2FD', '#BBDEFB']}
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 24,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="person" size={24} color="#007AFF" />
                  </LinearGradient>
                  <Text style={styles.driverValue}>{modalBus?.driver?.fullName || "No driver assigned"}</Text>
                </View>
              </View>

              {/* Capacity Section */}
              <View style={styles.detailSection}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <Text style={styles.detailLabel}>Seat Availability</Text>
                  <View style={{
                    flexDirection: 'row',
                    alignItems: 'baseline',
                  }}>
                    <Text style={{
                      fontSize: 24,
                      fontWeight: '800',
                      color: '#007AFF',
                    }}>
                      {typeof modalBus?.capacity === 'number' && typeof modalBus?.passengers === 'number'
                        ? Math.max(modalBus.capacity - modalBus.passengers, 0)
                        : '?'}
                    </Text>
                    <Text style={styles.seatCountValue}>
                      /{modalBus?.capacity ?? "N/A"} seats
                    </Text>
                  </View>
                </View>
                <View style={styles.modalCapacityBarBg}>
                  <LinearGradient
                    colors={['#007AFF', '#00C6FF']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[
                      styles.modalCapacityBarFill,
                      {
                        width: modalBus?.capacity && modalBus?.passengers
                          ? `${(modalBus.passengers / modalBus.capacity) * 100}%`
                          : '0%',
                      }
                    ]}
                  />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                  <Text style={{ fontSize: 11, color: '#9CA3AF' }}>Empty</Text>
                  <Text style={{ fontSize: 11, color: '#9CA3AF' }}>Full</Text>
                </View>
              </View>
            </View>

            {/* Footer Buttons */}
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setShowBusModal(false)}
              >
                <Text style={styles.modalCloseText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalSelectButton,
                  modalBus?.status !== "active" && { opacity: 0.5 },
                ]}
                onPress={() => {
                  if (modalBus?.status === "active") {
                    setShowBusModal(false);
                    handleBusSelect(modalBus);
                  }
                }}
                disabled={modalBus?.status !== "active"}
              >
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.modalSelectText}>Select Bus</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Waiting for Approval Modal */}
      <Modal
        visible={showWaitingModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          // Don't allow closing the modal - user must wait for response
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.waitingModalContentEnhanced}>
            <View style={styles.waitingHeaderEnhanced}>
              <View style={styles.waitingIconWrapper}>
                <ActivityIndicator size="large" color="#FF9500" style={{ position: 'absolute' }} />
                <View style={[styles.waitingIconCircle, { opacity: 0.2, transform: [{ scale: 1.5 }] }]} />
                <Ionicons name="time" size={32} color="#FF9500" />
              </View>
              <Text style={styles.waitingTitleEnhanced}>Waiting for Approval</Text>
              <Text style={styles.waitingSubtitleEnhanced}>Request sent to driver</Text>
            </View>

            {waitingPickupRequest && (
              <View style={styles.waitingDetailsEnhanced}>
                <View style={styles.waitingInfoRowEnhanced}>
                  <View style={styles.waitingInfoIcon}>
                    <Ionicons name="bus" size={18} color="#007AFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.waitingLabel}>Bus</Text>
                    <Text style={styles.waitingValue}>{waitingPickupRequest.busPlateNumber}</Text>
                  </View>
                </View>
                <View style={styles.waitingDivider} />
                <View style={styles.waitingInfoRowEnhanced}>
                  <View style={styles.waitingInfoIcon}>
                    <Ionicons name="person" size={18} color="#007AFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.waitingLabel}>Driver</Text>
                    <Text style={styles.waitingValue}>{waitingPickupRequest.driverName}</Text>
                  </View>
                </View>
              </View>
            )}

            <View style={styles.waitingStatusEnhanced}>
              <Text style={styles.waitingStatusTextEnhanced}>
                Please stay on this screen.
              </Text>
              <Text style={styles.waitingStatusSubtextEnhanced}>
                You will be notified immediately once the driver responds to your pickup request.
              </Text>
            </View>
          </View>
        </View>
      </Modal>



      {/* Location Permission Alert */}
      <Modal
        visible={showLocationPermissionAlert}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLocationPermissionAlert(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Ionicons name="location" size={48} color="#007AFF" />
            <Text style={styles.modalTitle}>Location Permission Required</Text>
            <Text style={styles.modalText}>
              To use your current location for pickup, please enable location
              permissions in your device settings.
            </Text>
            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={[styles.actionButton, styles.cancelButton]}
                onPress={() => setShowLocationPermissionAlert(false)}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.confirmButton]}
                onPress={() => {
                  setShowLocationPermissionAlert(false);
                  // You can add logic to open settings here
                }}
              >
                <Text style={styles.buttonText}>Open Settings</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}



const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  loadingText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 10,
    color: '#333',
  },
  loadingSubtext: {
    fontSize: 14,
    color: '#666',
    marginTop: 5,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 10,
    marginBottom: 5,
  },
  errorText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  errorButtonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 100,
  },
  cancelButton: {
    backgroundColor: '#f3f4f6',
  },
  confirmButton: {
    backgroundColor: '#007AFF',
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  goBackButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    marginTop: 10,
  },
  destinationMarkerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  destinationIcon: {
    width: 40,
    height: 40,
  },
  routeMarkerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeMarkerIcon: {
    width: 32,
    height: 32,
  },
  pickupMarkerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
  },
  pickupMarkerHead: {
    backgroundColor: '#10B981',
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  pickupMarkerPoint: {
    width: 4,
    height: 10,
    backgroundColor: '#10B981',
    marginTop: -2,
    borderRadius: 2,
  },
  userMarkerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  userLocationDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    zIndex: 2,
  },
  userLocationRipple: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 122, 255, 0.2)',
    zIndex: 1,
  },
  userMarkerIcon: {
    width: 40,
    height: 40,
  },
  busMarkerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  busMarkerIcon: {
    width: 36,
    height: 36,
    marginBottom: 4,
  },
  busMarkerPointer: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  enhancedHeaderContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  enhancedHeaderGradient: {
    paddingTop: Platform.OS === 'ios' ? 44 : 40,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  headerDecorCircle1: {
    position: 'absolute',
    top: -20,
    right: -20,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  headerDecorCircle2: {
    position: 'absolute',
    bottom: -10,
    left: 40,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  enhancedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  enhancedBackButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  enhancedHeaderInfo: {
    flex: 1,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  enhancedHeaderTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  enhancedHeaderSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '500',
  },
  enhancedRefreshButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshingButton: {
    opacity: 0.7,
  },
  instructionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  instructionsHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  instructionsHeaderText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginLeft: 8,
  },
  instructionsToggle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  instructionsContainer: {
    marginTop: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    padding: 12,
  },
  instructionStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  instructionStepNumber: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  instructionStepNumberText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#0052d4',
  },
  instructionStepText: {
    flex: 1,
    fontSize: 13,
    color: '#fff',
    lineHeight: 18,
  },
  instructionStepBold: {
    fontWeight: '700',
  },
  instructionTipBanner: {
    flexDirection: 'row',
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
    alignItems: 'center',
  },
  instructionTipIcon: {
    marginRight: 8,
  },
  instructionTipText: {
    fontSize: 12,
    color: '#fff',
    flex: 1,
  },
  dropoffInstructionsContainer: {
    marginTop: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    padding: 12,
  },
  errorBanner: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 140 : 120,
    left: 20,
    right: 20,
    backgroundColor: '#fee2e2',
    padding: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 9,
    borderWidth: 1,
    borderColor: '#fecaca',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  errorBannerText: {
    flex: 1,
    marginLeft: 10,
    marginRight: 10,
    color: '#b91c1c',
    fontSize: 14,
    fontWeight: '500',
  },
  bottomPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 16,
  },
  pickupHeaderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  pickupIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E3F2FD',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  pickupTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 2,
  },
  pickupSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pickupSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginLeft: 4,
  },
  pickupInstructionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EBF5FF',
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#007AFF',
  },
  pickupInstructionText: {
    flex: 1,
    fontSize: 14,
    color: '#1E40AF',
    marginLeft: 10,
    lineHeight: 20,
  },
  pickupSelectedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#10B981',
  },
  pickupSelectedText: {
    flex: 1,
    fontSize: 14,
    color: '#065F46',
    marginLeft: 10,
    fontWeight: '600',
  },
  passengerCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  passengerCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  passengerLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
    marginLeft: 8,
  },
  passengerControlsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  passengerBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  passengerBtnDisabled: {
    opacity: 0.5,
  },
  passengerCountDisplay: {
    alignItems: 'center',
  },
  passengerCountNum: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
  },
  passengerCountLabelSmall: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: -2,
  },
  seatsAvailableContainer: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  seatsAvailableText: {
    fontSize: 13,
    color: '#4B5563',
  },
  currentLocationButtonEnhanced: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4B5563',
    paddingVertical: 14,
    borderRadius: 14,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  disabledButton: {
    opacity: 0.7,
  },
  buttonTextEnhanced: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 8,
  },
  actionButtonRowEnhanced: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButtonEnhanced: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  cancelButtonEnhanced: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cancelButtonTextEnhanced: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4B5563',
  },
  confirmButtonEnhanced: {
    backgroundColor: '#007AFF',
    flexDirection: 'row',
    gap: 8,
  },
  disabledButtonEnhanced: {
    backgroundColor: '#93C5FD',
    elevation: 0,
    shadowOpacity: 0,
  },
  confirmButtonTextEnhanced: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  busCard: {
    width: 280,
    marginRight: 16,
    borderRadius: 16,
    padding: 0,
    overflow: 'hidden',
    marginBottom: 4,
  },
  busCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  busIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  busPlate: {
    fontSize: 16,
    fontWeight: '700',
  },
  busStatusText: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  busCardBody: {
    padding: 12,
    gap: 8,
  },
  busInfoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  busInfoText: {
    fontSize: 14,
    color: '#4b5563',
  },
  capacityBar: {
    height: 4,
    backgroundColor: '#f3f4f6',
    marginTop: 8,
  },
  capacityFill: {
    height: '100%',
  },
  noBusesContainer: {
    width: 300,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f0f0f0',
    borderStyle: 'dashed',
  },
  noBusesIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  noBusesText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  noBusesSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContentCard: {
    backgroundColor: '#fff',
    borderRadius: 28,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.25,
    shadowRadius: 32,
    elevation: 24,
    width: '100%',
    maxWidth: 380,
  },
  modalHeader: {
    alignItems: 'center',
    paddingTop: 28,
    paddingBottom: 24,
    paddingHorizontal: 20,
    backgroundColor: '#007AFF',
  },
  modalHeaderIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  modalBody: {
    padding: 24,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  detailItem: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 6,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  detailValue: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  detailSection: {
    marginBottom: 24,
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  driverValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginLeft: 12,
  },
  seatCountValue: {
    fontSize: 14,
    color: '#6B7280',
  },
  modalCapacityBarBg: {
    height: 12,
    backgroundColor: '#F3F4F6',
    borderRadius: 6,
    overflow: 'hidden',
  },
  modalCapacityBarFill: {
    height: '100%',
    borderRadius: 6,
  },
  modalFooter: {
    flexDirection: 'row',
    padding: 20,
    backgroundColor: '#F9FAFB',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    gap: 12,
  },
  modalCloseButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  modalSelectButton: {
    flex: 2,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  modalSelectText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },

  // Legacy "simple" modal styles (still referenced in some JSX)
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    width: '90%',
    maxWidth: 400,
    alignItems: 'center',
  },
  modalText: {
    fontSize: 16,
    color: '#4B5563',
    textAlign: 'center',
    marginVertical: 12,
    lineHeight: 24,
  },
  modalButtonRow: {
    flexDirection: 'row',
    marginTop: 20,
    width: '100%',
    justifyContent: 'space-between',
    gap: 12,
  },

  // Waiting modal (enhanced)
  waitingModalContentEnhanced: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    width: '90%',
    maxWidth: 400,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  waitingHeaderEnhanced: {
    alignItems: 'center',
    marginBottom: 16,
  },
  waitingIconWrapper: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  waitingIconCircle: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FF9500',
  },
  waitingTitleEnhanced: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
    textAlign: 'center',
  },
  waitingSubtitleEnhanced: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
  },
  waitingDetailsEnhanced: {
    width: '100%',
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 24,
  },
  waitingInfoRowEnhanced: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  waitingInfoIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E3F2FD',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  waitingLabel: {
    fontSize: 12,
    color: '#6B7280',
    textTransform: 'uppercase',
    fontWeight: '600',
    marginBottom: 2,
  },
  waitingValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
  },
  waitingDivider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 12,
    marginLeft: 48,
  },
  waitingStatusEnhanced: {
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FCD34D',
    width: '100%',
  },
  waitingStatusTextEnhanced: {
    fontSize: 14,
    fontWeight: '700',
    color: '#B45309',
    marginBottom: 4,
  },
  waitingStatusSubtextEnhanced: {
    fontSize: 12,
    color: '#92400E',
    textAlign: 'center',
  },

  // Compass Direction Indicator Styles
  userMarkerWithCompass: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compassConeContainer: {
    position: 'absolute',
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
