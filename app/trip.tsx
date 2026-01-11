import { mapDarkStyle } from "@/constants/mapDarkStyle";
import { useAuth } from "@/contexts/AuthContext";
import { useAppTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Camera, LatLng, Marker, Polyline } from "react-native-maps";
import QRCode from "react-native-qrcode-svg";

type BusLocation = LatLng;

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLEMAPS_API;

const haversineMeters = (a: LatLng, b: LatLng) => {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * R * Math.asin(Math.sqrt(h));
};

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

// Helper: Find minimum distance from bus to route
const getMinDistanceToRoute = (busLocation: LatLng, route: LatLng[]) => {
  if (!busLocation || !route.length) return Infinity;
  return Math.min(...route.map((pt) => haversineMeters(busLocation, pt)));
};

export default function TripScreen() {
  const { theme } = useAppTheme();
  const { session } = useAuth();
  const params = useLocalSearchParams();
  const mapRef = useRef<MapView>(null);
  const previousLocationRef = useRef<BusLocation | null>(null);
  const tripFinalizedRef = useRef(false);

  const busId = params.busId as string;
  const initialPlateNumber = (params.busPlateNumber as string) || "Unknown Bus";
  const passengerCount = parseInt(params.passengerCount as string) || 1;

  // State for bus plate number (can be updated if initially unknown)
  const [busPlateNumber, setBusPlateNumber] =
    useState<string>(initialPlateNumber);
  const pickupCoords: LatLng = {
    latitude: parseFloat(params.pickupLat as string),
    longitude: parseFloat(params.pickupLng as string),
  };
  const destCoords: LatLng = {
    latitude: parseFloat(params.destLat as string),
    longitude: parseFloat(params.destLng as string),
  };
  // Parse the complete route path (same approach as DrivingModeScreen)
  let completeRoutePath: LatLng[] = [];
  try {
    const routePathParam = params.routePath as string;

    if (routePathParam && routePathParam !== "[]") {
      const routePath: [number, number][] = JSON.parse(routePathParam);
      completeRoutePath = routePath.map(([lng, lat]) => ({
        latitude: lat,
        longitude: lng,
      }));
    }
  } catch (e) {
    completeRoutePath = [];
  }

  // Keep the original polylineCoords for backward compatibility
  const polylineCoords = useMemo(() => completeRoutePath, [completeRoutePath]);

  const [busLocation, setBusLocation] = useState<BusLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [eta, setEta] = useState<string | null>("Calculating...");

  // Trip status flow: 'waiting' until conductor scans QR, then 'picked_up'
  const [tripStatus, setTripStatus] = useState<"waiting" | "picked_up">(
    "waiting"
  );
  const [saving, setSaving] = useState(false);
  const [showQRCode, setShowQRCode] = useState(true);

  // Enhanced route display
  const [completeRoute, setCompleteRoute] =
    useState<LatLng[]>(completeRoutePath);
  const [pickupToDestinationRoute, setPickupToDestinationRoute] = useState<
    LatLng[]
  >([]);
  const [routeLoading, setRouteLoading] = useState(false);

  // transient overlay after successful scan
  const [showScanSuccess, setShowScanSuccess] = useState(false);
  const prevStatusRef = useRef<"waiting" | "picked_up">("waiting");

  // added: resolved location names
  const [pickupName, setPickupName] = useState<string | null>(null);
  const [destinationName, setDestinationName] = useState<string | null>(null);

  // added: bottom panel minimize state
  const [isPanelMinimized, setIsPanelMinimized] = useState(false);

  // added: track if scan success has been shown
  const scanSuccessShownRef = useRef(false);

  // added: off-route warning state
  const [offRouteWarning, setOffRouteWarning] = useState(false);

  // Trip Summary Modal State
  const [showTripSummary, setShowTripSummary] = useState(false);
  const [tripSummaryData, setTripSummaryData] = useState<{
    startTime: Date | null;
    endTime: Date | null;
    duration: string;
    distance: string;
    pickupLocation: string;
    destination: string;
    busPlate: string;
    status: "completed" | "cancelled";
  }>({
    startTime: null,
    endTime: null,
    duration: "0 min",
    distance: "0 km",
    pickupLocation: "Unknown",
    destination: "Unknown",
    busPlate: "Unknown",
    status: "completed",
  });

  // Track trip start time
  const [tripStartTime, setTripStartTime] = useState<Date | null>(null);

  // Drop off / Cancel confirmation modal state
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);

  // added: reverse geocoding with caching
  const geocodeCache = useRef<Map<string, string>>(new Map());

  // Clear caches periodically to prevent memory buildup
  useEffect(() => {
    const cacheCleanupInterval = setInterval(() => {
      if (geocodeCache.current.size > 50) {
        geocodeCache.current.clear();
      }
      if (shownPickupAlerts.current.size > 20) {
        shownPickupAlerts.current.clear();
      }
    }, 60000); // Clear every minute if caches are too large

    return () => clearInterval(cacheCleanupInterval);
  }, []);

  // Track which pickup request alerts have been shown to prevent duplicates
  const shownPickupAlerts = useRef<Set<string>>(new Set());

  // Track if pickup request has been resolved (accepted/declined) to stop listening
  const pickupRequestResolved = useRef<boolean>(false);

  // Throttle ETA fetching to reduce memory usage
  const lastEtaFetch = useRef<number>(0);
  const ETA_FETCH_THROTTLE = 15000; // 15 seconds - increased to reduce API calls

  const reverseGeocode = async (coords: LatLng) => {
    if (!GOOGLE_MAPS_API_KEY) return null;

    // Create cache key
    const cacheKey = `${coords.latitude.toFixed(4)},${coords.longitude.toFixed(
      4
    )}`;

    // Check cache first
    if (geocodeCache.current.has(cacheKey)) {
      return geocodeCache.current.get(cacheKey) || null;
    }

    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${coords.latitude},${coords.longitude}&key=${GOOGLE_MAPS_API_KEY}`;
      const res = await fetch(url);
      const json = await res.json();
      const address = json.results?.[0]?.formatted_address || null;

      // Cache the result
      if (address) {
        geocodeCache.current.set(cacheKey, address);
      }

      return address;
    } catch {
      return null;
    }
  };

  // Function to fetch bus plate number if unknown
  const fetchBusPlateNumber = async () => {
    if (busPlateNumber !== "Unknown Bus" && busPlateNumber !== "Unknown") {
      return; // Already have valid plate number
    }

    try {
      const { data: busData, error } = await supabase
        .from("buses")
        .select("plate_number")
        .eq("id", busId)
        .single();

      if (error) {
        return;
      }

      if (busData?.plate_number) {
        setBusPlateNumber(busData.plate_number);
      }
    } catch (error) {
      // Silently handle error
    }
  };

  // added: resolve names once and fetch routes
  useEffect(() => {
    (async () => {
      const [start, end] = await Promise.all([
        reverseGeocode(pickupCoords),
        reverseGeocode(destCoords),
      ]);
      setPickupName(start);
      setDestinationName(end);

      // Fetch complete route from database if missing
      if (completeRoutePath.length === 0) {
        await fetchCompleteRouteFromDatabase();
      }

      // Fetch pickup-to-destination route so user can see the route they'll take
      await fetchPickupToDestinationRoute(pickupCoords, destCoords);
    })();
  }, []);

  // show green check for 0.5s when status becomes picked_up
  useEffect(() => {
    if (prevStatusRef.current === "waiting" && tripStatus === "picked_up") {
      setShowScanSuccess(true);
      setTimeout(() => setShowScanSuccess(false), 500);
    }
    prevStatusRef.current = tripStatus;
  }, [tripStatus]);

  // Check if bus is off route
  useEffect(() => {
    if (!busLocation || !completeRoute.length) return;
    const minDist = getMinDistanceToRoute(busLocation, completeRoute);
    setOffRouteWarning(minDist > 100); // 100 meters threshold
  }, [busLocation, completeRoute]);

  // QR payload the conductor can scan (adjust fields as backend expects)
  const qrPayload = useMemo(() => {
    const payload = {
      type: "pickup_request",
      busId,
      commuterId: session?.user?.id,
      tripId: params.tripId || "will-be-created",
      pickup: pickupCoords,
      dest: destCoords,
      passengerCount: passengerCount,
      ts: Date.now(),
    };
    return JSON.stringify(payload);
  }, [
    busId,
    session?.user?.id,
    params.tripId,
    pickupCoords,
    destCoords,
    passengerCount,
  ]);

  const fetchETA = async (origin: LatLng, destination: LatLng) => {
    if (!GOOGLE_MAPS_API_KEY) {
      setEta("Unavailable");
      return;
    }
    try {
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.latitude},${origin.longitude}&destination=${destination.latitude},${destination.longitude}&key=${GOOGLE_MAPS_API_KEY}`;
      const response = await fetch(url);
      const json = await response.json();

      if (json.routes.length > 0) {
        const durationText = json.routes[0].legs[0].duration.text;
        setEta(`${durationText}`);
      } else {
        setEta("ETA not found");
      }
    } catch (error) {
      setEta("Error calculating ETA");
    }
  };

  // Fetch complete route from database when missing (same approach as route-details.tsx)
  const fetchCompleteRouteFromDatabase = async () => {
    if (!busId) return;

    try {
      // First get the route_id from the bus
      const { data: busData, error: busError } = await supabase
        .from("buses")
        .select("id, route_id")
        .eq("id", busId)
        .single();

      if (busError || !busData) {
        return;
      }

      // Now fetch the route using the same RPC function as route-details.tsx
      const { data: routeData, error: routeError } = await supabase.rpc(
        "get_route_geojson",
        { route_id: busData.route_id }
      );

      if (routeError) {
        return;
      }

      if (!routeData || !routeData[0]) {
        return;
      }

      const rawRoute = routeData[0];

      // Use the same logic as route-details.tsx
      if (rawRoute && rawRoute.geojson) {
        const routeCoordinates = rawRoute.geojson.coordinates;
        const routePath: LatLng[] = routeCoordinates.map(
          ([lng, lat]: [number, number]) => ({
            latitude: lat,
            longitude: lng,
          })
        );

        setCompleteRoute(routePath);
      } else {
        // Fallback to direct line from pickup to destination
        const fallbackRoute: LatLng[] = [pickupCoords, destCoords];
        setCompleteRoute(fallbackRoute);
      }
    } catch (error) {
      // Silently handle error
    }
  };

  // Fetch pickup to destination route using Google Directions
  const fetchPickupToDestinationRoute = async (start: LatLng, end: LatLng) => {
    if (!GOOGLE_MAPS_API_KEY) {
      return;
    }

    setRouteLoading(true);
    try {
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${start.latitude},${start.longitude}&destination=${end.latitude},${end.longitude}&key=${GOOGLE_MAPS_API_KEY}`;
      const response = await fetch(url);
      const json = await response.json();

      if (json.routes && json.routes.length > 0) {
        const route = json.routes[0];
        const routePoints: LatLng[] = [];

        // Decode the polyline to get all route points
        if (route.overview_polyline && route.overview_polyline.points) {
          const decodedPoints = decodePolyline(route.overview_polyline.points);
          routePoints.push(...decodedPoints);
        }

        setPickupToDestinationRoute(routePoints);
      }
    } catch (error) {
      // Silently handle error
    } finally {
      setRouteLoading(false);
    }
  };

  // Decode Google Maps polyline
  const decodePolyline = (encoded: string): LatLng[] => {
    const points: LatLng[] = [];
    let index = 0;
    const len = encoded.length;
    let lat = 0;
    let lng = 0;

    while (index < len) {
      let b: number;
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

      points.push({
        latitude: lat / 1e5,
        longitude: lng / 1e5,
      });
    }

    return points;
  };

  // Calculate trip summary data
  const calculateTripSummary = useCallback(
    (endReason: "driver_ended" | "arrived" | "cancelled") => {
      const endTime = new Date();
      const startTime = tripStartTime || new Date(Date.now() - 30 * 60 * 1000); // Default to 30 mins ago if no start time

      // Calculate duration
      const durationMs = endTime.getTime() - startTime.getTime();
      const durationMinutes = Math.round(durationMs / (1000 * 60));
      const hours = Math.floor(durationMinutes / 60);
      const minutes = durationMinutes % 60;
      const durationText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes} min`;

      // Calculate approximate distance (using haversine)
      const distanceMeters = haversineMeters(pickupCoords, destCoords);
      const distanceKm = (distanceMeters / 1000).toFixed(1);

      const statusValue = (endReason === "cancelled" ? "cancelled" : "completed") as "cancelled" | "completed";

      return {
        startTime,
        endTime,
        duration: durationText,
        distance: `${distanceKm} km`,
        pickupLocation: pickupName || "Pickup location",
        destination: destinationName || "Destination",
        busPlate: busPlateNumber,
        status: statusValue,
      };
    },
    [tripStartTime, pickupCoords, destCoords, pickupName, destinationName, busPlateNumber]
  );

  const finalizeTrip = useCallback(
    async (reason: "driver_ended" | "arrived" | "cancelled", skipSummary = false) => {
      // If not skipping summary, show the trip summary modal first
      if (!skipSummary) {
        // Prevent multiple summary modals from showing
        if (showTripSummary) {
          return;
        }

        const summaryData = calculateTripSummary(reason);
        setTripSummaryData(summaryData);
        setShowTripSummary(true);
        return; // Don't finalize yet, let user see summary
      }

      if (tripFinalizedRef.current) return;
      tripFinalizedRef.current = true;
      if (!session?.user?.id) {
        Alert.alert("Not signed in", "Please sign in to save your trip.");
        return;
      }

      try {
        setSaving(true);

        // FIRST: Update trip_passengers status to completed/cancelled
        const newStatus = reason === "cancelled" ? "cancelled" : "completed";
        const { error: tripPassengerError } = await supabase
          .from("trip_passengers")
          .update({
            status: newStatus,
            updated_at: new Date().toISOString(),
          })
          .eq("passenger_id", session.user.id)
          .eq("bus_id", busId);

        if (tripPassengerError) {
          throw new Error("Failed to update trip status");
        }

        // SECOND: Save to travel history
        const startName = pickupName || "Pickup location";
        const endName = destinationName || "Destination";
        const { error: historyError } = await supabase
          .from("travel_history_commuter")
          .insert({
            user_id: session.user.id,
            start_location_name: startName,
            end_location_name: endName,
            travel_date: new Date().toISOString(),
            route_name: `Bus ${busPlateNumber}`,
            status: reason === "cancelled" ? "cancelled" : "completed",
          });

        if (historyError) {
          // Don't throw here - trip status is already updated, history is less critical
        }

        // Navigate directly to history without showing additional alerts
        router.replace("/(commuter)/history");
      } catch (e) {
        Alert.alert("Error", "Could not complete your trip. Please try again.");
        tripFinalizedRef.current = false;
      } finally {
        setSaving(false);
      }
    },
    [session?.user?.id, pickupName, destinationName, busPlateNumber, busId, calculateTripSummary, showTripSummary]
  );

  // QR code is now imported directly, no need for dynamic loading

  useEffect(() => {
    const fetchInitialLocation = async () => {
      if (!busId || !session?.user?.id) return;
      setLoading(true);
      try {
        // Check if passenger is already boarded or cancelled
        // Use limit(1) and order by created_at desc to get the most recent record
        const { data: existingBoardingRecords, error: boardingError } =
          await supabase
            .from("trip_passengers")
            .select("id, status, boarded_at")
            .eq("passenger_id", session.user.id)
            .eq("bus_id", busId)
            .order("created_at", { ascending: false })
            .limit(1);

        const existingBoarding = existingBoardingRecords?.[0];

        if (existingBoarding && !boardingError) {
          if (existingBoarding.status === "boarded") {
            setTripStatus("picked_up");
            setShowQRCode(false);
            // Don't show scan success on initial load if already boarded
            scanSuccessShownRef.current = true;
            // Fetch complete route since user is already boarded
            await fetchPickupToDestinationRoute(pickupCoords, destCoords);
          } else if (existingBoarding.status === "cancelled") {
            Alert.alert(
              "Trip Cancelled",
              "Your trip has been cancelled. You will be redirected to the home screen."
            );
            await finalizeTrip("cancelled");
            return;
          } else if (existingBoarding.status === "waiting") {
            setTripStatus("waiting");
          }
        } else {
          // No trip_passengers record found - this shouldn't happen if user came from route-details
          // Don't create a new record, just set status to waiting and let the conductor handle it
          setTripStatus("waiting");
        }

        // Location
        const { data, error } = await supabase.rpc("get_initial_bus_location", {
          p_bus_id: busId,
        });
        if (error) throw error;

        if (data?.coordinates) {
          const location = {
            latitude: data.coordinates[1],
            longitude: data.coordinates[0],
          };
          setBusLocation(location);
          previousLocationRef.current = location;
          // While waiting, ETA to pickup
          await fetchETA(
            location,
            tripStatus === "picked_up" ? destCoords : pickupCoords
          );
        } else {
          Alert.alert("Error", "Could not find the bus's initial location.");
        }

        // NEW: Fetch initial trip status (assumes trips.status reflects pickup)
        // Use limit(1) and order by created_at desc to get the most recent trip
        const { data: tripRows } = await supabase
          .from("trips")
          .select("status")
          .eq("bus_id", busId)
          .order("created_at", { ascending: false })
          .limit(1);

        const tripRow = tripRows?.[0];

        if (
          tripRow?.status &&
          `${tripRow.status}`.toLowerCase().includes("picked")
        ) {
          setTripStatus("picked_up");
          setShowQRCode(false);
          // Don't show scan success on initial load if already picked up
          scanSuccessShownRef.current = true;
          // Fetch complete route since user is already picked up
          await fetchPickupToDestinationRoute(pickupCoords, destCoords);
        } else if (!existingBoarding) {
          setTripStatus("waiting");
          setShowQRCode(true);
        }

        // Check if pickup request has already been resolved
        const { data: existingPickupRequest } = await supabase
          .from("pickup_requests")
          .select("id, status")
          .eq("commuter_id", session.user.id)
          .eq("bus_id", busId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (
          existingPickupRequest &&
          (existingPickupRequest.status === "accepted" ||
            existingPickupRequest.status === "declined")
        ) {
          pickupRequestResolved.current = true;
        }

        // Fetch bus plate number if unknown
        await fetchBusPlateNumber();
      } catch (err) {
        Alert.alert(
          "Error",
          "An error occurred while fetching the bus location."
        );
      } finally {
        setLoading(false);
      }
    };

    const initializeTrip = async () => {
      await fetchInitialLocation();
      await fetchBusPlateNumber(); // Fetch plate number if unknown
    };

    initializeTrip();
  }, [busId, session?.user?.id]);

  useEffect(() => {
    if (!busId || !session?.user?.id) return;

    // Listen for trip_passengers table changes to detect boarding and cancellation
    const passengerChannel = supabase
      .channel(`passenger-boarding-${session.user.id}-${busId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "trip_passengers",
          filter: `passenger_id=eq.${session.user.id}`,
        },
        async (payload) => {
          const newStatus = payload.new.status;
          const recordId = payload.new.id;
          const recordBusId = payload.new.bus_id;

          // Only process updates for the current bus
          if (recordBusId !== busId) {
            return;
          }

          if (newStatus === "boarded") {
            // Immediately update UI to show boarded status
            setTripStatus("picked_up");
            setShowQRCode(false); // Hide QR code immediately
            // Set trip start time when passenger is picked up
            setTripStartTime(new Date());

            // Fetch pickup to destination route
            await fetchPickupToDestinationRoute(pickupCoords, destCoords);

            // Only show scan success once
            if (!scanSuccessShownRef.current) {
              setShowScanSuccess(true);
              setTimeout(() => setShowScanSuccess(false), 2000);
              scanSuccessShownRef.current = true;
            }

            // Don't unsubscribe from passenger channel - we still need to listen for "completed" status
            // Only mark pickup request as resolved
            pickupRequestResolved.current = true;
          } else if (newStatus === "cancelled") {
            Alert.alert(
              "Trip Cancelled",
              "The driver has cancelled your trip. You will be redirected to the home screen."
            );
            await finalizeTrip("cancelled");
          } else if (newStatus === "completed") {
            // Unsubscribe from passenger channel since trip is now complete
            supabase.removeChannel(passengerChannel);
            // Show trip summary directly without alert
            await finalizeTrip("arrived");
          }
        }
      )
      .subscribe((status) => { });

    // Return cleanup function
    return () => {
      supabase.removeChannel(passengerChannel);
    };
  }, [busId, session?.user?.id]);

  useEffect(() => {
    if (!busId || !session?.user?.id) return;

    // Only listen for pickup request changes if request not resolved
    if (!pickupRequestResolved.current) {
      const pickupRequestChannel = supabase
        .channel(`pickup-request-${session.user.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "pickup_requests",
            filter: `commuter_id=eq.${session.user.id}`,
          },
          async (payload) => {
            const newStatus = payload.new.status;
            const requestId = payload.new.id;
            const alertKey = `${requestId}-${newStatus}`;

            // Check if pickup request has already been resolved
            if (pickupRequestResolved.current) {
              return;
            }

            // Check if we've already shown this alert
            if (shownPickupAlerts.current.has(alertKey)) {
              return;
            }

            if (newStatus === "declined") {
              pickupRequestResolved.current = true; // Mark as resolved
              shownPickupAlerts.current.add(alertKey);
              Alert.alert(
                "Pickup Request Declined",
                "The driver has declined your pickup request. You will be redirected to find another bus.",
                [
                  {
                    text: "OK",
                    onPress: () => {
                      router.replace("/(commuter)");
                    },
                  },
                ]
              );
            } else if (newStatus === "accepted") {
              pickupRequestResolved.current = true; // Mark as resolved
              shownPickupAlerts.current.add(alertKey);
              Alert.alert(
                "Pickup Request Accepted! ✅",
                "The driver has accepted your pickup request. Please wait for the bus to arrive at your pickup location.",
                [{ text: "OK" }]
              );
            }
          }
        )
        .subscribe((status) => { });

      // Return cleanup function for pickup request channel
      return () => {
        supabase.removeChannel(pickupRequestChannel);
      };
    } else {
    }

    // Fallback: Poll for boarding status every 5 seconds
    const checkBoardingStatus = async () => {
      try {
        // Skip polling if trip is already completed
        if (tripFinalizedRef.current) {
          return;
        }

        // Use limit(1) and order by created_at desc to get the most recent record
        const { data: boardingRecords, error } = await supabase
          .from("trip_passengers")
          .select("id, status, boarded_at")
          .eq("passenger_id", session.user.id)
          .eq("bus_id", busId)
          .order("created_at", { ascending: false })
          .limit(1);

        const boardingRecord = boardingRecords?.[0];

        if (boardingRecord && !error) {
          if (boardingRecord.status === "boarded") {
            setTripStatus("picked_up");
            setShowQRCode(false); // Hide QR code immediately

            // Fetch pickup to destination route
            await fetchPickupToDestinationRoute(pickupCoords, destCoords);

            // Only show scan success once
            if (!scanSuccessShownRef.current) {
              setShowScanSuccess(true);
              setTimeout(() => setShowScanSuccess(false), 2000);
              scanSuccessShownRef.current = true;
            }

            pickupRequestResolved.current = true; // Mark pickup request as resolved
          } else if (boardingRecord.status === "cancelled") {
            Alert.alert(
              "Trip Cancelled",
              "The driver has cancelled your trip. You will be redirected to the home screen."
            );
            await finalizeTrip("cancelled");
          } else if (boardingRecord.status === "completed") {
            // Show trip summary directly without alert
            await finalizeTrip("arrived");
          }
        } else if (error) {
          // Silently handle polling errors
        }
      } catch (err) { }
    };

    // Fallback: Poll for pickup request status every 10 seconds
    const checkPickupRequestStatus = async () => {
      try {
        // Skip polling if pickup request has been resolved or trip is completed
        if (pickupRequestResolved.current || tripFinalizedRef.current) {
          return;
        }

        const { data: pickupRequest, error } = await supabase
          .from("pickup_requests")
          .select("id, status")
          .eq("commuter_id", session.user.id)
          .eq("bus_id", busId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (pickupRequest && !error) {
          const alertKey = `${pickupRequest.id}-${pickupRequest.status}`;

          // Check if we've already shown this alert
          if (shownPickupAlerts.current.has(alertKey)) {
            return;
          }

          if (pickupRequest.status === "declined") {
            pickupRequestResolved.current = true; // Mark as resolved
            shownPickupAlerts.current.add(alertKey);
            Alert.alert(
              "Pickup Request Declined",
              "The driver has declined your pickup request. You will be redirected to find another bus.",
              [
                {
                  text: "OK",
                  onPress: () => {
                    router.replace("/(commuter)");
                  },
                },
              ]
            );
          } else if (pickupRequest.status === "accepted") {
            pickupRequestResolved.current = true; // Mark as resolved
            shownPickupAlerts.current.add(alertKey);
            Alert.alert(
              "Pickup Request Accepted! ✅",
              "The driver has accepted your pickup request. Please wait for the bus to arrive at your pickup location.",
              [{ text: "OK" }]
            );
          }
        }
      } catch (err) { }
    };

    // Check immediately and then every 8 seconds for boarding, every 15 seconds for pickup requests
    checkBoardingStatus();
    checkPickupRequestStatus();
    const boardingPollingInterval = setInterval(checkBoardingStatus, 8000); // Reduced frequency
    const pickupPollingInterval = setInterval(checkPickupRequestStatus, 15000); // Reduced frequency

    // Listen for trip updates (location and status)
    const tripChannel = supabase
      .channel(`realtime-trip-${busId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "trips",
          filter: `bus_id=eq.${busId}`,
        },
        async (payload) => {
          const updatedTrip = payload.new as any;

          // Location update
          if (updatedTrip.current_location?.coordinates) {
            const newLocation: LatLng = {
              latitude: updatedTrip.current_location.coordinates[1],
              longitude: updatedTrip.current_location.coordinates[0],
            };
            setBusLocation(newLocation);

            // Throttle ETA fetching to reduce memory usage
            const now = Date.now();
            if (now - lastEtaFetch.current > ETA_FETCH_THROTTLE) {
              lastEtaFetch.current = now;
              await fetchETA(
                newLocation,
                tripStatus === "picked_up" ? destCoords : pickupCoords
              );
            }

            const prevLocation = previousLocationRef.current;
            let heading = 0;
            if (prevLocation) {
              heading = calculateBearing(prevLocation, newLocation);
            }

            // Enhanced camera animations for better driving mode experience
            const camera: Partial<Camera> = {
              center: newLocation,
              pitch: tripStatus === "picked_up" ? 85 : 90, // Lower pitch when boarded for better route view
              heading: heading,
              zoom: tripStatus === "picked_up" ? 16 : 18, // Slightly zoomed out when boarded to see more route
            };

            // Smooth camera animation matched to update interval
            mapRef.current?.animateCamera(camera, { duration: 1000 });
            previousLocationRef.current = newLocation;

            // Auto-finish near destination
            if (tripStatus === "picked_up") {
              try {
                const d = haversineMeters(newLocation, destCoords);
                if (d <= 60) {
                  await finalizeTrip("arrived");
                }
              } catch { }
            }
          }

          // React to terminal status changes
          if (updatedTrip?.status) {
            const statusText = `${updatedTrip.status}`.toLowerCase();

            if (
              statusText.includes("completed") ||
              statusText.includes("ended") ||
              statusText.includes("arrived")
            ) {
              await finalizeTrip("driver_ended");
            }
            if (statusText.includes("cancel")) {
              await finalizeTrip("cancelled");
            }
          }
        }
      )
      .subscribe((status) => { });

    return () => {
      supabase.removeChannel(tripChannel);
      clearInterval(boardingPollingInterval);
      clearInterval(pickupPollingInterval);
    };
  }, [busId, session?.user?.id]);

  // Loading state remains the same
  if (loading) {
    return (
      <View style={styles.centered}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingTitle}>Loading Trip Details</Text>
          <Text style={styles.loadingSubtext}>
            Getting your bus location and trip information...
          </Text>
        </View>
      </View>
    );
  }

  // NEW: Add an error state if the bus location could not be fetched
  if (!busLocation) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color="#dc3545" />
        <Text style={styles.errorText}>Could not load trip details.</Text>
        <Text style={styles.errorSubText}>
          The bus location is currently unavailable.
        </Text>
        <TouchableOpacity
          style={styles.goBackButton}
          onPress={() => router.back()}
        >
          <Text style={styles.goBackButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // The MapView and UI will now only render if loading is false AND busLocation is available
  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider="google"
        customMapStyle={theme === "dark" ? [...mapDarkStyle] : []}
        initialCamera={{
          center: busLocation,
          pitch: 85, // Changed from 85 to 60 for better 3D view
          heading: 0,
          zoom: 17,
          altitude: 1000,
        }}
        showsUserLocation={false}
        showsMyLocationButton={false}
        followsUserLocation={false}
      >
        {/* Show complete route from start to end (same as DrivingModeScreen) */}
        {completeRoute.length > 0 && (
          <Polyline
            coordinates={completeRoute}
            strokeColor="#007AFF"
            strokeWidth={4}
            lineCap="round"
            lineJoin="round"
          />
        )}

        {/* Show pickup to destination route */}
        {pickupToDestinationRoute.length > 0 && (
          <Polyline
            coordinates={pickupToDestinationRoute}
            strokeColor={tripStatus === "picked_up" ? "#28a745" : "#FF9500"}
            strokeWidth={tripStatus === "picked_up" ? 6 : 4}
            lineDashPattern={tripStatus === "picked_up" ? [8, 4] : [5, 5]}
            lineCap="round"
            lineJoin="round"
          />
        )}

        {/* Fallback: Show direct line from pickup to destination if no routes available */}
        {completeRoute.length === 0 && (
          <Polyline
            coordinates={[pickupCoords, destCoords]}
            strokeColor="#6c757d"
            strokeWidth={3}
            lineDashPattern={[10, 10]}
            lineCap="round"
            lineJoin="round"
          />
        )}

        {/* Pickup point marker */}
        <Marker
          coordinate={pickupCoords}
          title="Pickup Location"
          pinColor="blue"
        >
          <View style={styles.pickupMarker}>
            <Ionicons name="location" size={24} color="#007AFF" />
          </View>
        </Marker>

        {/* Destination marker */}
        <Marker coordinate={destCoords} title="Your Destination" pinColor="red">
          <View style={styles.destinationMarker}>
            <Ionicons name="flag" size={24} color="#dc3545" />
          </View>
        </Marker>

        {/* Bus marker with enhanced styling */}
        {busLocation && (
          <Marker
            coordinate={busLocation}
            title={busPlateNumber || "Bus"}
            description="Your bus location"
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View
              style={[
                styles.busMarker,
                tripStatus === "picked_up" && styles.busMarkerBoarded,
              ]}
            >
              <Image
                source={require("@/assets/images/bus-icon.png")}
                style={styles.busIcon}
              />
            </View>
          </Marker>
        )}
      </MapView>

      {showScanSuccess && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.15)",
          }}
        >
          <Ionicons name="checkmark-circle" size={120} color="#28a745" />
        </View>
      )}

      {/* Off Route Warning */}
      {offRouteWarning && (
        <View style={styles.offRouteWarning}>
          <Ionicons name="warning" size={20} color="#fff" />
          <Text style={styles.offRouteWarningText}>Bus is off the route!</Text>
        </View>
      )}

      <View
        style={[
          styles.bottomPanel,
          isPanelMinimized && styles.bottomPanelMinimized,
        ]}
      >
        {/* Minimize/Expand Button */}
        <TouchableOpacity
          style={styles.minimizeButton}
          onPress={() => setIsPanelMinimized(!isPanelMinimized)}
        >
          <Ionicons
            name={isPanelMinimized ? "chevron-up" : "chevron-down"}
            size={24}
            color="#666"
          />
        </TouchableOpacity>

        {!isPanelMinimized && (
          <>
            <View style={styles.etaContainer}>
              <View style={styles.statusIndicator}>
                <View
                  style={[
                    styles.statusDot,
                    {
                      backgroundColor:
                        tripStatus === "waiting" ? "#FF9500" : "#28a745",
                    },
                  ]}
                />
                <Text style={styles.statusText}>
                  {tripStatus === "waiting"
                    ? "Waiting for Boarding"
                    : "On Board"}
                </Text>
              </View>
              <Text style={styles.etaLabel}>
                {tripStatus === "waiting"
                  ? "Bus arriving in"
                  : "Arriving at destination in"}
              </Text>
              <Text style={styles.etaText}>{eta}</Text>
              {routeLoading && tripStatus === "picked_up" && (
                <View style={styles.routeLoadingIndicator}>
                  <ActivityIndicator size="small" color="#28a745" />
                  <Text style={styles.routeLoadingText}>Loading route...</Text>
                </View>
              )}
            </View>
          </>
        )}

        {/* Minimized view - show only essential info */}
        {isPanelMinimized && (
          <View style={styles.minimizedContent}>
            <View style={styles.statusIndicator}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor:
                      tripStatus === "waiting" ? "#FF9500" : "#28a745",
                  },
                ]}
              />
              <Text style={styles.statusText}>
                {tripStatus === "waiting" ? "Waiting for Boarding" : "On Board"}
              </Text>
            </View>
            <Text style={styles.etaTextMinimized}>{eta}</Text>
            {/* Empty space to push minimize button to the right */}
            <View style={styles.minimizeButtonSpacer} />
          </View>
        )}

        {!isPanelMinimized && (
          <>
            {/* QR section - show only while waiting for boarding */}
            {showQRCode && tripStatus === "waiting" && (
              <>
                <View style={styles.divider} />
                <View style={styles.qrContainer}>
                  <Text style={styles.qrTitle}>Boarding QR Code</Text>
                  <QRCode value={qrPayload} size={160} />
                  <Text style={styles.qrHelpText}>
                    Show this QR code to the conductor for boarding
                  </Text>
                  <Text style={styles.qrSubText}>
                    The QR code will disappear once you&apos;re boarded
                  </Text>
                  {/* Fallback: Show payload as text if QR doesn't work
                  <View style={styles.fallbackContainer}>
                    <Text style={styles.fallbackText}>
                      If QR doesn't work, show this to conductor:
                    </Text>
                    <Text style={styles.fallbackPayload}>{qrPayload}</Text>
                  </View> */}
                </View>
              </>
            )}

            {/* Show boarding confirmation when QR is scanned */}
            {tripStatus === "picked_up" && (
              <>
                <View style={styles.divider} />
                <View style={styles.boardingContainer}>
                  <Ionicons name="checkmark-circle" size={48} color="#28a745" />
                  <Text style={styles.boardingTitle}>
                    Successfully Boarded! ✅
                  </Text>
                  <Text style={styles.boardingText}>
                    You have been boarded on the bus. Enjoy your ride!
                  </Text>
                </View>
              </>
            )}

            <View style={styles.tripInfoContainer}>
              <FontAwesome5 name="bus-alt" size={20} color="#333" />
              <Text style={styles.dots}>········</Text>
              <Ionicons name="location-sharp" size={20} color="#007AFF" />
              <Text style={styles.dots}>········</Text>
              <FontAwesome5 name="flag-checkered" size={20} color="#28a745" />
            </View>
            <Text style={styles.destinationText}>
              Bus {busPlateNumber}
              {tripStatus === "waiting"
                ? " to your pickup"
                : " to your destination"}
            </Text>
          </>
        )}
      </View>

      {/* Drop off / Cancel Trip Button - Centered below bottom panel */}
      <TouchableOpacity
        onPress={() => setShowConfirmationModal(true)}
        style={[
          styles.endTripButton,
          tripStatus === "picked_up" && styles.endTripButtonActive,
        ]}
      >
        <Ionicons
          name={tripStatus === "picked_up" ? "location" : "close-circle"}
          size={20}
          color="#fff"
        />
        <Text style={styles.endTripButtonText}>
          {tripStatus === "picked_up" ? "Drop off" : "Cancel Trip"}
        </Text>
      </TouchableOpacity>

      {/* Drop off / Cancel Confirmation Modal */}
      <Modal
        visible={showConfirmationModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowConfirmationModal(false)}
      >
        <View style={styles.confirmModalOverlay}>
          <View style={styles.confirmModalContent}>
            {/* Decorative circles */}
            <View style={styles.confirmModalDecoCircle1} />
            <View style={styles.confirmModalDecoCircle2} />
            
            {/* Icon */}
            <View style={styles.confirmModalIconWrapper}>
              <View style={[
                styles.confirmModalIconContainer,
                { backgroundColor: tripStatus === "picked_up" ? "#10B981" : "#EF4444" }
              ]}>
                <Ionicons
                  name={tripStatus === "picked_up" ? "location" : "close-circle"}
                  size={36}
                  color="#fff"
                />
              </View>
              <View style={[
                styles.confirmModalPulseRing,
                { borderColor: tripStatus === "picked_up" ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)" }
              ]} />
            </View>

            {/* Title */}
            <Text style={styles.confirmModalTitle}>
              {tripStatus === "picked_up" ? "Drop off Here?" : "Cancel Trip?"}
            </Text>

            {/* Description */}
            <Text style={styles.confirmModalDescription}>
              {tripStatus === "picked_up"
                ? "Are you sure you want to end your trip and drop off at your current location?"
                : "Are you sure you want to cancel this trip? This action cannot be undone."}
            </Text>

            {/* Info Card */}
            <View style={[
              styles.confirmModalInfoCard,
              { backgroundColor: tripStatus === "picked_up" ? "#ECFDF5" : "#FEF2F2", borderColor: tripStatus === "picked_up" ? "#A7F3D0" : "#FECACA" }
            ]}>
              <View style={styles.confirmModalInfoRow}>
                <View style={[
                  styles.confirmModalInfoIcon,
                  { backgroundColor: tripStatus === "picked_up" ? "#D1FAE5" : "#FEE2E2" }
                ]}>
                  <Ionicons name="bus" size={18} color={tripStatus === "picked_up" ? "#059669" : "#DC2626"} />
                </View>
                <View style={styles.confirmModalInfoTextContainer}>
                  <Text style={styles.confirmModalInfoLabel}>Current Bus</Text>
                  <Text style={[styles.confirmModalInfoValue, { color: tripStatus === "picked_up" ? "#065F46" : "#991B1B" }]}>
                    {busPlateNumber}
                  </Text>
                </View>
              </View>
            </View>

            {/* Buttons */}
            <View style={styles.confirmModalButtonGroup}>
              <TouchableOpacity
                style={styles.confirmModalButtonSecondary}
                onPress={() => setShowConfirmationModal(false)}
              >
                <Text style={styles.confirmModalButtonSecondaryText}>Go Back</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.confirmModalButtonPrimary,
                  { backgroundColor: tripStatus === "picked_up" ? "#10B981" : "#EF4444" }
                ]}
                onPress={() => {
                  setShowConfirmationModal(false);
                  finalizeTrip(tripStatus === "picked_up" ? "arrived" : "cancelled");
                }}
              >
                <Ionicons
                  name={tripStatus === "picked_up" ? "checkmark" : "close"}
                  size={18}
                  color="#fff"
                />
                <Text style={styles.confirmModalButtonPrimaryText}>
                  {tripStatus === "picked_up" ? "Yes, Drop off" : "Yes, Cancel"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Trip Summary Modal */}
      <Modal
        visible={showTripSummary}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowTripSummary(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Ionicons
                name={tripSummaryData.status === "completed" ? "checkmark-circle" : "close-circle"}
                size={48}
                color={tripSummaryData.status === "completed" ? "#28a745" : "#dc3545"}
              />
              <Text style={styles.modalTitle}>
                {tripSummaryData.status === "completed" ? "Trip Completed!" : "Trip Cancelled"}
              </Text>
              <Text style={styles.modalSubtitle}>Here's your trip summary</Text>
            </View>

            <View style={styles.tripSummaryContainer}>
              <View style={styles.summaryRow}>
                <Ionicons name="time-outline" size={20} color="#666" />
                <Text style={styles.summaryLabel}>Duration:</Text>
                <Text style={styles.summaryValue}>{tripSummaryData.duration}</Text>
              </View>

              <View style={styles.summaryRow}>
                <Ionicons name="speedometer-outline" size={20} color="#666" />
                <Text style={styles.summaryLabel}>Distance:</Text>
                <Text style={styles.summaryValue}>{tripSummaryData.distance}</Text>
              </View>

              <View style={styles.summaryRow}>
                <Ionicons name="bus-outline" size={20} color="#666" />
                <Text style={styles.summaryLabel}>Bus:</Text>
                <Text style={styles.summaryValue}>{tripSummaryData.busPlate}</Text>
              </View>

              <View style={styles.summaryDivider} />

              <View style={styles.summaryRow}>
                <Ionicons name="location-outline" size={20} color="#007AFF" />
                <Text style={styles.summaryLabel}>From:</Text>
                <Text style={[styles.summaryValue, styles.summaryLocation]} numberOfLines={2}>
                  {tripSummaryData.pickupLocation}
                </Text>
              </View>

              <View style={styles.summaryRow}>
                <Ionicons name="flag-outline" size={20} color="#28a745" />
                <Text style={styles.summaryLabel}>To:</Text>
                <Text style={[styles.summaryValue, styles.summaryLocation]} numberOfLines={2}>
                  {tripSummaryData.destination}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => {
                setShowTripSummary(false);
                // Finalize trip with skipSummary=true to actually complete the trip
                finalizeTrip(tripSummaryData.status === "completed" ? "arrived" : "cancelled", true);
              }}
            >
              <Text style={styles.modalCloseButtonText}>Continue</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </View>
  );
}

// MODIFIED: Added styles for the new error screen
const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 30,
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
  // Drop off / Cancel Button Styles
  endTripButton: {
    position: "absolute",
    bottom: 20,
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(220,53,69,0.95)",
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 25,
    elevation: 8,
    shadowColor: "#dc3545",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    zIndex: 1000,
  },
  endTripButtonActive: {
    backgroundColor: "#10B981", // Green color for drop off
    shadowColor: "#10B981",
  },
  endTripButtonText: {
    color: "white",
    fontWeight: "600",
    fontSize: 16,
    marginLeft: 8,
  },
  bottomPanel: {
    position: "absolute",
    bottom: 100, // Increased from 40 to make room for End Trip button
    left: 20,
    right: 20,
    backgroundColor: "white",
    borderRadius: 24,
    padding: 24,
    elevation: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.05)",
  },
  bottomPanelMinimized: {
    padding: 16,
  },
  minimizeButton: {
    position: "absolute",
    top: 20,
    right: 18,
    padding: 8,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.05)",
    zIndex: 1,
  },
  minimizedContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 8,
    paddingRight: 60, // Make space for the minimize button
  },
  etaTextMinimized: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#007AFF",
    marginLeft: 16,
    flex: 1,
    marginBottom: 12,
  },
  minimizeButtonSpacer: {
    width: 20, // Space for the minimize button
  },
  etaContainer: {
    alignItems: "center",
    marginBottom: 8,
  },
  statusIndicator: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    backgroundColor: "#f8f9fa",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e9ecef",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  etaLabel: {
    fontSize: 16,
    color: "#666",
    marginBottom: 8,
    fontWeight: "500",
  },
  etaText: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#007AFF",
    textAlign: "center",
  },
  routeLoadingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#f0f8f0",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#28a745",
  },
  routeLoadingText: {
    fontSize: 12,
    color: "#28a745",
    marginLeft: 6,
    fontWeight: "500",
  },
  divider: {
    height: 1,
    backgroundColor: "#e9ecef",
    marginVertical: 16,
    borderRadius: 1,
  },
  qrContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    backgroundColor: "#f8f9fa",
    borderRadius: 20,
    padding: 20,
    borderWidth: 2,
    borderColor: "#e9ecef",
  },
  qrHelpText: {
    marginTop: 16,
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    fontWeight: "500",
  },
  tripInfoContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  dots: {
    fontSize: 20,
    color: "#ced4da",
    marginHorizontal: 8,
    lineHeight: 20,
  },
  destinationText: {
    textAlign: "center",
    marginTop: 12,
    fontSize: 14,
    color: "#495057",
  },
  busMarker: {
    padding: 5,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: "white",
    backgroundColor: "#ffc107",
    elevation: 5,
  },
  busMarkerBoarded: {
    backgroundColor: "#28a745",
    borderColor: "#1e7e34",
    elevation: 8,
    shadowColor: "#28a745",
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  busIcon: { width: 20, height: 20 },
  pickupMarker: {
    backgroundColor: "white",
    borderRadius: 20,
    padding: 4,
    borderWidth: 2,
    borderColor: "#007AFF",
    elevation: 3,
  },
  destinationMarker: {
    backgroundColor: "white",
    borderRadius: 20,
    padding: 4,
    borderWidth: 2,
    borderColor: "#dc3545",
    elevation: 3,
  },
  boardingContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    backgroundColor: "#f0f8f0",
    borderRadius: 20,
    padding: 20,
    borderWidth: 2,
    borderColor: "#28a745",
  },
  boardingTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginTop: 12,
    marginBottom: 8,
    color: "#28a745",
    textAlign: "center",
  },
  boardingText: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    lineHeight: 22,
  },
  errorText: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  errorSubText: {
    marginTop: 8,
    fontSize: 14,
    color: "#6c757d",
    textAlign: "center",
  },
  goBackButton: {
    marginTop: 24,
    backgroundColor: "#007AFF",
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 100,
  },
  goBackButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  fallbackContainer: {
    marginTop: 16,
    padding: 16,
    backgroundColor: "#f8f9fa",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#dee2e6",
  },
  fallbackText: {
    fontSize: 14,
    color: "#6c757d",
    marginBottom: 8,
    textAlign: "center",
    fontWeight: "500",
  },
  fallbackPayload: {
    fontSize: 12,
    color: "#495057",
    fontFamily: "monospace",
    textAlign: "center",
    lineHeight: 16,
    backgroundColor: "#fff",
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e9ecef",
  },
  qrTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#007AFF",
    textAlign: "center",
    marginBottom: 16,
  },
  qrSubText: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 12,
    fontStyle: "italic",
  },
  offRouteWarning: {
    position: "absolute",
    top: 100,
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ff4d4f",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    elevation: 8,
    shadowColor: "#ff4d4f",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    zIndex: 1000,
  },
  offRouteWarningText: {
    color: "#fff",
    marginLeft: 8,
    fontWeight: "bold",
    fontSize: 16,
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "90%",
    backgroundColor: "white",
    borderRadius: 20,
    padding: 20,
    alignItems: "center",
    elevation: 10,
  },
  modalHeader: {
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    marginTop: 10,
  },
  modalSubtitle: {
    fontSize: 16,
    color: "#666",
    marginTop: 5,
  },
  tripSummaryContainer: {
    width: "100%",
    marginBottom: 20,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  summaryLabel: {
    fontSize: 16,
    color: "#666",
    marginLeft: 10,
    flex: 1,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
  },
  summaryDivider: {
    height: 1,
    backgroundColor: "#e9ecef",
    marginVertical: 10,
  },
  summaryLocation: {
    flex: 1,
    textAlign: "right",
  },
  modalCloseButton: {
    backgroundColor: "#007AFF",
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 25,
  },
  modalCloseButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },

  // Drop off / Cancel Confirmation Modal Styles
  confirmModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  confirmModalContent: {
    width: "88%",
    maxWidth: 380,
    backgroundColor: "#ffffff",
    borderRadius: 28,
    padding: 28,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.25,
    shadowRadius: 32,
    elevation: 24,
    overflow: "hidden",
    position: "relative",
  },
  confirmModalDecoCircle1: {
    position: "absolute",
    top: -50,
    right: -50,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(16, 185, 129, 0.08)",
  },
  confirmModalDecoCircle2: {
    position: "absolute",
    bottom: -30,
    left: -30,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(239, 68, 68, 0.06)",
  },
  confirmModalIconWrapper: {
    position: "relative",
    marginBottom: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmModalIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
    zIndex: 2,
  },
  confirmModalPulseRing: {
    position: "absolute",
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    zIndex: 1,
  },
  confirmModalTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#1F2937",
    marginBottom: 12,
    textAlign: "center",
    letterSpacing: -0.5,
  },
  confirmModalDescription: {
    fontSize: 15,
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  confirmModalInfoCard: {
    width: "100%",
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
  },
  confirmModalInfoRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  confirmModalInfoIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  confirmModalInfoTextContainer: {
    flex: 1,
  },
  confirmModalInfoLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#6B7280",
    marginBottom: 2,
  },
  confirmModalInfoValue: {
    fontSize: 17,
    fontWeight: "700",
  },
  confirmModalButtonGroup: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  confirmModalButtonSecondary: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    paddingVertical: 14,
  },
  confirmModalButtonSecondaryText: {
    color: "#4B5563",
    fontWeight: "600",
    fontSize: 15,
  },
  confirmModalButtonPrimary: {
    flex: 1.2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 14,
    paddingVertical: 14,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  confirmModalButtonPrimaryText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
});
