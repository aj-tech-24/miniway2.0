import { mapDarkStyle } from "@/constants/mapDarkStyle";
import { useAuth } from "@/contexts/AuthContext";
import { useBusLocation, useRoute } from "@/contexts/RouteContext";
import { useAppTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { Audio } from 'expo-av';
import * as Location from 'expo-location';
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
  Animated,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import MapView, { Camera, LatLng, Marker, Polyline } from "react-native-maps";
import QRCode from "react-native-qrcode-svg";
import Svg, { G, Path } from "react-native-svg";

type BusLocation = LatLng;

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLEMAPS_API;
const ROUTE_CLAMP_THRESHOLD = 20; // meters - clamp bus marker to route if within this distance

// --- Constants for Short Distance Testing ---
// NOTE: Keep these sane to avoid excessive animations / memory pressure while still feeling realtime.
const CAMERA_ZOOM_WAITING = 19;
const CAMERA_ZOOM_BOARDED = 18;
const CAMERA_ANIMATION_DURATION = 500; // ms
const MARKER_ANIMATION_DURATION = 700; // ms
const ARRIVAL_THRESHOLD = 10; // meters

// Custom SVG Map Marker Component (same as DrivingModeScreen)
const CustomMapMarker = ({
  size = 40,
  color = "#FF9500",
}: {
  size?: number;
  color?: string;
}) => {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G transform="translate(0 -1028.4)">
        <Path
          d="m12 0c-4.4183 2.3685e-15 -8 3.5817-8 8 0 1.421 0.3816 2.75 1.0312 3.906 0.1079 0.192 0.221 0.381 0.3438 0.563l6.625 11.531 6.625-11.531c0.102-0.151 0.19-0.311 0.281-0.469l0.063-0.094c0.649-1.156 1.031-2.485 1.031-3.906 0-4.4183-3.582-8-8-8zm0 4c2.209 0 4 1.7909 4 4 0 2.209-1.791 4-4 4-2.2091 0-4-1.791-4-4 0-2.2091 1.7909-4 4-4z"
          transform="translate(0 1028.4)"
          fill={color}
        />
        <Path
          d="m12 3c-2.7614 0-5 2.2386-5 5 0 2.761 2.2386 5 5 5 2.761 0 5-2.239 5-5 0-2.7614-2.239-5-5-5zm0 2c1.657 0 3 1.3431 3 3s-1.343 3-3 3-3-1.3431-3-3 1.343-3 3-3z"
          transform="translate(0 1028.4)"
          fill="white"
        />
      </G>
    </Svg>
  );
};

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

// Helper: Find the closest point on the entire route to the bus location
// OPTIMIZED: activeIndex hint limits the search window
const getClosestPointOnRoute = (
  busLocation: LatLng,
  route: LatLng[],
  startIndex: number = 0
): { point: LatLng; distance: number; index: number } => {
  if (!busLocation || route.length === 0) {
    return { point: busLocation, distance: Infinity, index: 0 };
  }

  if (route.length === 1) {
    return { point: route[0], distance: haversineMeters(busLocation, route[0]), index: 0 };
  }

  let closestPoint = route[0];
  let minDistance = Infinity;
  let bestIndex = 0;

  // Optimization: Only search a window around the last known index
  // If we get lost (minDistance is huge), we might need a full scan, but for now specific window
  const SEARCH_WINDOW = 100; // Look 100 points ahead/behind
  let start = Math.max(0, startIndex - 20); // Check slightly behind too in case of jitter
  let end = Math.min(route.length - 1, startIndex + SEARCH_WINDOW);

  // Fallback: If we are very far from the "hint", maybe we should scan all?
  // ideally we scan the window, if minDistance > threshold, we scan all.
  // For simplicity/performance first pass: just scan window.
  // If we are at 0 (start), scan a bit more.
  if (startIndex === 0) end = Math.min(route.length - 1, 500);

  // Local search
  for (let i = start; i < end; i++) {
    const segmentClosest = closestPointOnSegment(busLocation, route[i], route[i + 1]);
    const segmentDistance = haversineMeters(busLocation, segmentClosest);

    if (segmentDistance < minDistance) {
      minDistance = segmentDistance;
      closestPoint = segmentClosest;
      bestIndex = i;
    }
  }

  // Recovery: If local search failed (too far), do a global scan (only every now and then? or just return result?)
  // If distance is > 200m, user might have jumped. Global scan.
  if (minDistance > 200) {
    for (let i = 0; i < route.length - 1; i++) {
      // Skip what we already checked
      if (i >= start && i < end) continue;

      const segmentClosest = closestPointOnSegment(busLocation, route[i], route[i + 1]);
      const segmentDistance = haversineMeters(busLocation, segmentClosest);

      if (segmentDistance < minDistance) {
        minDistance = segmentDistance;
        closestPoint = segmentClosest;
        bestIndex = i;
      }
    }
  }

  return { point: closestPoint, distance: minDistance, index: bestIndex };
};

