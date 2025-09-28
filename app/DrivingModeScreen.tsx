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
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Marker, Polyline, Region } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";

type LatLng = { latitude: number; longitude: number };

const LOCATION_UPDATE_INTERVAL = 2000; // ms

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

  // NEW: Collapsible header state
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);

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
    onConfirm: () => {},
    confirmText: "OK",
    showCancel: false,
    onCancel: () => {},
    cancelText: "Cancel",
  });

  // Custom Alert Function
  const showAlert = (
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

    async function startLocationUpdates() {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      locationSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: LOCATION_UPDATE_INTERVAL,
          distanceInterval: 5,
        },
        (location) => {
          const coords = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          };
          setDriverLocation(coords);

          // Animate camera to follow driver with 3D effect
          mapRef.current?.animateCamera(
            {
              center: coords,
              pitch: 80, // Increase pitch for 3D
              zoom: 17, // Higher zoom for closer view
              heading: location.coords.heading || 0, // Use device heading if available
            },
            { duration: 800 }
          );
        }
      );
    }

    startLocationUpdates();

    return () => {
      locationSubscription?.remove();
    };
  }, []);

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

  // Initialize scanned passengers from database
  useEffect(() => {
    const initializeScannedPassengers = async () => {
      if (!busId || !tripId) return;

      try {
        const { data: boardedPassengers, error } = await supabase
          .from("trip_passengers")
          .select("passenger_id")
          .eq("bus_id", busId)
          .eq("trip_id", tripId)
          .eq("status", "boarded");

        if (error) {
          console.error("Error fetching boarded passengers:", error);
          return;
        }

        if (boardedPassengers && boardedPassengers.length > 0) {
          const passengerIds = new Set(
            boardedPassengers.map((p) => p.passenger_id)
          );
          setScannedPassengers(passengerIds);
        }
      } catch (error) {
        console.error("Error initializing scanned passengers:", error);
      }
    };

    initializeScannedPassengers();
  }, [busId, tripId]);

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

  // NEW: Recalculate departure time when passenger count or opposite buses change
  useEffect(() => {
    calculateDynamicDepartureTime();
  }, [passengerCount, oppositeRouteBuses, parsedCapacity]);

  // NEW: Initialize trip status from database
  useEffect(() => {
    const fetchTripStatus = async () => {
      if (!tripId) return;

      try {
        const { data: tripData, error } = await supabase
          .from("trips")
          .select("status")
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
        }
      } catch (error) {
        console.error("Error in fetchTripStatus:", error);
      }
    };

    fetchTripStatus();
  }, [tripId]);

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
          const { data: newTrip, error: createError } = await supabase
            .from("trips")
            .insert({
              bus_id: busId,
              status: "waiting",
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
        const { data: existingRecord, error: checkError } = await supabase
          .from("trip_passengers")
          .select("id, status")
          .eq("bus_id", busId)
          .eq("passenger_id", payload.commuterId)
          .eq("trip_id", tripId)
          .maybeSingle();

        if (!existingRecord || checkError) {
          console.error("No trip_passengers record found for this passenger:", {
            busId,
            passengerId: payload.commuterId,
            tripId,
            error: checkError,
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

        // Check current trip status and update to 'ongoing' if 'waiting'
        const { data: currentTrip, error: fetchError } = await supabase
          .from("trips")
          .select("status")
          .eq("id", tripId)
          .single();

        if (fetchError) {
          console.error("Error fetching trip status:", fetchError);
          showAlert(
            "Status Check Failed",
            "Unable to verify trip status. The passenger has been boarded but trip status could not be updated.",
            "warning"
          );
          return;
        }

        if (currentTrip.status === "waiting") {
          const { error: updateError } = await supabase
            .from("trips")
            .update({ status: "ongoing" })
            .eq("id", tripId)
            .eq("bus_id", busId);

          if (updateError) {
            console.error(
              "Error updating trip status to ongoing:",
              updateError
            );
            showAlert(
              "Status Update Failed",
              "Unable to update trip status to ongoing. The passenger has been boarded successfully.",
              "warning"
            );
          }
        }

        // Add passenger to scanned passengers set
        setScannedPassengers((prev) => new Set(prev).add(payload.commuterId));

        // Increment passenger count and show success
        setPassengerCount((p) => Math.min(p + 1, parsedCapacity));

        // Update bus passenger count in database
        const { error: busUpdateError } = await supabase
          .from("buses")
          .update({ passengers: Math.min(passengerCount + 1, parsedCapacity) })
          .eq("id", busId);

        if (busUpdateError) {
          console.error("Error updating bus passenger count:", busUpdateError);
        }

        showAlert(
          "Passenger Boarded Successfully! 🎉",
          `Commuter ${
            payload.commuterId
          } has been added to your trip. Current passengers: ${Math.min(
            passengerCount + 1,
            parsedCapacity
          )}/${parsedCapacity}`,
          "success"
        );
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
          const { error: tripError } = await supabase
            .from("trips")
            .update({
              status: "ongoing",
              started_at: new Date().toISOString(),
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
      () => {},
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
          const { error: passengersError } = await supabase
            .from("trip_passengers")
            .update({ status: passengerStatus })
            .eq("trip_id", tripId)
            .eq("bus_id", busId);

          if (passengersError) {
            console.error("Error updating passengers:", passengersError);
            showAlert(
              "Passenger Update Failed",
              `Unable to ${
                isTripOfficiallyStarted ? "complete" : "cancel"
              } passenger bookings. Please try again or contact support.`,
              "error"
            );
            setEndingTrip(false);
            return;
          }

          console.log(
            `Successfully ${
              isTripOfficiallyStarted ? "completed" : "cancelled"
            } all passenger bookings`
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

          showAlert(
            isTripOfficiallyStarted
              ? "Trip Completed! ✅"
              : "Trip Cancelled! ⚠️",
            isTripOfficiallyStarted
              ? "Trip completed successfully! All passengers have reached their destinations. Great job!"
              : "Trip cancelled successfully! All passengers have been notified and can book again.",
            "success"
          );
          router.replace("/(driver)");
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
      () => {},
      "Cancel"
    );
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

  const initialRegion: Region = {
    ...driverLocation,
    latitudeDelta: 0.005, // smaller value = more zoom
    longitudeDelta: 0.005,
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#f2f2f7" }}>
      {/* Collapsible Top Header */}
      <TouchableOpacity
        onPress={() => setIsHeaderCollapsed(!isHeaderCollapsed)}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={["#007AFF", "#00c6ff"]}
          start={[0, 0]}
          end={[1, 1]}
          style={[styles.topBar, isHeaderCollapsed && styles.topBarCollapsed]}
        >
          {/* Route Title - Always Visible */}
          <View style={styles.routeHeader}>
            <Ionicons name="bus" size={24} color="#fff" />
            <Text style={styles.routeName}>{routeName}</Text>
            <View style={styles.headerToggle}>
              <Ionicons
                name={isHeaderCollapsed ? "chevron-down" : "chevron-up"}
                size={20}
                color="#fff"
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
                    <Ionicons
                      name={
                        tripStatus === "waiting"
                          ? "time"
                          : tripStatus === "ongoing"
                          ? "play-circle"
                          : "checkmark-circle"
                      }
                      size={20}
                      color="#fff"
                    />
                    <Text style={styles.statusLabel}>Status</Text>
                    <Text style={styles.statusValue}>
                      {tripStatus === "waiting"
                        ? "Waiting to Start"
                        : tripStatus === "ongoing"
                        ? "Trip in Progress"
                        : tripStatus === "completed"
                        ? "Completed"
                        : "Cancelled"}
                    </Text>
                  </View>

                  <View style={styles.statusItem}>
                    <Ionicons name="people" size={20} color="#fff" />
                    <Text style={styles.statusLabel}>Passengers</Text>
                    <Text style={styles.statusValue}>
                      {passengerCount}/{parsedCapacity}
                    </Text>
                    <Text style={styles.statusSubtext}>
                      {scannedPassengers.size} scanned
                    </Text>
                  </View>
                </View>

                {/* Departure Time */}
                <View style={styles.departureSection}>
                  <Ionicons name="time-outline" size={18} color="#fff" />
                  <Text style={styles.departureText}>
                    {dynamicDepartureTime}
                  </Text>
                </View>

                {/* Progress Bar */}
                <View style={styles.progressContainer}>
                  <View style={styles.progressBar}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${(passengerCount / parsedCapacity) * 100}%`,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.progressText}>
                    {Math.round((passengerCount / parsedCapacity) * 100)}% Full
                  </Text>
                </View>
              </View>

              {/* Warning Panel */}
              {offRouteWarning && (
                <View style={styles.warningPanel}>
                  <Ionicons name="warning" size={20} color="#fff" />
                  <Text style={styles.warningText}>You are off the route!</Text>
                </View>
              )}
            </>
          )}

          {/* Quick Info Bar - Always Visible When Collapsed */}
          {isHeaderCollapsed && (
            <View style={styles.quickInfoBar}>
              <View style={styles.quickInfoItem}>
                <Ionicons name="people" size={16} color="#fff" />
                <Text style={styles.quickInfoText}>
                  {passengerCount}/{parsedCapacity} ({scannedPassengers.size})
                </Text>
              </View>
              <View style={styles.quickInfoItem}>
                <Ionicons
                  name={
                    tripStatus === "waiting"
                      ? "time"
                      : tripStatus === "ongoing"
                      ? "play-circle"
                      : "checkmark-circle"
                  }
                  size={16}
                  color="#fff"
                />
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
                  <Ionicons name="warning" size={16} color="#ff4d4f" />
                  <Text style={[styles.quickInfoText, { color: "#ff4d4f" }]}>
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
          ref={mapRef}
          style={styles.map}
          initialRegion={initialRegion}
          showsUserLocation
          showsMyLocationButton
          showsBuildings={true}
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
              <Ionicons name="bus" size={32} color="#007AFF" />
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
              title={`Pickup Request - ${request.commuter_name || "Unknown"}`}
              description={`Phone: ${request.commuter_phone || "N/A"}`}
              pinColor="#FF9500"
            >
              <View style={styles.pickupMarker}>
                <Ionicons name="person" size={20} color="#fff" />
              </View>
            </Marker>
          ))}
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
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f2f2f7",
  },
  map: { flex: 1 },

  // Enhanced Top Bar Styles
  topBar: {
    paddingTop: 20,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    elevation: 6,
    shadowColor: "#007AFF",
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  topBarCollapsed: {
    paddingBottom: 12,
  },
  routeHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  routeName: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#fff",
    marginLeft: 8,
    flex: 1,
  },
  headerToggle: {
    marginLeft: "auto",
  },

  // Quick Info Bar (when collapsed)
  quickInfoBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    marginTop: 8,
  },
  quickInfoItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  quickInfoText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 4,
  },

  // Status Card Styles
  statusCard: {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  statusItem: {
    alignItems: "center",
    flex: 1,
  },
  statusLabel: {
    fontSize: 12,
    color: "#e6f0fa",
    marginTop: 4,
    fontWeight: "500",
  },
  statusValue: {
    fontSize: 16,
    color: "#fff",
    fontWeight: "bold",
    marginTop: 2,
  },
  statusSubtext: {
    fontSize: 10,
    color: "#e6f0fa",
    marginTop: 2,
    fontWeight: "400",
  },
  departureSection: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  departureText: {
    fontSize: 16,
    color: "#fff",
    marginLeft: 8,
    fontWeight: "600",
  },
  progressContainer: {
    marginTop: 8,
  },
  progressBar: {
    height: 6,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#4CAF50",
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    color: "#e6f0fa",
    textAlign: "center",
    marginTop: 4,
    fontWeight: "500",
  },

  warningPanel: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ff4d4f",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 8,
    alignSelf: "flex-start",
  },
  warningText: {
    color: "#fff",
    marginLeft: 8,
    fontWeight: "bold",
    fontSize: 14,
  },

  // Enhanced Action Button Styles
  actionContainer: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 20,
    paddingHorizontal: 20,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  primaryActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  primaryButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 16,
    marginHorizontal: 4,
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  scanButton: {
    backgroundColor: "#007AFF",
  },
  startButton: {
    backgroundColor: "#4CAF50",
  },
  buttonIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
    textAlign: "center",
  },
  buttonSubtext: {
    color: "rgba(255, 255, 255, 0.8)",
    fontSize: 12,
    textAlign: "center",
    marginTop: 2,
  },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ff4d4f",
    backgroundColor: "transparent",
  },
  secondaryButtonText: {
    color: "#ff4d4f",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },
  disabledButton: {
    borderColor: "#8e8e93",
    opacity: 0.6,
  },
  disabledText: {
    color: "#8e8e93",
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

  // Pickup Request Styles
  pickupMarker: {
    backgroundColor: "#FF9500",
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
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
});

export default DrivingModeScreen;
