import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { Camera, CameraView } from "expo-camera";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { G, Path } from "react-native-svg";

type LatLng = { latitude: number; longitude: number };

const LOCATION_UPDATE_INTERVAL = 1000; // ms
const DATABASE_SYNC_INTERVAL = 1000; // ms - how often to sync location to database
// Custom SVG Map Marker Component
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
          fill="#c0392b"
        />
      </G>
    </Svg>
  );
};

// Helper: Calculate distance between two LatLng points (Haversine formula)
function getDistance(a: LatLng, b: LatLng) {
  const R = 6371000; // meters
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
}

// Helper: Find minimum distance from driver to polyline
function getMinDistanceToRoute(driver: LatLng, route: LatLng[]) {
  if (!driver || !route.length) return Infinity;
  return Math.min(...route.map((pt) => getDistance(driver, pt)));
}

const DrivingModeScreen = () => {
  // All hooks here!
  const {
    path,
    capacity,
    passengers,
    routeName,
    departureTime,
    tripId,
    busId,
  } = useLocalSearchParams<{
    path: string;
    capacity: string;
    passengers: string;
    routeName: string;
    departureTime: string;
    tripId?: string;
    busId?: string;
  }>();

  const router = useRouter();

  let polylineCoords: LatLng[] = [];
  try {
    polylineCoords = path
      ? JSON.parse(path).map(([lng, lat]: [number, number]) => ({
        latitude: lat,
        longitude: lng,
      }))
      : [];
  } catch (e) {
    polylineCoords = [];
  }

  const parsedCapacity = capacity ? parseInt(capacity, 10) : 0;
  const [passengerCount, setPassengerCount] = useState(
    passengers ? parseInt(passengers, 10) : 0
  );
  const [pickupRequest, setPickupRequest] = useState<string | null>(null);
  const [offRouteWarning, setOffRouteWarning] = useState(false);

  // NEW: Trip status and departure management
  const [tripStatus, setTripStatus] = useState<
    "waiting" | "ongoing" | "completed" | "cancelled"
  >("waiting");
  const [dynamicDepartureTime, setDynamicDepartureTime] =
    useState<string>("Calculating...");
  const [canStartNow, setCanStartNow] = useState(false);
  const [oppositeRouteBuses, setOppositeRouteBuses] = useState<any[]>([]);

  // NEW: Collapsible header state - initially collapsed
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(true);

  // Pickup Request Management
  const [pickupRequests, setPickupRequests] = useState<any[]>([]);
  const [newPickupNotification, setNewPickupNotification] = useState<any>(null);
  const [showPickupNotification, setShowPickupNotification] = useState(false);

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
  const showAlert = (
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
  };

  const hideAlert = () => {
    setShowCustomAlert(false);
  };

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

  // Driver's current location
  const [driverLocation, setDriverLocation] = useState<LatLng | null>(
    polylineCoords[0] || null
  );
  const mapRef = useRef<MapView>(null);

  // End Trip Handler
  const [endingTrip, setEndingTrip] = useState(false);
  // NEW: QR Code scanner state
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const scanLineAnimation = useRef(new Animated.Value(0)).current;

  // Track scanned passengers to prevent duplicate scans
  const [scannedPassengers, setScannedPassengers] = useState<Set<string>>(
    new Set()
  );

  // Trip Summary State
  const [showTripSummary, setShowTripSummary] = useState(false);
  const [tripSummaryData, setTripSummaryData] = useState<{
    routeName: string;
    departureTime: string;
    endTime: string;
    duration: string;
    passengerCount: number;
    capacity: number;
    tripStatus: string;
    startDate: string;
  } | null>(null);

  // Track actual trip start time
  const [actualTripStartTime, setActualTripStartTime] = useState<Date | null>(null);

  // Function to fetch active pickup requests for this bus
  const fetchPickupRequests = async () => {
    if (!busId) return;

    try {
      const { data: requests, error } = await supabase
        .from("pickup_requests")
        .select(
          `
          id,
          commuter_id,
          trip_id,
          pickup_lat,
          pickup_lng,
          dest_lat,
          dest_lng,
          status,
          created_at,
          commuter_name,
          commuter_phone,
          notes
        `
        )
        .eq("bus_id", busId)
        .eq("status", "pending")
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Error fetching pickup requests:", error);
        return;
      }

      setPickupRequests(requests || []);
    } catch (error) {
      console.error("Error in fetchPickupRequests:", error);
    }
  };

  // Function to handle new pickup request notification
  const handleNewPickupRequest = (request: any) => {
    setNewPickupNotification(request);
    setShowPickupNotification(true);

    // Focus camera on pickup request location
    if (request.pickup_lat && request.pickup_lng) {
      const pickupLocation = {
        latitude: request.pickup_lat,
        longitude: request.pickup_lng,
      };

      console.log(
        "📍 Focusing camera on new pickup request location:",
        pickupLocation
      );

      // Animate camera to pickup location with appropriate zoom
      mapRef.current?.animateCamera(
        {
          center: pickupLocation,
          zoom: 14, // Closer zoom to see the pickup location clearly
          pitch: 85, // Slight 3D angle for better view
        },
        { duration: 1500 } // Smooth 1.5 second animation
      );
    }

    // Auto-hide notification after 10 seconds
    setTimeout(() => {
      setShowPickupNotification(false);
      setNewPickupNotification(null);
    }, 10000);
  };

  // Function to accept a pickup request
  const acceptPickupRequest = async (requestId: string) => {
    try {
      const { error } = await supabase
        .from("pickup_requests")
        .update({
          status: "accepted",
          accepted_at: new Date().toISOString(),
        })
        .eq("id", requestId);

      if (error) {
        console.error("Error accepting pickup request:", error);
        showAlert(
          "Accept Failed",
          "Unable to accept the pickup request. Please try again.",
          "error"
        );
        return;
      }

      // Refresh pickup requests
      await fetchPickupRequests();

      // Focus camera on the accepted pickup request location
      const acceptedRequest = pickupRequests.find(
        (req) => req.id === requestId
      );
      if (
        acceptedRequest &&
        acceptedRequest.pickup_lat &&
        acceptedRequest.pickup_lng
      ) {
        const pickupLocation = {
          latitude: acceptedRequest.pickup_lat,
          longitude: acceptedRequest.pickup_lng,
        };

        console.log(
          "📍 Focusing camera on accepted pickup request location:",
          pickupLocation
        );

        // Animate camera to accepted pickup location
        mapRef.current?.animateCamera(
          {
            center: pickupLocation,
            zoom: 14,
            pitch: 85,
          },
          { duration: 1500 }
        );
      }

      showAlert(
        "Pickup Request Accepted! ✅",
        "You have accepted the pickup request. The passenger will be notified.",
        "success"
      );
    } catch (error) {
      console.error("Error in acceptPickupRequest:", error);
      showAlert(
        "Unexpected Error",
        "An unexpected error occurred. Please try again.",
        "error"
      );
    }
  };

  // Function to focus camera on pickup request location
  const focusOnPickupRequest = (request: any) => {
    if (request.pickup_lat && request.pickup_lng) {
      const pickupLocation = {
        latitude: request.pickup_lat,
        longitude: request.pickup_lng,
      };

      console.log(
        "📍 Focusing camera on pickup request location:",
        pickupLocation
      );

      // Animate camera to pickup location
      mapRef.current?.animateCamera(
        {
          center: pickupLocation,
          zoom: 14,
          pitch: 85,
        },
        { duration: 1500 }
      );
    }
  };

  // Function to decline a pickup request
  const declinePickupRequest = async (requestId: string) => {
    try {
      const { error } = await supabase
        .from("pickup_requests")
        .update({
          status: "declined",
          declined_at: new Date().toISOString(),
        })
        .eq("id", requestId);

      if (error) {
        console.error("Error declining pickup request:", error);
        showAlert(
          "Decline Failed",
          "Unable to decline the pickup request. Please try again.",
          "error"
        );
        return;
      }

      // Refresh pickup requests
      await fetchPickupRequests();

      showAlert(
        "Pickup Request Declined",
        "The pickup request has been declined. The passenger will be notified.",
        "info"
      );
    } catch (error) {
      console.error("Error in declinePickupRequest:", error);
      showAlert(
        "Unexpected Error",
        "An unexpected error occurred. Please try again.",
        "error"
      );
    }
  };

  // NEW: Function to find opposite route buses
  const findOppositeRouteBuses = async () => {
    try {
      // Get current route details
      const { data: currentRoute, error: routeError } = await supabase
        .from("routes")
        .select("id, name, start_address, end_address")
        .ilike("name", `%${routeName}%`)
        .single();

      if (routeError || !currentRoute) {
        console.error("Error fetching current route:", routeError);
        return;
      }

      // Find opposite route (same start/end addresses but reversed)
      const { data: oppositeRoute, error: oppositeError } = await supabase
        .from("routes")
        .select("id, name")
        .eq("start_address", currentRoute.end_address)
        .eq("end_address", currentRoute.start_address)
        .single();

      if (oppositeError || !oppositeRoute) {
        setOppositeRouteBuses([]);
        return;
      }

      // Get active buses on opposite route
      const { data: oppositeBuses, error: busesError } = await supabase
        .from("buses")
        .select(
          `
          id,
          plate_number,
          passengers,
          capacity,
          status,
          trips!inner(
            id,
            status,
            created_at
          )
        `
        )
        .eq("route_id", oppositeRoute.id)
        .eq("status", "active")
        .eq("trips.status", "ongoing");

      if (busesError) {
        console.error("Error fetching opposite route buses:", busesError);
        return;
      }

      setOppositeRouteBuses(oppositeBuses || []);
    } catch (error) {
      console.error("Error in findOppositeRouteBuses:", error);
    }
  };

  // NEW: Function to calculate dynamic departure time
  const calculateDynamicDepartureTime = () => {
    const now = new Date();

    // If trip is already ongoing, show arrival information instead
    if (tripStatus === "ongoing") {
      // Estimate arrival time based on route length and average speed
      // For now, use a simple estimate of 20-30 minutes for arrival
      const estimatedTripDuration = 25; // minutes (you can make this more sophisticated)
      const arrivalTime = new Date(now.getTime() + estimatedTripDuration * 60000);
      setDynamicDepartureTime(
        `Arriving at ${arrivalTime.toLocaleTimeString()} - Trip in progress`
      );
      setCanStartNow(false); // No start button needed when trip is ongoing
      return;
    }

    // Check if bus is full
    const isBusFull = passengerCount >= parsedCapacity;

    // Check if there are opposite route buses
    const hasOppositeBuses = oppositeRouteBuses.length > 0;

    if (isBusFull) {
      // If bus is full, depart immediately
      setDynamicDepartureTime("Departing now - Bus is full!");
      setCanStartNow(true);
    } else if (hasOppositeBuses) {
      // If there are opposite route buses, wait for coordination
      const waitTime = Math.max(5, 15 - passengerCount); // Wait 5-15 minutes based on passengers
      const departureTime = new Date(now.getTime() + waitTime * 60000);
      setDynamicDepartureTime(
        `Departing at ${departureTime.toLocaleTimeString()} - Coordinating with opposite route`
      );
      setCanStartNow(waitTime <= 5);
    } else {
      // No opposite buses, wait for more passengers or minimum time
      const waitTime = Math.max(10, 20 - passengerCount * 2); // Wait 10-20 minutes
      const departureTime = new Date(now.getTime() + waitTime * 60000);
      setDynamicDepartureTime(
        `Departing at ${departureTime.toLocaleTimeString()} - Waiting for more passengers`
      );
      setCanStartNow(waitTime <= 10);
    }
  };

  // All useEffect hooks here!
  useEffect(() => {
    let locationSubscription: Location.LocationSubscription | null = null;
    let lastSyncTime = 0; // Track last database sync time

    // Function to sync location to database
    const syncLocationToDatabase = async (coords: LatLng) => {
      const now = Date.now();
      // Only sync if enough time has passed since last sync
      if (now - lastSyncTime < DATABASE_SYNC_INTERVAL) {
        return;
      }
      lastSyncTime = now;

      // Only sync if we have a valid tripId
      if (!tripId) {
        console.log("📍 Location sync skipped: No tripId available");
        return;
      }

      try {
        // Update the trips table with current location using PostGIS Point format
        const { error } = await supabase
          .from("trips")
          .update({
            current_location: `POINT(${coords.longitude} ${coords.latitude})`,
          })
          .eq("id", tripId);

        if (error) {
          console.error("📍 Error syncing location to database:", error);
        } else {
          console.log("📍 Location synced to database:", coords);
        }
      } catch (error) {
        console.error("📍 Error in syncLocationToDatabase:", error);
      }
    };

    async function startLocationUpdates() {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      locationSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: LOCATION_UPDATE_INTERVAL,
          distanceInterval: 2,
        },
        (location) => {
          const coords = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          };
          setDriverLocation(coords);

          // Sync location to database for commuters to see real-time updates
          syncLocationToDatabase(coords);

          // Animate camera to follow driver with 3D effect
          mapRef.current?.animateCamera(
            {
              center: coords,
              pitch: 85, // Slight 3D angle for better view
              zoom: 14, // Higher zoom for closer view
              heading: location.coords.heading || 0, // Use device heading if available
            },
            { duration: 1000 }
          );
        }
      );
    }

    startLocationUpdates();

    return () => {
      locationSubscription?.remove();
    };
  }, [tripId]);

  useEffect(() => {
    if (!driverLocation || !polylineCoords.length) return;
    const minDist = getMinDistanceToRoute(driverLocation, polylineCoords);
    setOffRouteWarning(minDist > 100); // 100 meters threshold
  }, [driverLocation, polylineCoords]);

  // NEW: Initialize departure time calculation
  useEffect(() => {
    findOppositeRouteBuses();
  }, [routeName]);

  // Fetch pickup requests on component mount
  useEffect(() => {
    if (busId) {
      fetchPickupRequests();
    }
  }, [busId]);

  // Set up real-time subscription for pickup requests
  useEffect(() => {
    if (!busId) return;

    const subscription = supabase
      .channel(`pickup_requests_${busId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "pickup_requests",
          filter: `bus_id=eq.${busId}`,
        },
        (payload) => {
          handleNewPickupRequest(payload.new);
          // Refresh the pickup requests list
          fetchPickupRequests();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "pickup_requests",
          filter: `bus_id=eq.${busId}`,
        },
        (payload) => {
          // Refresh the pickup requests list
          fetchPickupRequests();
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [busId]);

  // NEW: Recalculate departure time when passenger count, opposite buses, or trip status change
  useEffect(() => {
    calculateDynamicDepartureTime();
  }, [passengerCount, oppositeRouteBuses, parsedCapacity, tripStatus]);

  // NEW: Initialize trip status and passenger data from database
  useEffect(() => {
    const fetchTripStatus = async () => {
      if (!tripId || !busId) return;

      try {
        // Fetch trip status
        const { data: tripData, error } = await supabase
          .from("trips")
          .select("status, started_at")
          .eq("id", tripId)
          .single();

        if (error) {
          console.error("Error fetching trip status:", error);
          return;
        }

        if (tripData) {
          setTripStatus(
            tripData.status as "waiting" | "ongoing" | "completed" | "cancelled"
          );

          // If trip is ongoing and we have a start time, save it
          if (tripData.status === "ongoing" && tripData.started_at) {
            setActualTripStartTime(new Date(tripData.started_at));
          }
        }

        // Fetch current passenger count and scanned passengers from database
        const { data: boardedPassengers, error: passengersError } =
          await supabase
            .from("trip_passengers")
            .select("passenger_id, passenger_count")
            .eq("bus_id", busId)
            .eq("trip_id", tripId)
            .eq("status", "boarded");

        if (passengersError) {
          console.error("Error fetching boarded passengers:", passengersError);
          return;
        }

        if (boardedPassengers && boardedPassengers.length > 0) {
          // Set scanned passengers
          const passengerIds = new Set(
            boardedPassengers.map((p) => p.passenger_id)
          );
          setScannedPassengers(passengerIds);

          // Calculate total passenger count
          const totalPassengers = boardedPassengers.reduce(
            (sum, p) => sum + (p.passenger_count || 1),
            0
          );
          setPassengerCount(totalPassengers);

          console.log(
            `🔄 Restored ${boardedPassengers.length} boarded passengers (${totalPassengers} total) from database`
          );
        }
      } catch (error) {
        console.error("Error in fetchTripStatus:", error);
      }
    };

    fetchTripStatus();
  }, [tripId, busId]);

  // NEW: Request camera permissions for QR scanner
  useEffect(() => {
    (async () => {
      // Changed to Camera.requestCameraPermissionsAsync()
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === "granted");
    })();
  }, []);

  // Animation for scanning line
  useEffect(() => {
    if (scanning && !scanned) {
      const startAnimation = () => {
        scanLineAnimation.setValue(0);
        Animated.timing(scanLineAnimation, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }).start(() => {
          if (scanning && !scanned) {
            startAnimation();
          }
        });
      };
      startAnimation();
    } else {
      scanLineAnimation.stopAnimation();
    }
  }, [scanning, scanned, scanLineAnimation]);

  // NEW: Handle scanned QR code
  const handleBarCodeScanned = async ({
    type,
    data,
  }: {
    type: string;
    data: string;
  }) => {
    setScanned(true);
    setScanning(false);
    try {
      const payload = JSON.parse(data);
      if (
        payload.type === "pickup_request" &&
        payload.commuterId &&
        payload.busId === busId
      ) {
        // Handle tripId - create one if missing
        let tripId = payload.tripId;

        if (!tripId || tripId === "will-be-created") {
          // Get passenger count from the payload or default to 1
          const groupSize = payload.passengerCount || 1;

          const { data: newTrip, error: createError } = await supabase
            .from("trips")
            .insert({
              bus_id: busId,
              status: "waiting",
              passenger_count: groupSize,
            })
            .select("id")
            .single();

          if (createError) {
            console.error("Error creating trip:", createError);
            showAlert(
              "Trip Creation Failed",
              "Unable to create a new trip for this passenger. Please try again or contact support.",
              "error"
            );
            return;
          }
          tripId = newTrip.id;
        }

        // Check if trip_passengers record already exists
        // Use limit(1) and order by created_at desc to get the most recent record
        const { data: existingRecords, error: checkError } = await supabase
          .from("trip_passengers")
          .select("id, status")
          .eq("bus_id", busId)
          .eq("passenger_id", payload.commuterId)
          .eq("trip_id", tripId)
          .order("created_at", { ascending: false })
          .limit(1);

        const existingRecord = existingRecords?.[0];

        if (!existingRecord || checkError) {
          console.error("No trip_passengers record found for this passenger:", {
            busId,
            passengerId: payload.commuterId,
            tripId,
            error: checkError,
            recordsFound: existingRecords?.length || 0,
          });
          showAlert(
            "Boarding Failed",
            "No pickup request found for this passenger. Please make sure the passenger has requested a pickup first.",
            "error"
          );
          return;
        }

        // Check if passenger is already boarded
        if (existingRecord.status === "boarded") {
          showAlert(
            "Already Boarded",
            "This passenger has already been boarded. No need to scan again.",
            "info"
          );
          return;
        }

        // Check if passenger has already been scanned in this session
        if (scannedPassengers.has(payload.commuterId)) {
          showAlert(
            "Already Scanned",
            "This passenger has already been scanned in this session. No need to scan again.",
            "info"
          );
          return;
        }

        // Update existing record to boarded status
        const { data: updatedRecord, error: updateError } = await supabase
          .from("trip_passengers")
          .update({
            pickup_lat: payload.pickup.latitude,
            pickup_lng: payload.pickup.longitude,
            dest_lat: payload.dest.latitude,
            dest_lng: payload.dest.longitude,
            status: "boarded",
            boarded_at: new Date().toISOString(),
            passenger_count: payload.passengerCount || 1,
          })
          .eq("id", existingRecord.id)
          .select()
          .single();

        if (updateError) {
          console.error("Error updating boarding record:", updateError);
          showAlert(
            "Boarding Failed",
            "Unable to update passenger boarding record. Please try scanning the QR code again.",
            "error"
          );
          return;
        }

        // Note: Trip status remains "waiting" until driver explicitly starts the trip
        // This allows multiple passengers to be scanned before the trip officially begins

        // Add passenger to scanned passengers set
        setScannedPassengers((prev) => new Set(prev).add(payload.commuterId));

        let newPassengerCount = 0;
        try {
          // Get passenger count from the payload or default to 1
          const groupSize = payload.passengerCount || 1;
          console.log(
            "QR Code scanned - Group size:",
            groupSize,
            "Payload:",
            payload
          );

          // Update bus passenger count in database
          const { data: currentBus, error: getBusError } = await supabase
            .from("buses")
            .select("passengers")
            .eq("id", busId)
            .single();

          if (getBusError) {
            console.error("Error getting current bus passengers:", getBusError);
            return;
          }

          const currentPassengers = currentBus?.passengers || 0;
          newPassengerCount = Math.min(
            currentPassengers + groupSize,
            parsedCapacity
          );

          const { error: busUpdateError } = await supabase
            .from("buses")
            .update({
              passengers: newPassengerCount,
            })
            .eq("id", busId);

          // Update local state after successful database update
          if (!busUpdateError) {
            setPassengerCount(newPassengerCount);
          }

          const passengerText =
            groupSize > 1 ? `${groupSize} passengers` : "1 passenger";
          showAlert(
            "Boarding Successful! 🎉",
            `Added ${passengerText} to your trip. Current total: ${newPassengerCount}/${parsedCapacity}`,
            "success"
          );
        } catch (error) {
          console.error("Error updating passenger count:", error);
          showAlert(
            "Error",
            "Failed to update passenger count. Please try again.",
            "error"
          );
        }
      } else {
        showAlert(
          "Invalid QR Code",
          "This QR code is not a valid pickup request for this bus. Please make sure the passenger is scanning the correct QR code for this route.",
          "error"
        );
      }
    } catch (e) {
      console.error("Error processing QR code:", e);
      showAlert(
        "QR Code Error",
        "Could not read the QR code data. Please make sure the QR code is clear and try again.",
        "error"
      );
    }
    // Reset scanned state after a short delay to allow scanning again
    setTimeout(() => setScanned(false), 2000);
  };

  // MODIFIED: Dummy QR scan handler -> Actual QR scan trigger
  const handleQRScan = () => {
    if (hasPermission === null) {
      showAlert(
        "Camera Permission Required",
        "We need access to your camera to scan passenger QR codes. Please grant permission to continue.",
        "info"
      );
    } else if (hasPermission === false) {
      showAlert(
        "Camera Access Denied",
        "Cannot scan QR codes without camera access. Please enable camera permission in your device settings to scan passenger QR codes.",
        "error"
      );
    } else {
      setScanning(true);
    }
  };

  // NEW: Start Now button handler
  const handleStartNow = async () => {
    if (!tripId || !busId) return;

    const isEarlyStart = !canStartNow;
    const alertTitle = isEarlyStart ? "Start Trip Early" : "Start Trip";
    const alertMessage = isEarlyStart
      ? "Are you sure you want to start this trip early? This will begin the journey before the recommended departure time. You currently have " +
      passengerCount +
      "/" +
      parsedCapacity +
      " passengers."
      : "Are you sure you want to officially start this trip? This will begin the journey with " +
      passengerCount +
      "/" +
      parsedCapacity +
      " passengers.";

    showAlert(
      alertTitle,
      alertMessage,
      isEarlyStart ? "warning" : "info",
      async () => {
        try {
          // Update trip status to ongoing
          const tripStartTime = new Date();
          const { error: tripError } = await supabase
            .from("trips")
            .update({
              status: "ongoing",
              started_at: tripStartTime.toISOString(),
            })
            .eq("id", tripId);

          if (tripError) {
            console.error("Error updating trip status:", tripError);
            showAlert(
              "Trip Start Failed",
              "Unable to start the trip. Please check your connection and try again.",
              "error"
            );
            return;
          }

          setTripStatus("ongoing");
          setActualTripStartTime(tripStartTime); // Save the actual start time
          showAlert(
            "Trip Started Successfully! 🚌",
            "The trip has been officially started! You can now begin the journey. Safe travels!",
            "success"
          );
        } catch (error) {
          console.error("Unexpected error starting trip:", error);
          showAlert(
            "Unexpected Error",
            "An unexpected error occurred while starting the trip. Please try again or contact support.",
            "error"
          );
        }
      },
      isEarlyStart ? "Start Early" : "Start Trip",
      true,
      () => { },
      "Cancel"
    );
  };

  const handleEndTrip = async () => {
    if (!tripId || !busId) return;

    const isTripOfficiallyStarted = tripStatus === "ongoing";
    const alertMessage = isTripOfficiallyStarted
      ? "Are you sure you want to end this trip? This will complete the journey for all " +
      passengerCount +
      " passengers."
      : "Are you sure you want to cancel this trip? This will remove all " +
      passengerCount +
      " boarded passengers and they will need to book again.";

    showAlert(
      isTripOfficiallyStarted ? "End Trip" : "Cancel Trip",
      alertMessage,
      isTripOfficiallyStarted ? "info" : "warning",
      async () => {
        setEndingTrip(true);
        try {
          // 1. Update passenger status based on trip status
          const passengerStatus = isTripOfficiallyStarted
            ? "completed"
            : "cancelled";

          console.log(
            `🚌 Driver ending trip - Updating passenger status to: ${passengerStatus}`
          );
          console.log(`🚌 Trip ID: ${tripId}, Bus ID: ${busId}`);

          const { data: updateResult, error: passengersError } = await supabase
            .from("trip_passengers")
            .update({ status: passengerStatus })
            .eq("trip_id", tripId)
            .eq("bus_id", busId)
            .select("id, passenger_id, status");

          if (passengersError) {
            console.error("Error updating passengers:", passengersError);
            showAlert(
              "Passenger Update Failed",
              `Unable to ${isTripOfficiallyStarted ? "complete" : "cancel"
              } passenger bookings. Please try again or contact support.`,
              "error"
            );
            setEndingTrip(false);
            return;
          }

          console.log(
            `Successfully ${isTripOfficiallyStarted ? "completed" : "cancelled"
            } ${updateResult?.length || 0} passenger bookings:`,
            updateResult
          );

          // 2. Update trip status
          const updateData: any = {
            ended_at: new Date().toISOString(),
          };

          if (isTripOfficiallyStarted) {
            // Trip was officially started, mark as completed
            updateData.status = "completed";
          } else {
            // Trip was never officially started, mark as cancelled
            updateData.status = "cancelled";
            updateData.cancelled_at = new Date().toISOString();
            updateData.cancellation_reason = "driver_cancelled_before_start";
          }

          const { error: tripError } = await supabase
            .from("trips")
            .update(updateData)
            .eq("id", tripId);

          if (tripError) {
            console.error("Error updating trip status:", tripError);
            showAlert(
              "Trip Status Update Failed",
              "Unable to update trip status. Please try again or contact support.",
              "error"
            );
            setEndingTrip(false);
            return;
          }

          // 3. Reset bus passenger count to 0 and set status to inactive
          const { error: busError } = await supabase
            .from("buses")
            .update({
              status: "inactive",
              passengers: 0,
            })
            .eq("id", busId);

          if (busError) {
            console.error("Error updating bus status:", busError);
            showAlert(
              "Bus Status Update Failed",
              "Unable to update bus status. Please try again or contact support.",
              "error"
            );
            setEndingTrip(false);
            return;
          }

          console.log("Successfully ended trip and reset bus");

          // Reset scanned passengers for next trip
          setScannedPassengers(new Set());

          // Prepare trip summary data
          const endTime = new Date();

          // Use actual start time if trip was started, otherwise use current time (for cancellation)
          const startTime = isTripOfficiallyStarted && actualTripStartTime
            ? actualTripStartTime
            : new Date(); // For cancelled trips, just use current time

          const durationMs = endTime.getTime() - startTime.getTime();
          const hours = Math.floor(durationMs / (1000 * 60 * 60));
          const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
          const durationString = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

          const summaryData = {
            routeName: routeName || "Unknown Route",
            departureTime: startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            endTime: endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            duration: isTripOfficiallyStarted ? durationString : "N/A",
            passengerCount: passengerCount,
            capacity: parsedCapacity,
            tripStatus: isTripOfficiallyStarted ? "completed" : "cancelled",
            startDate: endTime.toLocaleDateString([], {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })
          };

          setTripSummaryData(summaryData);
          setShowTripSummary(true);
        } catch (error) {
          console.error("Unexpected error ending trip:", error);
          showAlert(
            "Unexpected Error",
            "An unexpected error occurred while ending the trip. Please try again or contact support.",
            "error"
          );
        } finally {
          setEndingTrip(false);
        }
      },
      isTripOfficiallyStarted ? "End Trip" : "Cancel Trip",
      true,
      () => { },
      "Cancel"
    );
  };

  // Handle Trip Summary Close
  const handleTripSummaryClose = () => {
    setShowTripSummary(false);
    setTripSummaryData(null);
    router.replace("/(driver)");
  };

  // Only return UI after all hooks
  if (!driverLocation || !polylineCoords.length) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#f2f2f7" }}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
          <Text>No route or location data available.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Calculate camera position to show route start at bottom and end at top
  const routeStart = polylineCoords[0];
  const routeEnd = polylineCoords[polylineCoords.length - 1];

  // Calculate the bearing from start to end
  const calculateBearing = (start: { latitude: number; longitude: number }, end: { latitude: number; longitude: number }) => {
    const dLng = (end.longitude - start.longitude) * Math.PI / 180;
    const lat1 = start.latitude * Math.PI / 180;
    const lat2 = end.latitude * Math.PI / 180;

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

    const bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
  };

  // Calculate center point between start and end
  const routeCenter = {
    latitude: (routeStart.latitude + routeEnd.latitude) / 2,
    longitude: (routeStart.longitude + routeEnd.longitude) / 2,
  };

  const initialCamera = {
    center: routeCenter,
    pitch: 80, // Good 3D angle to see the route clearly
    heading: calculateBearing(routeStart, routeEnd), // Point camera in route direction
    zoom: 19, // Zoom level to see both start and end points
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      {/* Collapsible Top Header - Premium Design */}
      <TouchableOpacity
        onPress={() => setIsHeaderCollapsed(!isHeaderCollapsed)}
        activeOpacity={0.9}
      >
        <LinearGradient
          colors={["#0891B2", "#06B6D4", "#22D3EE"]}
          start={[0, 0]}
          end={[1, 1]}
          style={[styles.topBar, isHeaderCollapsed && styles.topBarCollapsed]}
        >
          {/* Decorative Elements */}
          <View style={styles.headerDecoCircle1} />
          <View style={styles.headerDecoCircle2} />

          {/* Route Title - Always Visible */}
          <View style={styles.routeHeader}>
            <View style={styles.routeIconContainer}>
              <Ionicons name="bus" size={22} color="#fff" />
            </View>
            <View style={styles.routeTitleContainer}>
              <Text style={styles.routeName}>{routeName}</Text>
              <Text style={styles.routeSubtitle}>Active Trip</Text>
            </View>
            <View style={styles.headerToggle}>
              <Ionicons
                name={isHeaderCollapsed ? "chevron-down" : "chevron-up"}
                size={20}
                color="rgba(255,255,255,0.8)"
              />
            </View>
          </View>

          {/* Collapsible Content */}
          {!isHeaderCollapsed && (
            <>
              {/* Status Card */}
              <View style={styles.statusCard}>
                <View style={styles.statusRow}>
                  <View style={styles.statusItem}>
                    <View style={styles.statusIconWrapper}>
                      <Ionicons
                        name={
                          tripStatus === "waiting"
                            ? "time"
                            : tripStatus === "ongoing"
                              ? "play-circle"
                              : "checkmark-circle"
                        }
                        size={20}
                        color="#22D3EE"
                      />
                    </View>
                    <Text style={styles.statusLabel}>Status</Text>
                    <Text style={styles.statusValue}>
                      {tripStatus === "waiting"
                        ? "Waiting"
                        : tripStatus === "ongoing"
                          ? "In Progress"
                          : tripStatus === "completed"
                            ? "Completed"
                            : "Cancelled"}
                    </Text>
                  </View>

                  <View style={styles.statusDivider} />

                  <View style={styles.statusItem}>
                    <View style={styles.statusIconWrapper}>
                      <Ionicons name="people" size={20} color="#22D3EE" />
                    </View>
                    <Text style={styles.statusLabel}>Passengers</Text>
                    <Text style={styles.statusValue}>
                      {passengerCount}/{parsedCapacity}
                    </Text>
                    <Text style={styles.statusSubtext}>
                      {scannedPassengers.size} scanned
                    </Text>
                  </View>
                </View>

                {/* Progress Bar */}
                <View style={styles.progressContainer}>
                  <View style={styles.progressBar}>
                    <LinearGradient
                      colors={["#10B981", "#34D399"]}
                      start={[0, 0]}
                      end={[1, 0]}
                      style={[
                        styles.progressFill,
                        {
                          width: `${(passengerCount / parsedCapacity) * 100}%`,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.progressText}>
                    {Math.round((passengerCount / parsedCapacity) * 100)}% Capacity
                  </Text>
                </View>

                {/* Departure Time */}
                <View style={styles.departureSection}>
                  <Ionicons name="time-outline" size={16} color="rgba(255,255,255,0.7)" />
                  <Text style={styles.departureText}>
                    {dynamicDepartureTime}
                  </Text>
                </View>
              </View>

              {/* Warning Panel */}
              {offRouteWarning && (
                <LinearGradient
                  colors={["#EF4444", "#DC2626"]}
                  style={styles.warningPanel}
                  start={[0, 0]}
                  end={[1, 0]}
                >
                  <Ionicons name="warning" size={18} color="#fff" />
                  <Text style={styles.warningText}>You are off the route!</Text>
                </LinearGradient>
              )}
            </>
          )}

          {/* Quick Info Bar - Always Visible When Collapsed */}
          {isHeaderCollapsed && (
            <View style={styles.quickInfoBar}>
              <View style={styles.quickInfoItem}>
                <View style={styles.quickInfoIconBg}>
                  <Ionicons name="people" size={14} color="#fff" />
                </View>
                <Text style={styles.quickInfoText}>
                  {passengerCount}/{parsedCapacity}
                </Text>
              </View>
              <View style={styles.quickInfoItem}>
                <View style={[
                  styles.quickInfoIconBg,
                  tripStatus === "ongoing" && { backgroundColor: "#10B981" }
                ]}>
                  <Ionicons
                    name={
                      tripStatus === "waiting"
                        ? "time"
                        : tripStatus === "ongoing"
                          ? "play-circle"
                          : "checkmark-circle"
                    }
                    size={14}
                    color="#fff"
                  />
                </View>
                <Text style={styles.quickInfoText}>
                  {tripStatus === "waiting"
                    ? "Waiting"
                    : tripStatus === "ongoing"
                      ? "Active"
                      : "Done"}
                </Text>
              </View>
              {offRouteWarning && (
                <View style={styles.quickInfoItem}>
                  <View style={[styles.quickInfoIconBg, { backgroundColor: "#EF4444" }]}>
                    <Ionicons name="warning" size={14} color="#fff" />
                  </View>
                  <Text style={[styles.quickInfoText, { color: "#FCA5A5" }]}>
                    Off Route
                  </Text>
                </View>
              )}
            </View>
          )}
        </LinearGradient>
      </TouchableOpacity>

      <View style={styles.container}>
        {/* Map */}
        <MapView
          style={styles.map}
          initialCamera={initialCamera}
          showsUserLocation={false}
          showsMyLocationButton
          showsBuildings={true}
          googleRenderer="LEGACY"
        >
          {polylineCoords.length > 0 && (
            <Polyline
              coordinates={polylineCoords}
              strokeColor="#007AFF"
              strokeWidth={6}
            />
          )}
          {driverLocation && (
            <Marker coordinate={driverLocation} title="You (Driver)">
              <View style={styles.driverMarkerContainer}>
                <Image
                  source={require("../assets/images/bus-icon.png")}
                  style={styles.driverMarkerIcon}
                  resizeMode="contain"
                />
                <View style={styles.driverMarkerPointer} />
              </View>
            </Marker>
          )}

          {/* Pickup Request Markers */}
          {pickupRequests.map((request) => (
            <Marker
              key={request.id}
              coordinate={{
                latitude: request.pickup_lat,
                longitude: request.pickup_lng,
              }}
              tracksViewChanges={false}
              anchor={{ x: 0.5, y: 1 }}
            >
              <View style={styles.pickupMarkerContainer}>
                <View style={styles.pickupMarkerLabel}>
                  <Text style={styles.pickupMarkerText}>Pick me here!</Text>
                </View>
                <CustomMapMarker size={40} color="#FF9500" />
              </View>
            </Marker>
          ))}

          {/* Route Start Marker */}
          {polylineCoords.length > 0 && (
            <Marker
              coordinate={polylineCoords[0]}
              title="Route Start"
              description="Starting point of the route"
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
          {polylineCoords.length > 0 && (
            <Marker
              coordinate={polylineCoords[polylineCoords.length - 1]}
              title="Route End"
              description="End point of the route"
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={styles.routeMarkerContainer}>
                <Image
                  source={require("../assets/images/end-route.png")}
                  style={styles.routeMarkerIcon}
                  resizeMode="contain"
                />
              </View>
            </Marker>
          )}
        </MapView>

        {/* Pickup Requests Panel */}
        {pickupRequests.length > 0 && (
          <View style={styles.pickupRequestsPanel}>
            <View style={styles.pickupRequestsHeader}>
              <Ionicons name="people" size={20} color="#FF9500" />
              <Text style={styles.pickupRequestsTitle}>
                Pickup Requests ({pickupRequests.length})
              </Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.pickupRequestsScroll}
            >
              {pickupRequests.map((request) => (
                <View key={request.id} style={styles.pickupRequestCard}>
                  <View style={styles.pickupRequestInfo}>
                    <Text style={styles.pickupRequestName}>
                      {request.commuter_name || "Unknown"}
                    </Text>
                    <Text style={styles.pickupRequestPhone}>
                      {request.commuter_phone || "No phone"}
                    </Text>
                    {request.notes && (
                      <Text style={styles.pickupRequestNotes}>
                        Note: {request.notes}
                      </Text>
                    )}
                  </View>
                  <View style={styles.pickupRequestActions}>
                    <TouchableOpacity
                      style={[styles.pickupActionButton, styles.acceptButton]}
                      onPress={() => acceptPickupRequest(request.id)}
                    >
                      <Ionicons name="checkmark" size={16} color="#fff" />
                      <Text style={styles.acceptButtonText}>Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.pickupActionButton, styles.declineButton]}
                      onPress={() => declinePickupRequest(request.id)}
                    >
                      <Ionicons name="close" size={16} color="#fff" />
                      <Text style={styles.declineButtonText}>Decline</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Enhanced Action Buttons */}
        <View style={styles.actionContainer}>
          {/* Primary Actions Row */}
          <View style={styles.primaryActions}>
            <TouchableOpacity
              style={[styles.primaryButton, styles.scanButton]}
              onPress={handleQRScan}
            >
              <View style={styles.buttonIconContainer}>
                <Ionicons name="qr-code" size={28} color="#fff" />
              </View>
              <Text style={styles.primaryButtonText}>Scan QR Code</Text>
              <Text style={styles.buttonSubtext}>Add Passengers</Text>
            </TouchableOpacity>

            {tripStatus === "waiting" && (
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  styles.startButton,
                  {
                    backgroundColor: canStartNow ? "#4CAF50" : "#FF9500",
                  },
                ]}
                onPress={handleStartNow}
              >
                <View style={styles.buttonIconContainer}>
                  <Ionicons
                    name={canStartNow ? "play" : "play-forward"}
                    size={28}
                    color="#fff"
                  />
                </View>
                <Text style={styles.primaryButtonText}>
                  {canStartNow ? "Start Trip" : "Start Early"}
                </Text>
                <Text style={styles.buttonSubtext}>
                  {canStartNow ? "Ready to go!" : "Before scheduled time"}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Secondary Action */}
          <TouchableOpacity
            style={[
              styles.secondaryButton,
              endingTrip && styles.disabledButton,
            ]}
            onPress={handleEndTrip}
            disabled={endingTrip}
          >
            <Ionicons
              name={
                endingTrip
                  ? "hourglass"
                  : tripStatus === "waiting"
                    ? "close-circle"
                    : "stop-circle"
              }
              size={20}
              color={endingTrip ? "#8e8e93" : "#ff4d4f"}
            />
            <Text
              style={[
                styles.secondaryButtonText,
                endingTrip && styles.disabledText,
              ]}
            >
              {endingTrip
                ? "Processing..."
                : tripStatus === "waiting"
                  ? "Cancel Trip"
                  : "End Trip"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Improved QR Code Scanner Modal */}
      <Modal
        animationType="slide"
        transparent={false}
        visible={scanning}
        onRequestClose={() => setScanning(false)}
      >
        <View style={styles.qrScannerContainer}>
          <CameraView
            onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            barcodeScannerSettings={{
              barcodeTypes: ["qr"],
            }}
            style={StyleSheet.absoluteFillObject}
          />

          {/* Top Header */}
          <View style={styles.qrHeader}>
            <TouchableOpacity
              style={styles.qrBackButton}
              onPress={() => setScanning(false)}
            >
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.qrHeaderTitle}>Scan Passenger QR</Text>
            <View style={styles.qrHeaderSpacer} />
          </View>

          {/* Scanning Frame Overlay */}
          <View style={styles.qrOverlay}>
            {/* Middle Section - Scanning Frame */}
            <View style={styles.qrMiddleSection}>
              <View style={styles.qrScanningFrame}>
                {/* Corner indicators */}
                <View style={[styles.qrCorner, styles.qrTopLeft]} />
                <View style={[styles.qrCorner, styles.qrTopRight]} />
                <View style={[styles.qrCorner, styles.qrBottomLeft]} />
                <View style={[styles.qrCorner, styles.qrBottomRight]} />

                {/* Scanning line animation */}
                {!scanned && (
                  <Animated.View
                    style={[
                      styles.qrScanningLine,
                      {
                        transform: [
                          {
                            translateY: scanLineAnimation.interpolate({
                              inputRange: [0, 1],
                              outputRange: [-100, 100],
                            }),
                          },
                        ],
                      },
                    ]}
                  />
                )}
              </View>
            </View>

            {/* Bottom Section */}
            <View style={styles.qrBottomSection}>
              <View style={styles.qrStatusContainer}>
                {scanned ? (
                  <View style={styles.qrSuccessContainer}>
                    <Ionicons
                      name="checkmark-circle"
                      size={48}
                      color="#4CAF50"
                    />
                    <Text style={styles.qrSuccessText}>QR Code Scanned!</Text>
                    <Text style={styles.qrSuccessSubtext}>
                      Processing passenger data...
                    </Text>
                  </View>
                ) : (
                  <View style={styles.qrWaitingContainer}>
                    <Ionicons name="scan-outline" size={48} color="#fff" />
                    <Text style={styles.qrWaitingText}>
                      Waiting for QR Code
                    </Text>
                    <Text style={styles.qrWaitingSubtext}>
                      Make sure the QR code is clearly visible
                    </Text>
                  </View>
                )}
              </View>

              <TouchableOpacity
                style={styles.qrCancelButton}
                onPress={() => setScanning(false)}
              >
                <Ionicons name="close" size={20} color="#fff" />
                <Text style={styles.qrCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* New Pickup Request Notification */}
      <Modal
        visible={showPickupNotification}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowPickupNotification(false)}
      >
        <View style={styles.notificationOverlay}>
          <View style={styles.notificationContainer}>
            <View style={styles.notificationHeader}>
              <View style={styles.notificationIconContainer}>
                <Ionicons name="person-add" size={24} color="#fff" />
              </View>
              <Text style={styles.notificationTitle}>New Pickup Request!</Text>
            </View>

            {newPickupNotification && (
              <>
                <Text style={styles.notificationMessage}>
                  {newPickupNotification.commuter_name || "Unknown passenger"}
                  wants to be picked up
                </Text>
                <Text style={styles.notificationDetails}>
                  Phone: {newPickupNotification.commuter_phone || "N/A"}
                </Text>
                {newPickupNotification.notes && (
                  <Text style={styles.notificationNotes}>
                    Note: {newPickupNotification.notes}
                  </Text>
                )}

                <View style={styles.notificationActions}>
                  <TouchableOpacity
                    style={[
                      styles.notificationButton,
                      styles.declineNotificationButton,
                    ]}
                    onPress={() => {
                      setShowPickupNotification(false);
                      setNewPickupNotification(null);
                    }}
                  >
                    <Text style={styles.declineNotificationText}>Dismiss</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.notificationButton,
                      styles.acceptNotificationButton,
                    ]}
                    onPress={() => {
                      setShowPickupNotification(false);
                      if (newPickupNotification) {
                        acceptPickupRequest(newPickupNotification.id);
                      }
                      setNewPickupNotification(null);
                    }}
                  >
                    <Text style={styles.acceptNotificationText}>Accept</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

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

      {/* Trip Summary Modal - Premium Design */}
      <Modal
        visible={showTripSummary}
        transparent={true}
        animationType="fade"
        onRequestClose={handleTripSummaryClose}
      >
        <View style={styles.tripSummaryOverlay}>
          <View style={styles.tripSummaryContainer}>
            {/* Premium Header with Gradient */}
            <LinearGradient
              colors={tripSummaryData?.tripStatus === "completed"
                ? ["#10B981", "#059669", "#047857"]
                : ["#F59E0B", "#D97706", "#B45309"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.tripSummaryHeader}
            >
              <View style={styles.tripSummaryHeaderDecor} />
              <View style={styles.tripSummaryIconWrapper}>
                <Ionicons
                  name={tripSummaryData?.tripStatus === "completed" ? "checkmark-circle" : "close-circle"}
                  size={40}
                  color="#fff"
                />
              </View>
              <Text style={styles.tripSummaryTitle}>
                {tripSummaryData?.tripStatus === "completed" ? "Trip Completed!" : "Trip Cancelled"}
              </Text>
              <Text style={styles.tripSummarySubtitle}>
                {tripSummaryData?.tripStatus === "completed"
                  ? "Great job! Here's your trip summary"
                  : "Trip was ended before starting"}
              </Text>
            </LinearGradient>

            {/* Content */}
            <View style={styles.tripSummaryContent}>
              {/* Route Name - Featured */}
              <View style={styles.tripSummaryRouteCard}>
                <Ionicons name="map" size={20} color="#0891B2" />
                <View style={styles.tripSummaryRouteInfo}>
                  <Text style={styles.tripSummaryRouteLabel}>Route</Text>
                  <Text style={styles.tripSummaryRouteName}>{tripSummaryData?.routeName}</Text>
                </View>
              </View>

              {/* Date */}
              <View style={styles.tripSummaryRow}>
                <View style={styles.tripSummaryRowLeft}>
                  <Ionicons name="calendar-outline" size={18} color="#6B7280" />
                  <Text style={styles.tripSummaryLabel}>Date</Text>
                </View>
                <Text style={styles.tripSummaryValue}>{tripSummaryData?.startDate}</Text>
              </View>

              {/* Time Row */}
              <View style={styles.tripSummaryTimeRow}>
                <View style={styles.tripSummaryTimeItem}>
                  <View style={styles.tripSummaryTimeIcon}>
                    <Ionicons name="play-circle" size={18} color="#10B981" />
                  </View>
                  <Text style={styles.tripSummaryTimeLabel}>Start</Text>
                  <Text style={styles.tripSummaryTimeValue}>{tripSummaryData?.departureTime}</Text>
                </View>
                <View style={styles.tripSummaryTimeDivider}>
                  <View style={styles.tripSummaryTimeLine} />
                  <Ionicons name="arrow-forward" size={16} color="#D1D5DB" />
                  <View style={styles.tripSummaryTimeLine} />
                </View>
                <View style={styles.tripSummaryTimeItem}>
                  <View style={styles.tripSummaryTimeIcon}>
                    <Ionicons name="stop-circle" size={18} color="#EF4444" />
                  </View>
                  <Text style={styles.tripSummaryTimeLabel}>End</Text>
                  <Text style={styles.tripSummaryTimeValue}>{tripSummaryData?.endTime}</Text>
                </View>
              </View>

              {/* Stats Row */}
              <View style={styles.tripSummaryStatsRow}>
                <View style={styles.tripSummaryStatItem}>
                  <LinearGradient
                    colors={["#8B5CF6", "#7C3AED"]}
                    style={styles.tripSummaryStatIcon}
                  >
                    <Ionicons name="time" size={18} color="#fff" />
                  </LinearGradient>
                  <Text style={styles.tripSummaryStatLabel}>Duration</Text>
                  <Text style={styles.tripSummaryStatValue}>{tripSummaryData?.duration}</Text>
                </View>
                <View style={styles.tripSummaryStatItem}>
                  <LinearGradient
                    colors={["#0891B2", "#06B6D4"]}
                    style={styles.tripSummaryStatIcon}
                  >
                    <Ionicons name="people" size={18} color="#fff" />
                  </LinearGradient>
                  <Text style={styles.tripSummaryStatLabel}>Passengers</Text>
                  <Text style={styles.tripSummaryStatValue}>
                    {tripSummaryData?.passengerCount}/{tripSummaryData?.capacity}
                  </Text>
                </View>
              </View>
            </View>

            {/* Footer Button */}
            <TouchableOpacity
              style={styles.tripSummaryCloseButtonWrapper}
              onPress={handleTripSummaryClose}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={["#0891B2", "#06B6D4", "#22D3EE"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.tripSummaryCloseButton}
              >
                <Ionicons name="home" size={20} color="#fff" />
                <Text style={styles.tripSummaryCloseButtonText}>Back to Dashboard</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  map: { flex: 1 },

  // Premium Top Bar Styles
  topBar: {
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    elevation: 8,
    shadowColor: "#06B6D4",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    overflow: "hidden",
    position: "relative",
  },
  topBarCollapsed: {
    paddingBottom: 12,
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
    bottom: -30,
    left: 30,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  routeHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  routeIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  routeTitleContainer: {
    flex: 1,
  },
  routeName: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.3,
  },
  routeSubtitle: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.7)",
    marginTop: 2,
  },
  headerToggle: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    justifyContent: "center",
    alignItems: "center",
  },

  // Quick Info Bar (when collapsed)
  quickInfoBar: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    marginTop: 12,
    gap: 16,
  },
  quickInfoItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  quickInfoIconBg: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 6,
  },
  quickInfoText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },

  // Status Card Styles - Premium
  statusCard: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 20,
    padding: 20,
    marginTop: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 20,
  },
  statusItem: {
    alignItems: "center",
    flex: 1,
  },
  statusDivider: {
    width: 1,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    marginVertical: 8,
  },
  statusIconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: "rgba(34, 211, 238, 0.15)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  statusLabel: {
    fontSize: 10,
    color: "rgba(255, 255, 255, 0.6)",
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  statusValue: {
    fontSize: 15,
    color: "#fff",
    fontWeight: "700",
    marginTop: 4,
  },
  statusSubtext: {
    fontSize: 10,
    color: "rgba(255, 255, 255, 0.5)",
    marginTop: 2,
  },
  progressContainer: {
    marginBottom: 16,
  },
  progressBar: {
    height: 8,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 4,
  },
  progressText: {
    fontSize: 11,
    color: "rgba(255, 255, 255, 0.7)",
    textAlign: "right",
    marginTop: 6,
    fontWeight: "500",
  },
  departureSection: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  departureText: {
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.9)",
    marginLeft: 10,
    fontWeight: "500",
    flex: 1,
  },

  warningPanel: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 12,
  },
  warningText: {
    color: "#fff",
    marginLeft: 10,
    fontWeight: "600",
    fontSize: 13,
  },

  // Enhanced Action Button Styles
  actionContainer: {
    backgroundColor: "#ffffffff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingBottom: 24,
    paddingHorizontal: 20,
    elevation: 10,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 16,
  },
  primaryActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
    gap: 12,
  },
  primaryButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 18,
    paddingHorizontal: 12,
    borderRadius: 18,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  scanButton: {
    backgroundColor: "#0891B2",
  },
  startButton: {
    backgroundColor: "#10B981",
  },
  buttonIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
  },
  buttonSubtext: {
    color: "rgba(255, 255, 255, 0.7)",
    fontSize: 11,
    textAlign: "center",
    marginTop: 4,
  },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#EF4444",
    backgroundColor: "rgba(239, 68, 68, 0.1)",
  },
  secondaryButtonText: {
    color: "#EF4444",
    fontSize: 15,
    fontWeight: "600",
    marginLeft: 8,
  },
  disabledButton: {
    borderColor: "#475569",
    backgroundColor: "rgba(71, 85, 105, 0.1)",
    opacity: 0.6,
  },
  disabledText: {
    color: "#64748B",
  },

  // Improved QR Scanner Modal Styles
  qrScannerContainer: {
    flex: 1,
    backgroundColor: "black",
  },
  qrHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: "rgba(0,0,0,0.7)",
    zIndex: 10,
  },
  qrBackButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  qrHeaderTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  qrHeaderSpacer: {
    width: 40,
  },
  qrOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "space-between",
    paddingTop: 120,
    paddingBottom: 50,
    paddingHorizontal: 20,
  },
  qrMiddleSection: {
    flex: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  qrScanningFrame: {
    width: 250,
    height: 250,
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
  },
  qrCorner: {
    position: "absolute",
    width: 30,
    height: 30,
    borderColor: "#007AFF",
    borderWidth: 4,
  },
  qrTopLeft: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  qrTopRight: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
  },
  qrBottomLeft: {
    bottom: 0,
    left: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
  },
  qrBottomRight: {
    bottom: 0,
    right: 0,
    borderLeftWidth: 0,
    borderTopWidth: 0,
  },
  qrScanningLine: {
    position: "absolute",
    width: 200,
    height: 2,
    backgroundColor: "#007AFF",
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 5,
  },
  qrBottomSection: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  qrStatusContainer: {
    alignItems: "center",
    marginBottom: 30,
  },
  qrSuccessContainer: {
    alignItems: "center",
    backgroundColor: "rgba(76,175,80,0.1)",
    paddingHorizontal: 30,
    paddingVertical: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(76,175,80,0.3)",
  },
  qrSuccessText: {
    color: "#4CAF50",
    fontSize: 18,
    fontWeight: "bold",
    marginTop: 12,
    marginBottom: 4,
  },
  qrSuccessSubtext: {
    color: "#e0e0e0",
    fontSize: 14,
    textAlign: "center",
  },
  qrWaitingContainer: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 30,
    paddingVertical: 20,
    borderRadius: 16,
  },
  qrWaitingText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    marginTop: 12,
    marginBottom: 4,
  },
  qrWaitingSubtext: {
    color: "#e0e0e0",
    fontSize: 14,
    textAlign: "center",
  },
  qrCancelButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  qrCancelButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "500",
    marginLeft: 8,
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
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
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
    color: "#1a1a1a",
    flex: 1,
  },
  alertMessage: {
    fontSize: 16,
    color: "#666",
    lineHeight: 22,
    marginBottom: 24,
  },
  alertButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  alertButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    minWidth: 80,
    alignItems: "center",
  },
  alertCancelButton: {
    backgroundColor: "#f2f2f7",
    borderWidth: 1,
    borderColor: "#e5e5e7",
  },
  alertCancelButtonText: {
    color: "#666",
    fontSize: 16,
    fontWeight: "600",
  },
  alertConfirmButton: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  alertConfirmButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },

  // Driver Marker Styles
  driverMarkerContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  driverMarkerIcon: {
    width: 48,
    height: 48,
  },
  driverMarkerPointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 12,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "#007AFF",
    borderStyle: "solid",
    marginTop: -2,
  },

  // Pickup Request Styles
  pickupMarkerContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  pickupMarkerLabel: {
    backgroundColor: "rgba(0, 0, 0, 0.56)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  pickupMarkerText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },

  // Route Marker Styles
  routeMarkerContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  routeMarkerIcon: {
    width: 36,
    height: 36,
    zIndex: 2,
  },
  pickupRequestsPanel: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: "#E5E5E7",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  pickupRequestsHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  pickupRequestsTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#333",
    marginLeft: 8,
  },
  pickupRequestsScroll: {
    maxHeight: 120,
  },
  pickupRequestCard: {
    backgroundColor: "#F8F9FA",
    borderRadius: 12,
    padding: 12,
    marginRight: 12,
    minWidth: 200,
    borderWidth: 1,
    borderColor: "#E5E5E7",
  },
  pickupRequestInfo: {
    marginBottom: 8,
  },
  pickupRequestName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 2,
  },
  pickupRequestPhone: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  pickupRequestNotes: {
    fontSize: 11,
    color: "#8e8e93",
    fontStyle: "italic",
  },
  pickupRequestActions: {
    flexDirection: "row",
    gap: 8,
  },
  pickupActionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  acceptButton: {
    backgroundColor: "#34C759",
  },
  declineButton: {
    backgroundColor: "#FF3B30",
  },
  acceptButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 4,
  },
  declineButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 4,
  },

  // Notification Styles
  notificationOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  notificationContainer: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  notificationHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  notificationIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#FF9500",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  notificationTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1a1a1a",
    flex: 1,
  },
  notificationMessage: {
    fontSize: 16,
    color: "#333",
    marginBottom: 8,
    lineHeight: 22,
  },
  notificationDetails: {
    fontSize: 14,
    color: "#666",
    marginBottom: 8,
  },
  notificationNotes: {
    fontSize: 14,
    color: "#8e8e93",
    fontStyle: "italic",
    marginBottom: 20,
  },
  notificationActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  notificationButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: "center",
  },
  declineNotificationButton: {
    backgroundColor: "#f2f2f7",
    borderWidth: 1,
    borderColor: "#e5e5e7",
  },
  acceptNotificationButton: {
    backgroundColor: "#34C759",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  declineNotificationText: {
    color: "#666",
    fontSize: 16,
    fontWeight: "600",
  },
  acceptNotificationText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },

  // Trip Summary Modal Styles - Premium Design
  tripSummaryOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  tripSummaryContainer: {
    backgroundColor: "#fff",
    borderRadius: 24,
    width: "100%",
    maxWidth: 380,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 16,
    overflow: "hidden",
  },
  tripSummaryHeader: {
    paddingTop: 32,
    paddingBottom: 24,
    paddingHorizontal: 24,
    alignItems: "center",
    position: "relative",
    overflow: "hidden",
  },
  tripSummaryHeaderDecor: {
    position: "absolute",
    top: -50,
    right: -50,
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  tripSummaryIconWrapper: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  tripSummaryTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#fff",
    textAlign: "center",
    letterSpacing: -0.3,
  },
  tripSummarySubtitle: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.85)",
    textAlign: "center",
    marginTop: 6,
  },
  tripSummaryContent: {
    padding: 20,
  },
  tripSummaryRouteCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F0FDFA",
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#CCFBF1",
  },
  tripSummaryRouteInfo: {
    marginLeft: 14,
    flex: 1,
  },
  tripSummaryRouteLabel: {
    fontSize: 11,
    color: "#6B7280",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tripSummaryRouteName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
    marginTop: 2,
  },
  tripSummaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  tripSummaryRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  tripSummaryLabel: {
    fontSize: 14,
    color: "#6B7280",
    fontWeight: "500",
  },
  tripSummaryValue: {
    fontSize: 14,
    color: "#1F2937",
    fontWeight: "600",
  },
  tripSummaryTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  tripSummaryTimeItem: {
    alignItems: "center",
    flex: 1,
  },
  tripSummaryTimeIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "#F9FAFB",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  tripSummaryTimeLabel: {
    fontSize: 11,
    color: "#9CA3AF",
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tripSummaryTimeValue: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1F2937",
    marginTop: 2,
  },
  tripSummaryTimeDivider: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 10,
  },
  tripSummaryTimeLine: {
    width: 16,
    height: 1,
    backgroundColor: "#E5E7EB",
  },
  tripSummaryStatsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: 20,
    gap: 16,
  },
  tripSummaryStatItem: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "#F9FAFB",
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 12,
  },
  tripSummaryStatIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
  tripSummaryStatLabel: {
    fontSize: 11,
    color: "#9CA3AF",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tripSummaryStatValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1F2937",
    marginTop: 4,
  },
  tripSummaryCloseButtonWrapper: {
    margin: 20,
    marginTop: 0,
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: "#06B6D4",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  tripSummaryCloseButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    gap: 10,
  },
  tripSummaryCloseButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
});

export default DrivingModeScreen;