// Sound helper
const playSound = async (type: 'success' | 'alert') => {
  try {
    const soundSource = type === 'success'
      ? require('@/assets/sounds/success.mp3')
      : require('@/assets/sounds/pickup.mp3');

    const { sound } = await Audio.Sound.createAsync(soundSource, { shouldPlay: true });

    sound.setOnPlaybackStatusUpdate(async (status) => {
      if (status.isLoaded && status.didJustFinish) {
        await sound.unloadAsync();
      }
    });
  } catch (error) {
    // Silently fail sound playback errors
  }
};

// Helper: Clamp bus location to route if within threshold distance
const clampToRoute = (busLocation: LatLng, route: LatLng[], lastIndex: number = 0): { location: LatLng, index: number, distance: number } => {
  if (!busLocation || route.length === 0) {
    return { location: busLocation, index: 0, distance: 0 };
  }

  const { point, distance, index } = getClosestPointOnRoute(busLocation, route, lastIndex);

  if (distance <= ROUTE_CLAMP_THRESHOLD) {
    return { location: point, index, distance };
  }

  return { location: busLocation, index, distance };
};



export default function TripScreen() {
  const { theme } = useAppTheme();
  const { session } = useAuth();
  const params = useLocalSearchParams();
  const mapRef = useRef<MapView>(null);
  const previousLocationRef = useRef<BusLocation | null>(null);
  const tripFinalizedRef = useRef(false);
  const lastRouteIndexRef = useRef(0);

  const busId = params.busId as string;
  const tripId = params.tripId as string | undefined;

  // RouteContext integration - for syncing bus location across commuters
  const { updateBusLocation: syncBusLocation, setCurrentRoute, subscribeToBus, unsubscribeFromBus } = useRoute();
  const trackedBus = useBusLocation(busId);

  // Subscribe ASAP to this bus' updates.
  // This listens to:
  // 1) Postgres realtime changes on `trips` for this bus (slower, but reliable), and
  // 2) Realtime broadcast `driver_location` (fastest, ephemeral)
  useEffect(() => {
    if (!busId) return;
    subscribeToBus(busId);
    return () => {
      unsubscribeFromBus(busId);
    };
  }, [busId, subscribeToBus, unsubscribeFromBus]);

  // Subscribe to route-level broadcasts for this trip's bus
  useEffect(() => {
    let active = true;

    const setRouteFromBus = async () => {
      if (!busId) return;

      const { data: busData, error: busError } = await supabase
        .from("buses")
        .select("route_id")
        .eq("id", busId)
        .single();

      if (!active) return;
      if (busError || !busData?.route_id) return;

      setCurrentRoute(busData.route_id);
    };

    setRouteFromBus();

    return () => {
      active = false;
      // NOTE: Don't clear the route here. Clearing on unmount can tear down
      // route subscriptions unexpectedly when navigating between commuter screens.
      // RouteContext should be cleared by the owning flow when the user truly leaves.
    };
  }, [busId, setCurrentRoute]);

  // NEW: keep a small debug string for the "bus location unavailable" screen
  const [locationError, setLocationError] = useState<string | null>(null);

  const initialPlateNumber = (params.busPlateNumber as string) || "Unknown Bus";
  const passengerCount = parseInt(params.passengerCount as string) || 1;

  // State for bus plate number (can be updated if initially unknown)
  const [busPlateNumber, setBusPlateNumber] =
    useState<string>(initialPlateNumber);
  const pickupLatRef = useRef(parseFloat(params.pickupLat as string));
  const pickupLngRef = useRef(parseFloat(params.pickupLng as string));
  const destLatRef = useRef(parseFloat(params.destLat as string));
  const destLngRef = useRef(parseFloat(params.destLng as string));

  const pickupCoords: LatLng = useMemo(() => ({
    latitude: pickupLatRef.current,
    longitude: pickupLngRef.current,
  }), []);

  const destCoords: LatLng = useMemo(() => ({
    latitude: destLatRef.current,
    longitude: destLngRef.current,
  }), []);
  // Parse the complete route path (same approach as DrivingModeScreen)
  // OPTIMIZATION: Memoize parsing to prevent it running on every render
  const completeRoutePath = useMemo(() => {
    try {
      const routePathParam = params.routePath as string;
      if (routePathParam && routePathParam !== "[]") {
        const routePath: [number, number][] = JSON.parse(routePathParam);
        return routePath.map(([lng, lat]) => ({
          latitude: lat,
          longitude: lng,
        }));
      }
    } catch (e) {
      // Fallback
    }
    return [];
  }, [params.routePath]);

  // Keep the original polylineCoords for backward compatibility
  const polylineCoords = useMemo(() => completeRoutePath, [completeRoutePath]);

  const [busLocation, setBusLocation] = useState<BusLocation | null>(null);
  // Animated bus position for smooth marker transitions
  const [animatedBusPosition, setAnimatedBusPosition] = useState<BusLocation | null>(null);
  // Reference to the bus marker for native animation
  const busMarkerRef = useRef<any>(null);
  // Animation frame reference for cleanup
  const animationFrameRef = useRef<number | null>(null);
  const [markerUpdateSeq, setMarkerUpdateSeq] = useState(0);
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

  // Refs for stale closure fix in realtime subscription
  const tripStatusRef = useRef(tripStatus);
  const completeRouteRef = useRef(completeRoute);

  // Sync refs with state
  useEffect(() => {
    tripStatusRef.current = tripStatus;
  }, [tripStatus]);

  useEffect(() => {
    completeRouteRef.current = completeRoute;
    lastRouteIndexRef.current = 0; // Reset optimization if route changes
  }, [completeRoute]);

  // RouteContext: Sync bus location updates to shared context
  // This enables multiple commuters to see the same bus location
  useEffect(() => {
    if (busLocation && !loading) {
      syncBusLocation(busId, busLocation);
    }
  }, [busLocation, busId, loading, syncBusLocation]);

  // RouteContext: Listen for bus location updates from shared context
  // This provides a secondary source of truth for bus location
  useEffect(() => {
    if (!trackedBus?.location || loading) return;

    // Guard: Skip if location hasn't meaningfully changed (prevents infinite loop)
    const prevLoc = busLocation;
    if (prevLoc &&
      Math.abs(prevLoc.latitude - trackedBus.location.latitude) < 0.00001 &&
      Math.abs(prevLoc.longitude - trackedBus.location.longitude) < 0.00001) {
      return;
    }

    // Clamp bus location to route if passenger is boarded and within 20m threshold
    // Use ref for completeRoute to avoid dependency cycle
    const locationToUse = tripStatus === 'picked_up'
      ? clampToRoute(trackedBus.location, completeRouteRef.current, lastRouteIndexRef.current).location
      : trackedBus.location;

    // Always apply context updates so the marker keeps moving.
    setBusLocation(locationToUse);

    // Ensure the marker is driven by an updated coordinate immediately.
    setAnimatedBusPosition(locationToUse);

    // Force marker re-render in case react-native-maps doesn't update reliably.
    setMarkerUpdateSeq((s) => s + 1);
  }, [trackedBus?.location, loading, tripStatus]); // Removed completeRoute - use ref instead

  // transient overlay after successful scan
  const [showScanSuccess, setShowScanSuccess] = useState(false);
  const prevStatusRef = useRef<"waiting" | "picked_up">("waiting");

  // added: resolved location names
  const [pickupName, setPickupName] = useState<string | null>(null);
  const [destinationName, setDestinationName] = useState<string | null>(null);

  // added: bottom panel minimize state
  const [isPanelMinimized, setIsPanelMinimized] = useState(false);
  const panelHeight = useRef(new Animated.Value(1)).current; // 1 = expanded, 0 = minimized

  // added: track if scan success has been shown
  const scanSuccessShownRef = useRef(false);

  // Animate panel minimize/expand
  useEffect(() => {
    Animated.timing(panelHeight, {
      toValue: isPanelMinimized ? 0 : 1,
      duration: 300,
      useNativeDriver: false, // height animation requires layout
    }).start();
  }, [isPanelMinimized, panelHeight]);

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

  // Compass/Magnetometer state for direction indicator
  const [compassHeading, setCompassHeading] = useState(0);
  const [isMagnetometerAvailable, setIsMagnetometerAvailable] = useState(false);
  const [mapCameraHeading, setMapCameraHeading] = useState(0); // Track map rotation

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
    let active = true;

    (async () => {
      const [start, end] = await Promise.all([
        reverseGeocode(pickupCoords),
        reverseGeocode(destCoords),
      ]);

      if (active) {
        setPickupName(start);
        setDestinationName(end);
      }
    })();

    return () => { active = false; };
  }, [pickupCoords, destCoords]); // Depend ONLY on the stable coords

  // added: fetch routes if needed
  useEffect(() => {
    let active = true;
    (async () => {
      // Fetch complete route from database if missing
      // Only if we haven't already loaded it into state (completeRoute)
      if (completeRoutePath.length === 0 && completeRoute.length === 0) {
        // This function will update state internally
        await fetchCompleteRouteFromDatabase();
      }

      // Fetch pickup-to-destination route so user can see the route they'll take
      // Only do this once on mount/coord change
      if (active) {
        await fetchPickupToDestinationRoute(pickupCoords, destCoords);
      }
    })();
    return () => { active = false; };
  }, [completeRoutePath.length, pickupCoords, destCoords]); // Removed `completeRoute` (state) from dep array to avoid cycles if possible, relying on length check

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


  // show green check for 0.5s when status becomes picked_up
  // Also animate camera to point towards destination
  useEffect(() => {
    if (prevStatusRef.current === "waiting" && tripStatus === "picked_up") {
      setShowScanSuccess(true);
      setTimeout(() => setShowScanSuccess(false), 500);

      // Animate camera to point towards destination when boarded
      if (busLocation && mapRef.current) {
        const headingToDestination = calculateBearing(busLocation, destCoords);
        mapRef.current.animateCamera(
          {
            center: busLocation,
            pitch: 60,
            heading: headingToDestination,
            zoom: CAMERA_ZOOM_BOARDED,
          },
          { duration: 800 }
        );
      }
    }
    prevStatusRef.current = tripStatus;
  }, [tripStatus, busLocation, destCoords]);

  // Check if bus is off route
  // Check if bus is off route
  // OPTIMIZATION: Throttle this check to avoid heavy calculation on every location update
  // Off-route warning handled in the bus location effect now


  // Animate bus marker smoothly when location changes
  // Also clamp to route if within threshold distance
  useEffect(() => {
    if (!busLocation) return;

    // Guard: Skip if position hasn't changed (prevents unnecessary work)
    if (animatedBusPosition &&
      Math.abs(animatedBusPosition.latitude - busLocation.latitude) < 0.00001 &&
      Math.abs(animatedBusPosition.longitude - busLocation.longitude) < 0.00001) {
      return;
    }

    // Cancel any ongoing animation
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Performance optimization: Use the last known index to limit the search space
    // Also perform off-route check here to avoid duplicate route iterations
    // Use ref to avoid adding completeRoute as dependency
    const { location: clampedLocation, index: newIndex, distance: distToRoute } =
      clampToRoute(busLocation, completeRouteRef.current, lastRouteIndexRef.current);

    // Update tracking refs
    lastRouteIndexRef.current = newIndex;

    // Update UI state based on calculations
    // 100 meters threshold for off-route
    setOffRouteWarning(distToRoute > 100);

    // Directly update the marker position
    setAnimatedBusPosition(clampedLocation);

    return;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busLocation]); // Removed completeRoute - use ref instead

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
      // Note: Removed Date.now() to prevent QR code regeneration on every render
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
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${start.latitude},${start.longitude}&destination=${end.latitude}&key=${GOOGLE_MAPS_API_KEY}`;
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
        if (reason === "arrived") {
          await playSound('success');
        }

        const { error: updateError } = await supabase
          .from("trip_passengers")
          .update({
            status: reason === "cancelled" ? "cancelled" : "completed",
            dropoff_time: new Date().toISOString(),
          })
          .eq("passenger_id", session.user.id)
          .eq("bus_id", busId)
          .in("status", ["boarded", "waiting"]);

        if (updateError) {
          // Log but continue if possible, or retry?
          //console.error("Failed to update status in DB:", updateError);
        }

        // ALSO: Update pickup_requests status so driver no longer sees the pickup marker
        const pickupRequestStatus = reason === "cancelled" ? "cancelled" : "completed";
        const { error: pickupRequestError } = await supabase
          .from("pickup_requests")
          .update({
            status: pickupRequestStatus,
          })
          .eq("commuter_id", session.user.id)
          .eq("bus_id", busId)
          .in("status", ["pending", "accepted"]);

        if (pickupRequestError) {
          //console.error("Failed to update pickup_requests status:", pickupRequestError);
        }

        // 3. Update travel history
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
          //console.log("Error saving travel history:", historyError);
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
      setLocationError(null);
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
        // Prefer tripId (single source of truth). Fallback to latest by busId if tripId is missing.
        const tripLocationQuery = supabase
          .from("trips_with_geojson")
          .select("current_location")
          .order("created_at", { ascending: false })
          .limit(1);

        const { data: latestTrip, error: latestTripError } = tripId
          ? await tripLocationQuery.eq("trip_id", tripId).maybeSingle()
          : await tripLocationQuery.eq("bus_id", busId).maybeSingle();

        if (latestTripError) throw latestTripError;

        let initialLocation: LatLng | null = null;
        if (latestTrip?.current_location) {
          const loc =
            typeof latestTrip.current_location === "string"
              ? JSON.parse(latestTrip.current_location)
              : latestTrip.current_location;

          if (loc?.coordinates) {
            initialLocation = {
              latitude: loc.coordinates[1],
              longitude: loc.coordinates[0],
            };
          }
        }

        if (initialLocation) {
          // Reset index for initial load
          lastRouteIndexRef.current = 0;
          const { location: clampedInitial } = clampToRoute(initialLocation, completeRouteRef.current, 0);
          setBusLocation(clampedInitial);
          setAnimatedBusPosition(clampedInitial);
          previousLocationRef.current = clampedInitial;

          await fetchETA(
            clampedInitial,
            tripStatus === "picked_up" ? destCoords : pickupCoords
          );
        } else {
          setLocationError(
            `No location found in trips_with_geojson. tripId=${tripId ?? "(missing)"}, busId=${busId}`
          );
          Alert.alert("Error", "Could not find the bus's initial location.");
        }

        // NEW: Fetch initial trip status (assumes trips.status reflects pickup)
        // IMPORTANT: Prefer tripId to avoid desync when multiple trips share bus_id.
        const tripStatusQuery = supabase.from("trips").select("status");

        const { data: tripRows } = tripId
          ? await tripStatusQuery.eq("id", tripId).limit(1)
          : await tripStatusQuery
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
      } catch (err: any) {
        setLocationError(
          `Failed to load initial location. tripId=${tripId ?? "(missing)"}, busId=${busId}. ${err?.message ?? String(err)
          }`
        );
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
  }, [busId, session?.user?.id, tripId]);

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
            // Alert.alert(
            //   "Trip Cancelled",
            //   "The driver has cancelled your trip. You will be redirected to the home screen."
            // );
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
    // IMPORTANT: subscribe to the specific trip row when tripId is available.
    const tripChannel = supabase
      .channel(`realtime-trip-${tripId || busId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "trips",
          filter: tripId ? `id=eq.${tripId}` : `bus_id=eq.${busId}`,
        },
        async (payload) => {
          const updatedTrip = payload.new as any;

          // Location update
          // Fetch the latest valid GeoJSON location from the view because payload might have WKB
          const geoQuery = supabase
            .from("trips_with_geojson")
            .select("current_location")
            .order("created_at", { ascending: false })
            .limit(1);

          const { data: geoData } = updatedTrip?.id
            ? await geoQuery.eq("trip_id", updatedTrip.id).maybeSingle()
            : await geoQuery.eq("bus_id", busId).maybeSingle();

          let newLocation: LatLng | null = null;

          if (geoData?.current_location) {
            // Handle both object and string JSON
            const loc = typeof geoData.current_location === "string"
              ? JSON.parse(geoData.current_location)
              : geoData.current_location;

            if (loc?.coordinates) {
              newLocation = {
                latitude: loc.coordinates[1],
                longitude: loc.coordinates[0],
              };
            }
          }

          if (newLocation) {

            // Clamp bus location to route
            const { location: clampedLocation } = clampToRoute(newLocation, completeRouteRef.current, lastRouteIndexRef.current);

            // IMPORTANT: update both positions from the realtime event.
            // If you only update busLocation and rely on the animation effect,
            // Android marker animations + tracksViewChanges=false can appear "stuck".
            setBusLocation(clampedLocation);
            setAnimatedBusPosition(clampedLocation);
            setMarkerUpdateSeq((s) => s + 1);

            // Throttle ETA fetching to reduce memory usage
            const now = Date.now();
            if (now - lastEtaFetch.current > ETA_FETCH_THROTTLE) {
              lastEtaFetch.current = now;
              await fetchETA(
                newLocation,
                tripStatusRef.current === "picked_up" ? destCoords : pickupCoords
              );
            }

            // Calculate heading based on trip status
            let heading = 0;
            if (tripStatusRef.current === "picked_up") {
              // When boarded, always point camera towards destination
              heading = calculateBearing(newLocation, destCoords);
            } else {
              // When waiting, point towards pickup location
              heading = calculateBearing(newLocation, pickupCoords);
            }

            // Enhanced camera animations for short distance testing
            const camera: Partial<Camera> = {
              center: newLocation,
              pitch: tripStatusRef.current === "picked_up" ? 60 : 45, // Lower pitch when boarded for better route view
              heading: heading,
              zoom: tripStatusRef.current === "picked_up" ? CAMERA_ZOOM_BOARDED : CAMERA_ZOOM_WAITING, // High zoom for short distance
            };

            // Quick camera animation for responsive short distance tracking
            mapRef.current?.animateCamera(camera, { duration: CAMERA_ANIMATION_DURATION });
            previousLocationRef.current = newLocation;

            // Auto-finish near destination (reduced threshold for short distance testing)
            if (tripStatusRef.current === "picked_up") {
              try {
                const d = haversineMeters(newLocation, destCoords);
                if (d <= ARRIVAL_THRESHOLD) {
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
  }, [busId, session?.user?.id, tripId]);

  // OPTIMIZATION: Memoize static map elements to prevent re-renders when bus moves
  const routePolyline = useMemo(() => (
    completeRoute.length > 0 ? (
      <Polyline
        coordinates={completeRoute}
        strokeColor="#007AFF"
        strokeWidth={8}
        lineCap="round"
        lineJoin="round"
      />
    ) : null
  ), [completeRoute]);

  const p2dPolyline = useMemo(() => (
    pickupToDestinationRoute.length > 0 ? (
      <Polyline
        coordinates={pickupToDestinationRoute}
        strokeColor={tripStatus === "picked_up" ? "#28a745" : "#FF9500"}
        strokeWidth={tripStatus === "picked_up" ? 6 : 4}
        lineDashPattern={tripStatus === "picked_up" ? [8, 4] : [5, 5]}
        lineCap="round"
        lineJoin="round"
      />
    ) : null
  ), [pickupToDestinationRoute, tripStatus]);

  const fallbackPolyline = useMemo(() => (
    completeRoute.length === 0 ? (
      <Polyline
        coordinates={[pickupCoords, destCoords]}
        strokeColor="#6c757d"
        strokeWidth={8}
        lineDashPattern={[10, 10]}
        lineCap="round"
        lineJoin="round"
      />
    ) : null
  ), [completeRoute.length, pickupCoords, destCoords]);

  const pickupMarker = useMemo(() => (
    tripStatus === "waiting" ? (
      <Marker
        coordinate={pickupCoords}
        title="Pickup Location"
        anchor={{ x: 0.5, y: 1 }}
        tracksViewChanges={false}
      >
        <View style={styles.pickupMarkerContainer}>
          <View style={styles.pickupMarkerLabel}>
            <Text style={styles.pickupMarkerLabelText}>Your Pickup</Text>
          </View>
          <CustomMapMarker size={44} color="#007AFF" />
        </View>
      </Marker>
    ) : null
  ), [tripStatus, pickupCoords]);

  const destMarker = useMemo(() => (
    <Marker
      coordinate={destCoords}
      title="Your Destination"
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={false}
    >
      <View style={styles.destinationMarkerContainer}>
        <View style={styles.destinationMarkerLabel}>
          <Text style={styles.destinationMarkerLabelText}>Destination</Text>
        </View>
        <CustomMapMarker size={44} color="#dc3545" />
      </View>
    </Marker>
  ), [destCoords]);

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

        {/* NEW: lightweight debug info to identify missing tripId / missing view rows */}
        {!!locationError && (
          <View style={styles.fallbackContainer}>
            <Text style={styles.fallbackText}>Debug</Text>
            <Text style={styles.fallbackPayload}>{locationError}</Text>
          </View>
        )}

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
        {routePolyline}

        {/* Show pickup to destination route */}
        {p2dPolyline}

        {/* Fallback: Show direct line from pickup to destination if no routes available */}
        {fallbackPolyline}

        {/* Pickup point marker - Enhanced */}
        {pickupMarker}

        {/* Destination marker - Enhanced */}
        {destMarker}

        {/* Bus marker with enhanced styling (no native animation) */}
        {animatedBusPosition && (
          <Marker
            ref={busMarkerRef}
            coordinate={animatedBusPosition}
            title={busPlateNumber || "Bus"}
            description="Your bus location"
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
          >
            <View style={styles.busMarkerContainer}>
              <View
                style={[
                  styles.busMarkerOuter,
                  tripStatus === "picked_up" && styles.busMarkerOuterBoarded,
                ]}
              >
                <View
                  style={[
                    styles.busMarkerInner,
                    tripStatus === "picked_up" && styles.busMarkerInnerBoarded,
                  ]}
                >
                  <Image
                    source={require("@/assets/images/bus-icon.png")}
                    style={styles.busMarkerIcon}
                    resizeMode="contain"
                  />
                </View>
              </View>

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

        <Animated.View
          style={{
            opacity: panelHeight,
            maxHeight: panelHeight.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 500], // Adjust max height as needed
            }),
            overflow: 'hidden',
          }}
        >
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
        </Animated.View>

        {/* Minimized view - show only essential info */}
        {isPanelMinimized && (
          <View style={styles.minimizedContent}>
            <View style={[styles.statusIndicator, { flexShrink: 1, maxWidth: '40%' }]}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor:
                      tripStatus === "waiting" ? "#FF9500" : "#28a745",
                  },
                ]}
              />
              <Text
                style={styles.statusText}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {tripStatus === "waiting" ? "Waiting" : "On Board"}
              </Text>
            </View>
            <Text
              style={[styles.etaTextMinimized, { flex: 1, textAlign: 'center' }]}
              numberOfLines={1}
            >
              {eta}
            </Text>
            {/* Empty space to push minimize button to the right */}
            <View style={styles.minimizeButtonSpacer} />
          </View>
        )}

        <Animated.View
          style={{
            opacity: panelHeight,
            maxHeight: panelHeight.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 600], // Adjust max height as needed
            }),
            overflow: 'hidden',
          }}
        >
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
        </Animated.View>
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
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowTripSummary(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.completedModalContent}>
            {/* Header Section */}
            <View style={styles.completedHeader}>
              <View style={[
                styles.completedIconContainer,
                { backgroundColor: tripSummaryData.status === "completed" ? "#DCFCE7" : "#FEE2E2" }
              ]}>
                <Ionicons
                  name={tripSummaryData.status === "completed" ? "checkmark-sharp" : "close-sharp"}
                  size={40}
                  color={tripSummaryData.status === "completed" ? "#10B981" : "#EF4444"}
                />
              </View>
              <Text style={styles.completedTitle}>
                {tripSummaryData.status === "completed" ? "Trip Completed!" : "Trip Cancelled"}
              </Text>
              <Text style={styles.completedSubtitle}>
                {tripSummaryData.status === "completed"
                  ? "You have arrived at your destination."
                  : "This trip has been cancelled."}
              </Text>
            </View>

            {/* Stats Row */}
            <View style={styles.completedStatsRow}>
              <View style={styles.completedStatItem}>
                <Ionicons name="time-outline" size={20} color="#6B7280" style={{ marginBottom: 4 }} />
                <Text style={styles.completedStatValue}>{tripSummaryData.duration}</Text>
                <Text style={styles.completedStatLabel}>Duration</Text>
              </View>
              <View style={styles.completedVerticalDivider} />
              <View style={styles.completedStatItem}>
                <Ionicons name="resize-outline" size={20} color="#6B7280" style={{ marginBottom: 4 }} />
                <Text style={styles.completedStatValue}>{tripSummaryData.distance}</Text>
                <Text style={styles.completedStatLabel}>Distance</Text>
              </View>
              <View style={styles.completedVerticalDivider} />
              <View style={styles.completedStatItem}>
                <Ionicons name="bus-outline" size={20} color="#6B7280" style={{ marginBottom: 4 }} />
                <Text style={styles.completedStatValue}>{tripSummaryData.busPlate}</Text>
                <Text style={styles.completedStatLabel}>Bus No.</Text>
              </View>
            </View>

            <View style={styles.completedDivider} />

            {/* Location Details */}
            <View style={{ width: '100%', paddingHorizontal: 4 }}>
              <View style={styles.completedLocationRow}>
                <View style={[styles.completedLocationIcon, { backgroundColor: '#EFF6FF' }]}>
                  <Ionicons name="location" size={16} color="#3B82F6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.completedLocationLabel}>From</Text>
                  <Text style={styles.completedLocationValue} numberOfLines={1}>
                    {tripSummaryData.pickupLocation}
                  </Text>
                </View>
              </View>

              <View style={{ height: 16, borderLeftWidth: 1, borderLeftColor: '#E5E7EB', marginLeft: 16, marginVertical: 2 }} />

              <View style={styles.completedLocationRow}>
                <View style={[styles.completedLocationIcon, { backgroundColor: '#ECFDF5' }]}>
                  <Ionicons name="flag" size={16} color="#10B981" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.completedLocationLabel}>To</Text>
                  <Text style={styles.completedLocationValue} numberOfLines={1}>
                    {tripSummaryData.destination}
                  </Text>
                </View>
              </View>
            </View>

            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.completedButton}
              onPress={() => {
                setShowTripSummary(false);
                // Finalize trip with skipSummary=true to actually complete the trip
                finalizeTrip(tripSummaryData.status === "completed" ? "arrived" : "cancelled", true);
              }}
            >
              <Text style={styles.completedButtonText}>Continue</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
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

  // Enhanced Bus Marker Styles
  busMarkerContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  busMarkerOuter: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255, 193, 7, 0.2)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255, 193, 7, 0.4)",
  },
  busMarkerOuterBoarded: {
    backgroundColor: "rgba(40, 167, 69, 0.2)",
    borderColor: "rgba(40, 167, 69, 0.4)",
  },
  busMarkerInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#ffc107",
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#ffc107",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    borderWidth: 3,
    borderColor: "white",
  },
  busMarkerInnerBoarded: {
    backgroundColor: "#28a745",
    shadowColor: "#28a745",
    borderColor: "white",
  },
  busMarkerIcon: {
    width: 24,
    height: 24,
  },

  // Enhanced Pickup Marker Styles
  pickupMarkerContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  pickupMarkerLabel: {
    backgroundColor: "rgba(0, 122, 255, 0.9)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  pickupMarkerLabelText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },

  // Enhanced Destination Marker Styles
  destinationMarkerContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  destinationMarkerLabel: {
    backgroundColor: "rgba(220, 53, 69, 0.9)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
    shadowColor: "#dc3545",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  destinationMarkerLabelText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },

  // Legacy marker styles (kept for backward compatibility)
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
  // --- Enhanced Completed Modal Styles ---
  completedModalContent: {
    width: "88%",
    maxWidth: 380,
    backgroundColor: "#fff",
    borderRadius: 32,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.2,
    shadowRadius: 32,
    elevation: 24,
  },
  completedHeader: {
    alignItems: "center",
    marginBottom: 24,
  },
  completedIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  completedTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 6,
    textAlign: "center",
  },
  completedSubtitle: {
    fontSize: 14,
    color: "#6B7280",
    textAlign: "center",
  },
  completedStatsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    backgroundColor: "#F9FAFB",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#F3F4F6",
  },
  completedStatItem: {
    flex: 1,
    alignItems: "center",
  },
  completedStatValue: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1F2937",
    marginBottom: 2,
  },
  completedStatLabel: {
    fontSize: 11,
    color: "#9CA3AF",
    fontWeight: "500",
    textTransform: "uppercase",
  },
  completedVerticalDivider: {
    width: 1,
    height: "80%",
    backgroundColor: "#E5E7EB",
    alignSelf: "center",
  },
  completedDivider: {
    width: "100%",
    height: 1,
    backgroundColor: "#E5E7EB",
    marginBottom: 20,
  },
  completedLocationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  completedLocationIcon: {
    width: 32,
    height: 32,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  completedLocationLabel: {
    fontSize: 11,
    color: "#9CA3AF",
    marginBottom: 2,
    fontWeight: "500",
    textTransform: "uppercase",
  },
  completedLocationValue: {
    fontSize: 15,
    fontWeight: "600",
    color: "#374151",
  },
  completedButton: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#007AFF",
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 24,
    gap: 8,
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  completedButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});
