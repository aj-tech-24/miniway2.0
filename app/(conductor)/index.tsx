import { useAppTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { Camera, CameraView } from "expo-camera";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  InteractionManager,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";

interface Passenger {
  id: string;
  passenger_id: string;
  status: "waiting" | "boarded" | "completed" | "cancelled";
  boarded_at: string;
  passenger_count: number;
  accepted_at?: string;
  declined_at?: string;
  users?: {
    fullName: string;
    contact_number: string;
  };
}

interface PendingPickupRequest {
  id: string;
  commuter_id: string;
  commuter_name: string | null;
  passenger_count: number | null;
  status: string;
  created_at: string;
  pickup_lat?: number;
  pickup_lng?: number;
  dest_lat?: number;
  dest_lng?: number;
  notes?: string;
}

interface Trip {
  id: string;
  status: "waiting" | "ongoing" | "completed" | "cancelled";
  buses: {
    id: string;
    plate_number: string;
    capacity: number;
    passengers: number;
    routes: {
      id: string;
      name: string;
      start_address: string;
      end_address: string;
    };
  };
  trip_passengers: Passenger[];
}

// Helper function for accurate distance calculation
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // Radius of the Earth in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Format distance for display
const formatDistance = (distance: number): string => {
  if (distance < 1) {
    return `${Math.round(distance * 1000)}m`;
  }
  return `${distance.toFixed(1)} km`;
};

// Enhanced distance and time calculations
const calculateEstimatedTime = (distance: number): string => {
  // Average city speed: 25 km/h (considering traffic, stops, etc.)
  const averageSpeed = 25;
  const timeInHours = distance / averageSpeed;
  const timeInMinutes = Math.round(timeInHours * 60);

  if (timeInMinutes < 60) {
    return `${timeInMinutes} min`;
  } else {
    const hours = Math.floor(timeInMinutes / 60);
    const remainingMinutes = timeInMinutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
};

// Route efficiency helper
const getRouteEfficiencyColor = (distance: number): string => {
  if (distance <= 2) return "#34C759"; // Green - Very efficient
  if (distance <= 5) return "#007AFF"; // Blue - Good
  if (distance <= 10) return "#FF9500"; // Orange - Moderate  
  return "#FF3B30"; // Red - Long distance
};

export function ConductorScreen() {
  const { theme } = useAppTheme();
  const [loading, setLoading] = useState(true);
  const [currentTrip, setCurrentTrip] = useState<Trip | null>(null);
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [passengerCount, setPassengerCount] = useState(0);
  const [_pendingPickups, setPendingPickups] = useState<PendingPickupRequest[]>([]);
  const [busLocation, setBusLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showGuestModal, setShowGuestModal] = useState(false);
  const [guestCount, setGuestCount] = useState(1);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const [scannedPassengers, setScannedPassengers] = useState<Set<string>>(
    new Set()
  );

  // Drop-off modal state for partial group drop-offs
  const [showDropOffModal, setShowDropOffModal] = useState(false);
  const [dropOffCount, setDropOffCount] = useState(1);
  const [selectedPassengerForDropOff, setSelectedPassengerForDropOff] = useState<Passenger | null>(null);

  // Single guest passenger entry - Use a fixed UUID format for guest passengers
  // This is a reserved UUID that won't conflict with real user IDs
  const GUEST_PASSENGER_ID = "00000000-0000-0000-0000-000000000000";
  const [guestPassengerCount, setGuestPassengerCount] = useState(0);

  const currentTripRef = useRef<Trip | null>(null);

  // Store the assigned bus information even when there's no active trip
  const [assignedBus, setAssignedBus] = useState<{
    id: string;
    plate_number: string;
    capacity: number;
    passengers: number;
    routes: {
      id: string;
      name: string;
      start_address: string;
      end_address: string;
    } | null;
  } | null>(null);

  const [mapRegion, setMapRegion] = useState({
    latitude: 14.5995,
    longitude: 120.9842,
    latitudeDelta: 0.015,
    longitudeDelta: 0.015,
  });

  const scanLineAnimation = useRef(new Animated.Value(0)).current;

  // Notification state
  const [showNotification, setShowNotification] = useState(false);
  const [notificationData, setNotificationData] = useState<{
    name: string;
    count: number;
  } | null>(null);
  const notificationAnimation = useRef(new Animated.Value(0)).current;

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

  // Enhanced animations for better UX
  const cardAnimation = useRef(new Animated.Value(0)).current;
  const pulseAnimation = useRef(new Animated.Value(1)).current;

  // Animate cards on mount
  useEffect(() => {
    Animated.timing(cardAnimation, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    }).start();
  }, []);
  // Pulse animation for waiting passengers
  useEffect(() => {
    const waitingCount = passengers.filter((p) => p.status === "waiting").length;
    let animationRef: Animated.CompositeAnimation | null = null;

    if (waitingCount > 0) {
      const pulse = Animated.sequence([
        Animated.timing(pulseAnimation, {
          toValue: 1.1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnimation, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]);
      animationRef = Animated.loop(pulse);
      animationRef.start();
    } else {
      pulseAnimation.setValue(1);
    }

    return () => {
      if (animationRef) {
        animationRef.stop();
      }
      pulseAnimation.stopAnimation();
    };
  }, [passengers, pulseAnimation]);

  // Fetch current trip and passengers
  const fetchCurrentTrip = useCallback(async () => {
    try {
      setLoading(true);

      // Get current user
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        showAlert("Authentication Error", "Please log in again", "error");
        return;
      }

      console.log("👤 Current User ID:", user.id);

      // Find current trip for this conductor (assuming conductor is assigned to a bus)
      // Use limit(1) instead of single() to handle case where conductor is assigned to multiple buses
      const { data: busResults, error: busError } = await supabase
        .from("buses")
        .select(
          `
          id,
          plate_number,
          capacity,
          passengers,
          conductor_id,
          routes(
            id,
            name,
            start_address,
            end_address
          )
        `
        )
        .eq("conductor_id", user.id)
        .limit(1);

      const busData = busResults && busResults.length > 0 ? busResults[0] : null;

      console.log("🚌 Bus Query Result:", { busData, busError, totalBuses: busResults?.length || 0 });

      if (busError || !busData) {
        console.error("❌ Bus Error:", busError);
        showAlert(
          "No Bus Assignment",
          "You haven't been assigned to a bus yet. Please contact your administrator.",
          "warning"
        );
        return;
      }

      // Find active trip for this bus
      // Use maybeSingle() instead of single() to avoid throwing error on 0 results
      console.log("🔍 Searching for trips with bus_id:", busData.id);

      const { data: tripData, error: tripError } = await supabase
        .from("trips")
        .select(
          `
          id,
          status,
          bus_id,
          driver_id,
          buses(
            id,
            plate_number,
            capacity,
            passengers,
            routes(
              id,
              name,
              start_address,
              end_address
            )
          ),
          trip_passengers(
            id,
            passenger_id,
            status,
            boarded_at,
            passenger_count,
            users(
              fullName,
              contact_number
            )
          )
        `
        )
        .eq("bus_id", busData.id)
        .in("status", ["waiting", "ongoing", "Waiting", "Ongoing"])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      console.log("📋 Trip Query Result:", { tripData, tripError });

      if (tripError) {
        console.error("❌ Critical Trip Query Error:", tripError.message, tripError.details, tripError.hint);
      }

      if (!tripData) {
        console.log("⚠️ No active trip found in DB for Bus ID:", busData.id);

        // Let's also check if ANY trips exist for this bus (regardless of status)
        const { data: allTrips, error: allTripsError } = await supabase
          .from("trips")
          .select("id, status, bus_id, driver_id, updated_at")
          .eq("bus_id", busData.id)
          .order("updated_at", { ascending: false })
          .limit(5);

        console.log("📊 All trips for this bus:", allTrips);
        if (allTripsError) {
          console.error("❌ Error fetching all trips:", allTripsError);
        }

        // Save the assigned bus information
        const busRoutes = Array.isArray(busData.routes) ? busData.routes[0] : busData.routes;
        setAssignedBus({
          id: busData.id,
          plate_number: busData.plate_number,
          capacity: busData.capacity,
          passengers: busData.passengers,
          routes: busRoutes || null,
        });

        setCurrentTrip(null);
        setPassengers([]);
        setPassengerCount(0);
        return;
      }

      // Transform the data to match our interface
      const busInfo = Array.isArray(tripData.buses)
        ? tripData.buses[0]
        : tripData.buses;

      const busRoutes = Array.isArray(busInfo.routes)
        ? busInfo.routes[0]
        : busInfo.routes;

      // Also update the assigned bus info
      setAssignedBus({
        id: busInfo.id,
        plate_number: busInfo.plate_number,
        capacity: busInfo.capacity,
        passengers: busInfo.passengers,
        routes: busRoutes || null,
      });

      const transformedTrip: Trip = {
        id: tripData.id,
        status: tripData.status,
        buses: {
          ...busInfo,
          routes: busRoutes,
        },
        trip_passengers: (tripData.trip_passengers || []).map((p: any) => ({
          id: p.id,
          passenger_id: p.passenger_id,
          status: p.status,
          boarded_at: p.boarded_at,
          passenger_count: p.passenger_count,
          users: Array.isArray(p.users) ? p.users[0] : p.users,
        })),      };      // Calculate data before state updates to batch them
      const boardedPassengers = transformedTrip.trip_passengers.filter(
        (p: Passenger) => p.status === "boarded"
      );
      
      // Find the guest passenger record from the database (if exists)
      const guestPassengerFromDB = transformedTrip.trip_passengers.find(
        (p: Passenger) => p.passenger_id === GUEST_PASSENGER_ID
      );
      
      // Calculate registered passengers (excluding guest entry)
      const registeredBoardedCount = boardedPassengers
        .filter((p: Passenger) => p.passenger_id !== GUEST_PASSENGER_ID)
        .reduce((sum: number, p: Passenger) => sum + (p.passenger_count || 1), 0);
      
      const passengerIds = new Set(
        boardedPassengers
          .filter((p: Passenger) => p.passenger_id !== GUEST_PASSENGER_ID)
          .map((p: Passenger) => p.passenger_id)
      );

      // Get guest count from the database record (not calculated)
      const guestCount = guestPassengerFromDB?.passenger_count || 0;
      const busPassengerCount = busInfo.passengers || 0;

      console.log(`📊 Passenger calculation: Bus=${busPassengerCount}, Registered=${registeredBoardedCount}, Guests=${guestCount}`);

      // Batch all state updates together to prevent multiple re-renders
      setCurrentTrip(transformedTrip);
      setPassengers(transformedTrip.trip_passengers.filter((p: Passenger) => p.status !== "cancelled"));
      setPassengerCount(busPassengerCount); // Use actual bus passenger count
      setScannedPassengers(passengerIds);
      setGuestPassengerCount(guestCount); // Restore guest count from database

      // Check for waiting passengers and show alert
      const waitingPassengers = transformedTrip.trip_passengers.filter(
        (p: Passenger) => p.status === "waiting"
      );
      if (waitingPassengers.length > 0) {
        const waitingCount = waitingPassengers.reduce(
          (sum: number, p: Passenger) => sum + (p.passenger_count || 1),
          0
        );
        console.log(`⚠️ ${waitingPassengers.length} passenger(s) waiting to board (${waitingCount} total)`);
      }
    } catch (error) {
      console.error("Error fetching current trip:", error);
      showAlert("Error", "Failed to load trip data", "error");
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  // Keep the ref in sync with the current trip state
  useEffect(() => {
    currentTripRef.current = currentTrip;
  }, [currentTrip]);

  useEffect(() => {
    fetchCurrentTrip();
  }, [fetchCurrentTrip]);
  // Set up real-time subscription for new boarded passengers
  useEffect(() => {
    if (!currentTrip?.id) return;

    const subscription = supabase
      .channel(`trip_passengers_${currentTrip.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "trip_passengers",
          filter: `trip_id=eq.${currentTrip.id}`,
        }, (payload) => {
          console.log("New passenger boarded:", payload.new);

          // Use InteractionManager to schedule updates after interactions complete
          InteractionManager.runAfterInteractions(async () => {
            // Fetch passenger details
            const { data: passengerData } = await supabase
              .from("trip_passengers")
              .select("passenger_id, passenger_count, users(fullName)")
              .eq("id", payload.new.id)
              .single();

            if (passengerData) {
              const userData = Array.isArray(passengerData.users)
                ? passengerData.users[0]
                : passengerData.users;
              const name = userData?.fullName || "Guest Passenger";
              const count = passengerData.passenger_count || 1;

              // Trigger haptic feedback
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

              // Batch state updates
              setNotificationData({ name, count });
              setShowNotification(true);

              // Animate notification
              Animated.sequence([
                Animated.timing(notificationAnimation, {
                  toValue: 1,
                  duration: 300,
                  useNativeDriver: true,
                }),
                Animated.delay(3000),
                Animated.timing(notificationAnimation, {
                  toValue: 0,
                  duration: 300,
                  useNativeDriver: true,
                }),
              ]).start(() => {
                setShowNotification(false);
              });
            }

            // Refresh data after interactions complete
            fetchCurrentTrip();
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "trip_passengers",
          filter: `trip_id=eq.${currentTrip.id}`,
        }, (payload) => {
          console.log("Passenger updated:", payload.new);

          // Use InteractionManager to schedule updates after interactions complete
          InteractionManager.runAfterInteractions(async () => {
            // Check if status changed to boarded
            if (
              payload.new.status === "boarded" &&
              payload.old?.status !== "boarded"
            ) {
              // Fetch passenger details
              const { data: passengerData } = await supabase
                .from("trip_passengers")
                .select("passenger_id, passenger_count, users(fullName)")
                .eq("id", payload.new.id)
                .single();

              if (passengerData) {
                const userData = Array.isArray(passengerData.users)
                  ? passengerData.users[0]
                  : passengerData.users;
                const name = userData?.fullName || "Guest Passenger";
                const count = passengerData.passenger_count || 1;

                // Trigger haptic feedback
                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Success
                );

                // Batch state updates
                setNotificationData({ name, count });
                setShowNotification(true);

                // Animate notification
                Animated.sequence([
                  Animated.timing(notificationAnimation, {
                    toValue: 1,
                    duration: 300,
                    useNativeDriver: true,
                  }),
                  Animated.delay(3000),
                  Animated.timing(notificationAnimation, {
                    toValue: 0,
                    duration: 300,
                    useNativeDriver: true,
                  }),
                ]).start(() => {
                  setShowNotification(false);
                });
              }
            }

            // Refresh data after interactions complete
            fetchCurrentTrip();
          });
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [currentTrip?.id, fetchCurrentTrip, notificationAnimation]);
  // Add debugging logs to the `pickup_requests` subscription.
  useEffect(() => {
    const busId = currentTrip?.buses?.id || assignedBus?.id;
    if (!busId) {
      console.log("No bus ID available for subscription.");
      return;
    }

    const pickupSubscription = supabase
      .channel(`pickup_requests_${busId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "pickup_requests",
          filter: `bus_id=eq.${busId}`,
        }, (payload) => {
          console.log("New pickup request received:", payload.new);

          // Immediate haptic feedback for new pickup request
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

          // Add the new pickup request to the state immediately
          const newPickup = {
            id: payload.new.id,
            commuter_id: payload.new.commuter_id,
            commuter_name: payload.new.commuter_name,
            passenger_count: payload.new.passenger_count,
            status: payload.new.status,
            created_at: payload.new.created_at,
            pickup_lat: payload.new.pickup_lat,
            pickup_lng: payload.new.pickup_lng,
            dest_lat: payload.new.dest_lat,
            dest_lng: payload.new.dest_lng,
            notes: payload.new.notes,
          };

          setPendingPickups((prev) => {
            const updatedPickups = [...prev, newPickup];
            console.log("Updated _pendingPickups state:", updatedPickups);
            return updatedPickups;
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "pickup_requests",
          filter: `bus_id=eq.${busId}`,
        }, (payload) => {
          console.log("Pickup request updated:", payload.new);

          // If status changed to accepted or declined, remove from pending list
          if (payload.new.status === "accepted" || payload.new.status === "declined") {
            setPendingPickups((prev) => prev.filter((p) => p.id !== payload.new.id));
          } else {
            // Update the pickup request in state
            setPendingPickups((prev) =>
              prev.map((p) => (p.id === payload.new.id ? { ...p, ...payload.new } : p))
            );
          }
        }
      )
      .subscribe();

    console.log("Subscribed to pickup_requests for bus ID:", busId);

    return () => {
      console.log("Unsubscribing from pickup_requests for bus ID:", busId);
      pickupSubscription.unsubscribe();
    };
  }, [currentTrip?.buses?.id, assignedBus?.id]);

  // Real-time subscription to detect new trips for the assigned bus
  // This ensures the conductor is automatically notified when a driver starts a trip
  useEffect(() => {
    const busId = assignedBus?.id;
    if (!busId) {
      console.log("No assigned bus ID available for trip detection subscription.");
      return;
    }

    console.log("🚌 Setting up trip detection subscription for bus ID:", busId); const tripSubscription = supabase
      .channel(`trips_bus_${busId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "trips",
          filter: `bus_id=eq.${busId}`,
        }, (payload) => {
          console.log("🆕 New trip detected for bus:", payload.new);

          // Only refresh if there's no active trip currently
          // This prevents unnecessary refreshes when we already have a trip
          if (currentTripRef.current) {
            console.log("⏭️ Skipping refresh - already have an active trip");
            return;
          }

          // Use InteractionManager to prevent state updates during render
          InteractionManager.runAfterInteractions(() => {
            // Trigger haptic feedback to alert conductor
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

            // Show notification about new trip
            setNotificationData({ name: "Driver Started Trip", count: 0 });
            setShowNotification(true);

            // Animate notification
            Animated.sequence([
              Animated.timing(notificationAnimation, {
                toValue: 1,
                duration: 300,
                useNativeDriver: true,
              }),
              Animated.delay(3000),
              Animated.timing(notificationAnimation, {
                toValue: 0,
                duration: 300,
                useNativeDriver: true,
              }),
            ]).start(() => {
              setShowNotification(false);
            });

            // Refresh trip data to load the new trip
            fetchCurrentTrip();
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "trips",
          filter: `bus_id=eq.${busId}`,
        },
        (payload) => {
          console.log("🔄 Trip updated for bus:", payload.new);

          const newStatus = payload.new.status;
          const oldStatus = payload.old?.status;

          // Only process if status actually changed (not just location updates)
          if (newStatus === oldStatus) {
            console.log("⏭️ Skipping - no status change");
            return;
          }

          console.log(`Trip status changed: ${oldStatus} -> ${newStatus}`);          // Only refresh if:
          // 1. There's no active trip AND driver started a new trip (ongoing/waiting)
          // 2. OR the current trip ended (completed/cancelled) and we need to clear it
          const isNewTripStarting = !currentTripRef.current &&
            (newStatus === "ongoing" || newStatus === "waiting" ||
              newStatus === "Ongoing" || newStatus === "Waiting");

          const isCurrentTripEnding = currentTripRef.current?.id === payload.new.id &&
            (newStatus === "completed" || newStatus === "cancelled" ||
              newStatus === "Completed" || newStatus === "Cancelled");

          if (!isNewTripStarting && !isCurrentTripEnding) {
            console.log("⏭️ Skipping refresh - not relevant status change");
            return;
          }

          // Use InteractionManager to prevent state updates during render
          InteractionManager.runAfterInteractions(() => {
            if (isNewTripStarting) {
              // Trigger haptic feedback
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

              // Show notification
              setNotificationData({ name: "Driver Started Trip", count: 0 });
              setShowNotification(true);

              Animated.sequence([
                Animated.timing(notificationAnimation, {
                  toValue: 1,
                  duration: 300,
                  useNativeDriver: true,
                }),
                Animated.delay(2000),
                Animated.timing(notificationAnimation, {
                  toValue: 0,
                  duration: 300,
                  useNativeDriver: true,
                }),
              ]).start(() => {
                setShowNotification(false);
              });
            }

            // Refresh trip data
            fetchCurrentTrip();
          });
        }
      )
      .subscribe((status) => {
        console.log("🚌 Trip detection subscription status:", status);
        if (status === "SUBSCRIBED") {
          console.log("✅ Successfully subscribed to trip updates for bus:", busId);
        } else if (status === "CHANNEL_ERROR") {
          console.error("❌ Failed to subscribe to trip updates");
        }
      });

    return () => {
      console.log("🔌 Unsubscribing from trip detection for bus ID:", busId);
      tripSubscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedBus?.id]); // Only re-subscribe when bus ID changes, not on every fetchCurrentTrip change

  const handleAcceptPickup = async (pickupId: string) => {
    try {
      // Find the pickup request to get commuter details
      const pickupRequest = _pendingPickups.find((p) => p.id === pickupId);
      if (!pickupRequest) {
        showAlert("Error", "Pickup request not found.", "error");
        return;
      }

      if (!currentTrip?.id || !currentTrip?.buses?.id) {
        showAlert("Error", "No active trip or bus found.", "error");
        return;
      }

      // Validate that location data exists
      if (!pickupRequest.pickup_lat || !pickupRequest.pickup_lng ||
        !pickupRequest.dest_lat || !pickupRequest.dest_lng) {
        showAlert("Error", "Pickup request is missing location data.", "error");
        return;
      }

      // Update pickup request status to accepted
      const { error: updateError } = await supabase
        .from("pickup_requests")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("id", pickupId);

      if (updateError) throw updateError;      // Update existing trip_passengers record - keep status as "waiting" but add accepted timestamp
      const { error: updateTripPassengerError } = await supabase
        .from("trip_passengers")
        .update({
          accepted_at: new Date().toISOString(),
        })
        .eq("trip_id", currentTrip.id)
        .eq("bus_id", currentTrip.buses.id)
        .eq("passenger_id", pickupRequest.commuter_id)
        .eq("status", "waiting"); // Only update records that are still waiting

      if (updateTripPassengerError) {
        console.error("Error updating trip_passengers record:", updateTripPassengerError);
        // If no existing record found, create a new one as fallback
        const { error: insertError } = await supabase
          .from("trip_passengers")
          .insert({
            trip_id: currentTrip.id,
            bus_id: currentTrip.buses.id,
            passenger_id: pickupRequest.commuter_id,
            pickup_lat: pickupRequest.pickup_lat,
            pickup_lng: pickupRequest.pickup_lng,
            dest_lat: pickupRequest.dest_lat,
            dest_lng: pickupRequest.dest_lng,
            status: "waiting", // Keep as waiting until they actually board
            passenger_count: pickupRequest.passenger_count || 1,
            accepted_at: new Date().toISOString(),
            boarded_at: null,
          });

        if (insertError) throw insertError;
      }

      // Remove from pending list
      setPendingPickups((prev) => prev.filter((p) => p.id !== pickupId));

      // Close map modal if open
      setSelectedRequest(null);

      showAlert("Pickup Accepted", "Passenger added to waiting list.", "success");

      // Refresh trip data to show the new waiting passenger
      fetchCurrentTrip();
    } catch (error) {
      console.error("Error accepting pickup request:", error);
      showAlert("Error", "Failed to accept the pickup request. Please try again.", "error");
    }
  }; const handleDeclinePickup = async (pickupId: string) => {
    try {      // First get the pickup request details
      const pickupRequest = _pendingPickups.find((p: PendingPickupRequest) => p.id === pickupId);

      // Update pickup request status to declined
      const { error } = await supabase
        .from("pickup_requests")
        .update({ status: "declined", declined_at: new Date().toISOString() })
        .eq("id", pickupId);

      if (error) throw error;      // Also update any corresponding trip_passengers record to cancelled status
      if (pickupRequest && currentTrip) {
        const { error: tripPassengerError } = await supabase
          .from("trip_passengers")
          .update({
            status: "cancelled",
            declined_at: new Date().toISOString()
          })
          .eq("trip_id", currentTrip.id)
          .eq("bus_id", currentTrip.buses.id)
          .eq("passenger_id", pickupRequest.commuter_id)
          .eq("status", "waiting"); // Only update waiting records

        if (tripPassengerError) {
          console.error("Error updating trip_passengers on decline:", tripPassengerError);
          // Don't fail the whole operation for this
        }
      }

      // Remove from local state
      setPendingPickups((prev) => prev.filter((p) => p.id !== pickupId));

      // Close map modal if open
      setSelectedRequest(null);

      showAlert("Pickup Declined", "You have declined the pickup request.", "warning");

      // Refresh trip data to reflect changes
      fetchCurrentTrip();
    } catch (error) {
      console.error("Error declining pickup request:", error);
      showAlert("Error", "Failed to decline the pickup request. Please try again.", "error");
    }
  };

  // Request camera permissions
  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === "granted");
    })();
  }, []);

  // Location tracking for bus marker
  useEffect(() => {
    let locationSubscription: Location.LocationSubscription | null = null;

    async function startLocationUpdates() {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      locationSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000, // Update every 5 seconds
          distanceInterval: 10, // Update every 10 meters
        },
        (location) => {
          const coords = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          };
          setBusLocation(coords);
          setMapRegion(prev => ({
            ...prev,
            ...coords
          }));
        }
      );
    }

    startLocationUpdates();

    return () => {
      locationSubscription?.remove();
    };
  }, []);

  // Animation for scanning line
  useEffect(() => {
    if (showQRScanner && !scanned) {
      const startAnimation = () => {
        scanLineAnimation.setValue(0);
        Animated.timing(scanLineAnimation, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }).start(() => {
          if (showQRScanner && !scanned) {
            startAnimation();
          }
        });
      };
      startAnimation();
    } else {
      scanLineAnimation.stopAnimation();
    }
  }, [showQRScanner, scanned, scanLineAnimation]);

  // Handle QR code scan
  const handleBarCodeScanned = async ({
    type,
    data,
  }: {
    type: string;
    data: string;
  }) => {
    if (scanned) return;

    setScanned(true);

    try {
      const payload = JSON.parse(data);

      if (!payload.commuterId) {
        showAlert(
          "Invalid QR Code",
          "This QR code is not valid for passenger boarding",
          "error"
        );
        return;
      }

      // Check if passenger is already scanned
      if (scannedPassengers.has(payload.commuterId)) {
        showAlert(
          "Already Boarded",
          "This passenger has already been scanned",
          "info"
        );
        return;
      }

      // Find the passenger in current trip
      const passenger = passengers.find(
        (p) => p.passenger_id === payload.commuterId
      );

      if (!passenger) {
        showAlert(
          "Passenger Not Found",
          "This passenger is not on the current trip",
          "error"
        );
        return;
      }

      if (passenger.status === "boarded") {
        showAlert(
          "Already Boarded",
          "This passenger has already boarded",
          "info"
        );
        return;
      }

      // Update passenger status to boarded
      const { error: updateError } = await supabase
        .from("trip_passengers")
        .update({
          status: "boarded",
          boarded_at: new Date().toISOString(),
        })
        .eq("id", passenger.id);

      if (updateError) {
        throw updateError;
      }

      // Update bus passenger count
      const newPassengerCount =
        passengerCount + (passenger.passenger_count || 1);
      const { error: busError } = await supabase
        .from("buses")
        .update({ passengers: newPassengerCount })
        .eq("id", currentTrip?.buses.id);

      if (busError) {
        console.error("Error updating bus passenger count:", busError);
      }

      // Update local state
      setPassengerCount(newPassengerCount);
      setScannedPassengers((prev) => new Set(prev).add(payload.commuterId));

      // Update passengers list
      setPassengers((prev) =>
        prev.map((p) =>
          p.id === passenger.id
            ? {
              ...p,
              status: "boarded" as const,
              boarded_at: new Date().toISOString(),
            }
            : p
        )
      );

      const passengerText =
        (passenger.passenger_count || 1) > 1
          ? `${passenger.passenger_count} passengers`
          : "1 passenger";

      showAlert(
        "Passenger Boarded! ✅",
        `${passenger.users?.fullName || "Passenger"
        } has been successfully boarded. ${passengerText} added.`,
        "success"
      );
    } catch (error) {
      console.error("Error processing QR scan:", error);
      showAlert(
        "Scan Error",
        "Failed to process QR code. Please try again.",
        "error"
      );
    } finally {
      setScanned(false);
    }
  };

  // Add guest passenger - creates or updates a single guest trip_passengers record
  const addGuestPassenger = async () => {
    if (!currentTrip || guestCount < 1) {
      showAlert(
        "Invalid Input",
        "Please enter a valid number of guests",
        "error"
      );
      return;
    }

    if (passengerCount + guestCount > currentTrip.buses.capacity) {
      showAlert(
        "Bus Full",
        `Cannot add ${guestCount} guests. Bus capacity is ${currentTrip.buses.capacity} and you currently have ${passengerCount} passengers.`,
        "warning"
      );
      return;
    }

    try {
      // Update the bus passenger count in database
      const newPassengerCount = passengerCount + guestCount;
      const { error: busError } = await supabase
        .from("buses")
        .update({ passengers: newPassengerCount })
        .eq("id", currentTrip.buses.id);

      if (busError) {
        console.error("Error updating bus passenger count:", busError);
        throw busError;
      }

      console.log("Bus passenger count updated to:", newPassengerCount);

      // Check if guest passenger entry already exists for this trip
      const existingGuestPassenger = passengers.find(
        (p) => p.id === GUEST_PASSENGER_ID || p.passenger_id === GUEST_PASSENGER_ID
      );

      if (existingGuestPassenger) {
        // Update existing guest passenger record - increment the count
        const newGuestCount = (existingGuestPassenger.passenger_count || 0) + guestCount;
        
        // Update in database
        const { error: updateError } = await supabase
          .from("trip_passengers")
          .update({ 
            passenger_count: newGuestCount,
            boarded_at: new Date().toISOString() // Update timestamp
          })
          .eq("trip_id", currentTrip.id)
          .eq("passenger_id", GUEST_PASSENGER_ID);

        if (updateError) {
          console.error("Error updating guest passenger count:", updateError);
          throw updateError;
        }

        // Update local state
        setPassengers((prev) =>
          prev.map((p) =>
            p.id === GUEST_PASSENGER_ID || p.passenger_id === GUEST_PASSENGER_ID
              ? { ...p, passenger_count: newGuestCount, boarded_at: new Date().toISOString() }
              : p
          )
        );
        setGuestPassengerCount(newGuestCount);

        console.log(`Guest passenger count updated to: ${newGuestCount}`);      } else {
        // Create new guest passenger record in database
        // Use dummy coordinates (0,0) for guests since they don't have pickup/destination
        const { data: insertedGuest, error: insertError } = await supabase
          .from("trip_passengers")
          .insert({
            trip_id: currentTrip.id,
            bus_id: currentTrip.buses.id,
            passenger_id: GUEST_PASSENGER_ID, // Special ID for guest passengers
            pickup_lat: 0, // Dummy coordinate for guest passengers
            pickup_lng: 0, // Dummy coordinate for guest passengers
            dest_lat: 0, // Dummy coordinate for guest passengers
            dest_lng: 0, // Dummy coordinate for guest passengers
            status: "boarded",
            passenger_count: guestCount,
            boarded_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (insertError) {
          console.error("Error creating guest passenger record:", insertError);
          throw insertError;
        }

        console.log("Created guest passenger record:", insertedGuest);

        // Create local guest passenger entry for display
        const guestPassenger: Passenger = {
          id: insertedGuest?.id || GUEST_PASSENGER_ID,
          passenger_id: GUEST_PASSENGER_ID,
          status: "boarded",
          boarded_at: new Date().toISOString(),
          passenger_count: guestCount,
          users: undefined,
        };

        // Add guest to local passengers list
        setPassengers((prev) => [...prev, guestPassenger]);
        setGuestPassengerCount(guestCount);
      }

      setPassengerCount(newPassengerCount);

      // Haptic feedback
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const guestText = guestCount > 1 ? `${guestCount} guests` : "1 guest";
      showAlert(
        "Guests Added! ✅",
        `${guestText} added successfully.`,
        "success"
      );

      setShowGuestModal(false);
      setGuestCount(1);
    } catch (error) {
      console.error("Error adding guest passengers:", error);
      showAlert(
        "Error",
        "Failed to add guests. Please try again.",
        "error"
      );
    }
  };

  // Remove passenger - handles both registered and guest passengers
  const handleRemovePassenger = async (passenger: Passenger) => {
    if (!currentTrip) return;

    const totalCount = passenger.passenger_count || 1;

    // If group has more than 1 passenger, show modal for selecting drop-off count
    if (totalCount > 1) {
      setSelectedPassengerForDropOff(passenger);
      setDropOffCount(1); // Reset to 1
      setShowDropOffModal(true);
    } else {
      // Single passenger - drop off directly with confirmation
      confirmDropOff(passenger, 1);
    }
  };
  // Confirm and execute the drop-off
  const confirmDropOff = async (passenger: Passenger, countToDropOff: number) => {
    if (!currentTrip) return;

    const isGuest = passenger.passenger_id === GUEST_PASSENGER_ID || !passenger.passenger_id || passenger.id.startsWith("guest-");
    const passengerName = passenger.users?.fullName ||
      (isGuest ? "Guest Passenger" : `Passenger #${passenger.id.substring(0, 8)}`);
    const totalCount = passenger.passenger_count || 1;
    const remainingCount = totalCount - countToDropOff;

    // Show confirmation dialog
    showAlert(
      "Drop Off Passenger",
      `Are you sure you want to drop off ${countToDropOff} of ${totalCount} passenger${countToDropOff > 1 ? "s" : ""}?`,
      "warning",
      async () => {
        try {
          // Update bus passenger count
          const newBusPassengerCount = Math.max(0, passengerCount - countToDropOff);
          const { error: busError } = await supabase
            .from("buses")
            .update({ passengers: newBusPassengerCount })
            .eq("id", currentTrip.buses.id);

          if (busError) {
            throw busError;
          }

          setPassengerCount(newBusPassengerCount);

          if (remainingCount <= 0) {
            // Drop off all - remove or mark as completed
            if (isGuest) {
              // Guest: update database to mark as completed (since it's now stored in Supabase)
              const { error: updateError } = await supabase
                .from("trip_passengers")
                .update({ status: "completed" })
                .eq("trip_id", currentTrip.id)
                .eq("passenger_id", GUEST_PASSENGER_ID);

              if (updateError) {
                console.error("Error updating guest passenger:", updateError);
              }
              
              // Remove from local list
              setPassengers((prev) => prev.filter((p) => p.passenger_id !== GUEST_PASSENGER_ID && p.id !== passenger.id));
              setGuestPassengerCount(0);
            } else {
              // Registered: update database status
              const { error: updateError } = await supabase
                .from("trip_passengers")
                .update({ status: "completed" })
                .eq("id", passenger.id);

              if (updateError) throw updateError;

              // Update pickup_requests if exists
              await supabase
                .from("pickup_requests")
                .update({ status: "completed" })
                .eq("commuter_id", passenger.passenger_id)
                .eq("bus_id", currentTrip.buses.id)
                .in("status", ["pending", "accepted"]);

              // Remove from local list
              setPassengers((prev) => prev.filter((p) => p.id !== passenger.id));
            }          } else {
            // Partial drop-off - reduce the passenger_count
            if (isGuest) {
              // Guest: update database with reduced count
              const { error: updateError } = await supabase
                .from("trip_passengers")
                .update({ passenger_count: remainingCount })
                .eq("trip_id", currentTrip.id)
                .eq("passenger_id", GUEST_PASSENGER_ID);

              if (updateError) {
                console.error("Error updating guest passenger count:", updateError);
              }

              // Update local state
              setPassengers((prev) =>
                prev.map((p) =>
                  p.passenger_id === GUEST_PASSENGER_ID || p.id === passenger.id
                    ? { ...p, passenger_count: remainingCount }
                    : p
                )
              );
              setGuestPassengerCount(remainingCount);
            } else {
              // Registered: update database
              const { error: updateError } = await supabase
                .from("trip_passengers")
                .update({ passenger_count: remainingCount })
                .eq("id", passenger.id);

              if (updateError) throw updateError;

              // Update local state
              setPassengers((prev) =>
                prev.map((p) =>
                  p.id === passenger.id
                    ? { ...p, passenger_count: remainingCount }
                    : p
                )
              );
            }
          }

          // Haptic feedback
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

          const dropText = countToDropOff > 1 ? `${countToDropOff} passengers` : "1 passenger";
          showAlert(
            "Passenger Dropped Off ✅",
            `${dropText} from ${passengerName} dropped off successfully.${remainingCount > 0 ? ` ${remainingCount} remaining.` : ""}`,
            "success"
          );

          setShowDropOffModal(false);
          setSelectedPassengerForDropOff(null);
        } catch (error) {
          console.error("Error removing passenger:", error);
          showAlert(
            "Error",
            "Failed to drop off passenger. Please try again.",
            "error"
          );
        }
      },
      "Drop Off",
      true,
      () => { },
      "Cancel"
    );
  };
  const renderPassengerItem = ({ item }: { item: Passenger }) => {
    // Don't show passenger if status is cancelled or completed
    if (item.status === "cancelled" || item.status === "completed") return null;

    // Detect guest: check for GUEST_PASSENGER_ID or empty passenger_id
    const isGuest = item.passenger_id === GUEST_PASSENGER_ID || !item.passenger_id || item.id.startsWith("guest-");
    const passengerName = item.users?.fullName ||
      (isGuest ? `Guest Passengers` : `Passenger #${item.id.substring(0, 8)}`);

    return (
      <Animated.View
        style={[
          styles.passengerItem,
          {
            transform: [{ scale: cardAnimation }],
            opacity: cardAnimation,
          }
        ]}
      >
        <View style={styles.passengerMainInfo}>
          <View style={styles.passengerAvatar}>
            <Ionicons
              name={isGuest ? "person-add" : "person"}
              size={24}
              color={item.status === "boarded" ? "#34C759" : "#007AFF"}
            />
          </View>

          <View style={styles.passengerDetailsContainer}>
            <View style={styles.passengerHeader}>
              <Text style={styles.passengerName}>{passengerName}</Text>
              {item.passenger_count > 1 && (
                <View style={styles.groupBadge}>
                  <Ionicons name="people" size={12} color="#fff" />
                  <Text style={styles.groupCount}>{item.passenger_count}</Text>
                </View>
              )}
            </View>

            <View style={styles.passengerMeta}>
              <View style={styles.metaItem}>
                <Ionicons name="time" size={14} color="#8e8e93" />
                <Text style={styles.metaText}>
                  {item.boarded_at
                    ? new Date(item.boarded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : "Waiting"
                  }
                </Text>
              </View>
              {item.users?.contact_number && (
                <View style={styles.metaItem}>
                  <Ionicons name="call" size={14} color="#8e8e93" />
                  <Text style={styles.metaText}>{item.users.contact_number}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        <View style={styles.passengerActions}>
          {/* Drop Off Button - Only show for boarded passengers */}
          {item.status === "boarded" && (
            <TouchableOpacity
              style={styles.dropOffButton}
              onPress={() => handleRemovePassenger(item)}
              activeOpacity={0.7}
            >
              <Ionicons name="exit-outline" size={18} color="#FF3B30" />
              <Text style={styles.dropOffButtonText}>Drop</Text>
            </TouchableOpacity>
          )}

          <Animated.View
            style={[
              styles.statusIndicator,
              {
                backgroundColor: item.status === "boarded" ? "#34C759" : "#FF9500",
                transform: item.status === "waiting" ? [{ scale: pulseAnimation }] : [{ scale: 1 }],
              },
            ]}
          >
            <Ionicons
              name={item.status === "boarded" ? "checkmark" : "hourglass"}
              size={16}
              color="#fff"
            />
          </Animated.View>
        </View>
      </Animated.View>
    );
  };

  // Add a button to show pending requests and display their pickup locations.
  const [showPendingRequests, setShowPendingRequests] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<PendingPickupRequest | null>(null);

  // Enhanced Route Map state
  const pulseAnimationRef = useRef(new Animated.Value(1)).current;

  // Pulse animation for pickup marker
  useEffect(() => {
    let animationRef: Animated.CompositeAnimation | null = null;
    let isMounted = true;

    const runPulse = () => {
      if (!isMounted) return;

      animationRef = Animated.sequence([
        Animated.timing(pulseAnimationRef, {
          toValue: 1.3,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnimationRef, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]);

      animationRef.start(({ finished }) => {
        if (finished && isMounted && selectedRequest) {
          runPulse();
        }
      });
    };

    if (selectedRequest) {
      runPulse();
    } else {
      pulseAnimationRef.setValue(1);
    }

    return () => {
      isMounted = false;
      if (animationRef) {
        animationRef.stop();
      }
      pulseAnimationRef.stopAnimation();
    };
  }, [selectedRequest, pulseAnimationRef]);

  const renderPendingRequests = () => {
    return (
      <Modal
        visible={showPendingRequests}
        animationType="slide"
        onRequestClose={() => setShowPendingRequests(false)}
      >
        <View style={styles.pickupRequestsContainer}>
          {/* Premium Gradient Header */}
          <LinearGradient
            colors={["#0891B2", "#06B6D4", "#22D3EE"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.pickupRequestsHeader}
          >
            <View style={styles.pickupHeaderContent}>
              <View style={styles.pickupHeaderIconBg}>
                <Ionicons name="notifications" size={26} color="#0891B2" />
              </View>
              <View style={styles.pickupHeaderTextContainer}>
                <Text style={styles.pickupHeaderTitle}>Pickup Requests</Text>
                <Text style={styles.pickupHeaderSubtitle}>
                  {_pendingPickups.length} {_pendingPickups.length === 1 ? 'request' : 'requests'} pending
                </Text>
              </View>
              <TouchableOpacity
                style={styles.pickupHeaderClose}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowPendingRequests(false);
                }}
              >
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          </LinearGradient>

          <FlatList
            data={_pendingPickups}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.pickupRequestsList}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <View style={styles.pickupRequestCard}>
                {/* Card Header */}
                <View style={styles.pickupCardHeader}>
                  <View style={styles.pickupCommuterInfo}>
                    <View style={styles.pickupAvatarContainer}>
                      <LinearGradient
                        colors={["#0891B2", "#06B6D4"]}
                        style={styles.pickupAvatarGradient}
                      >
                        <Ionicons name="person" size={22} color="#fff" />
                      </LinearGradient>
                    </View>
                    <View style={styles.pickupCommuterDetails}>
                      <Text style={styles.pickupCommuterName}>
                        {item.commuter_name || "Unknown Commuter"}
                      </Text>
                      {item.passenger_count && item.passenger_count > 1 && (
                        <View style={styles.pickupPassengerBadge}>
                          <Ionicons name="people" size={12} color="#0891B2" />
                          <Text style={styles.pickupPassengerText}>
                            {item.passenger_count} passengers
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <View style={styles.pickupStatusBadge}>
                    <View style={styles.pickupStatusDot} />
                    <Text style={styles.pickupStatusText}>Pending</Text>
                  </View>
                </View>

                {/* Notes Section */}
                {item.notes && (
                  <View style={styles.pickupNotesContainer}>
                    <Ionicons name="chatbubble-outline" size={14} color="#64748B" />
                    <Text style={styles.pickupNotesText}>{item.notes}</Text>
                  </View>
                )}

                {/* Location Info */}
                <View style={styles.pickupLocationCard}>
                  <View style={styles.pickupLocationRow}>
                    <View style={[styles.pickupLocationIcon, { backgroundColor: "#ECFDF5" }]}>
                      <Ionicons name="radio-button-on" size={14} color="#10B981" />
                    </View>
                    <View style={styles.pickupLocationDetails}>
                      <Text style={styles.pickupLocationLabel}>Pickup Location</Text>
                      <Text style={styles.pickupLocationCoords}>
                        {item.pickup_lat?.toFixed(6)}, {item.pickup_lng?.toFixed(6)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.pickupLocationConnector}>
                    <View style={styles.pickupConnectorLine} />
                  </View>

                  <View style={styles.pickupLocationRow}>
                    <View style={[styles.pickupLocationIcon, { backgroundColor: "#FEF2F2" }]}>
                      <Ionicons name="location" size={14} color="#EF4444" />
                    </View>
                    <View style={styles.pickupLocationDetails}>
                      <Text style={styles.pickupLocationLabel}>Drop-off Location</Text>
                      <Text style={styles.pickupLocationCoords}>
                        {item.dest_lat?.toFixed(6)}, {item.dest_lng?.toFixed(6)}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* View Map Button */}
                <TouchableOpacity
                  style={styles.pickupViewMapButton}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelectedRequest(item);
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="map-outline" size={18} color="#0891B2" />
                  <Text style={styles.pickupViewMapText}>View Route on Map</Text>
                  <Ionicons name="chevron-forward" size={18} color="#0891B2" />
                </TouchableOpacity>

                {/* Action Buttons */}
                <View style={styles.pickupActionButtons}>
                  <TouchableOpacity
                    style={styles.pickupDeclineButton}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      handleDeclinePickup(item.id);
                    }}
                  >
                    <Ionicons name="close" size={20} color="#EF4444" />
                    <Text style={styles.pickupDeclineText}>Decline</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.pickupAcceptButton}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      handleAcceptPickup(item.id);
                    }}
                  >
                    <LinearGradient
                      colors={["#10B981", "#059669"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.pickupAcceptGradient}
                    >
                      <Ionicons name="checkmark-circle" size={20} color="#fff" />
                      <Text style={styles.pickupAcceptText}>Accept Request</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.pickupEmptyState}>
                <View style={styles.pickupEmptyIcon}>
                  <Ionicons name="checkmark-done-circle" size={72} color="#10B981" />
                </View>
                <Text style={styles.pickupEmptyTitle}>All Caught Up!</Text>
                <Text style={styles.pickupEmptyMessage}>
                  No pending pickup requests at the moment.
                </Text>
              </View>
            }
          />
        </View>

        {/* Enhanced Route Map Modal */}
        {selectedRequest && (
          <Modal
            visible={!!selectedRequest}
            animationType="slide"
            onRequestClose={() => setSelectedRequest(null)}
            presentationStyle="fullScreen"
          >
            <SafeAreaView style={styles.routeMapContainer}>
              {/* Enhanced Header with Gradient */}
              <View style={styles.routeMapHeader}>
                <View style={styles.routeMapHeaderContent}>
                  <TouchableOpacity
                    style={styles.routeMapCloseButton}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSelectedRequest(null);
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="chevron-back" size={28} color="#fff" />
                  </TouchableOpacity>
                  <View style={styles.routeMapTitleContainer}>
                    <Text style={styles.routeMapTitle}>Route Preview</Text>
                    <View style={styles.routeMapSubtitleContainer}>
                      <Ionicons name="person-circle" size={16} color="rgba(255, 255, 255, 0.8)" />
                      <Text style={styles.routeMapSubtitle}>
                        {selectedRequest.commuter_name || "Unknown Commuter"}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* Enhanced Info Card */}
              <View style={styles.routeInfoCard}>
                <View style={styles.routeInfoRow}>
                  <View style={styles.routeInfoItem}>
                    <View style={styles.routeInfoIconContainer}>
                      <Ionicons name="location" size={18} color="#34C759" />
                    </View>
                    <View style={styles.routeInfoTextContainer}>
                      <Text style={styles.routeInfoLabel}>Pickup Point</Text>
                      <Text style={styles.routeInfoCoords}>
                        {selectedRequest.pickup_lat?.toFixed(4)}, {selectedRequest.pickup_lng?.toFixed(4)}
                      </Text>
                    </View>
                  </View>
                  {selectedRequest.passenger_count && selectedRequest.passenger_count > 1 && (
                    <View style={styles.passengerCountChip}>
                      <Ionicons name="people" size={14} color="#007AFF" />
                      <Text style={styles.passengerCountChipText}>
                        {selectedRequest.passenger_count}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.routeInfoDivider} />

                <View style={styles.routeInfoItem}>
                  <View style={styles.routeInfoIconContainer}>
                    <Ionicons name="flag" size={18} color="#FF3B30" />
                  </View>
                  <View style={styles.routeInfoTextContainer}>
                    <Text style={styles.routeInfoLabel}>Destination</Text>
                    <Text style={styles.routeInfoCoords}>
                      {selectedRequest.dest_lat?.toFixed(4)}, {selectedRequest.dest_lng?.toFixed(4)}
                    </Text>
                  </View>
                </View>

                {selectedRequest.notes && (
                  <>
                    <View style={styles.routeInfoDivider} />
                    <View style={styles.routeNotesContainer}>
                      <Ionicons name="chatbubble-outline" size={16} color="#8e8e93" />
                      <Text style={styles.routeNotesText}>{selectedRequest.notes}</Text>
                    </View>
                  </>
                )}
              </View>

              {/* Enhanced Map Container */}
              <View style={styles.enhancedMapContainer}>
                <MapView
                  style={styles.enhancedMap}
                  initialRegion={{
                    latitude: ((selectedRequest.pickup_lat || 0) + (selectedRequest.dest_lat || 0)) / 2,
                    longitude: ((selectedRequest.pickup_lng || 0) + (selectedRequest.dest_lng || 0)) / 2,
                    latitudeDelta: Math.abs((selectedRequest.pickup_lat || 0) - (selectedRequest.dest_lat || 0)) * 1.5 || 0.01,
                    longitudeDelta: Math.abs((selectedRequest.pickup_lng || 0) - (selectedRequest.dest_lng || 0)) * 1.5 || 0.01,
                  }}
                  showsUserLocation={false}
                  showsMyLocationButton={false}
                  pitchEnabled={true}
                  rotateEnabled={true}
                  zoomEnabled={true}
                  scrollEnabled={true}
                >
                  {/* Route Line */}
                  {busLocation && (
                    <Polyline
                      coordinates={[
                        {
                          latitude: busLocation.latitude,
                          longitude: busLocation.longitude,
                        },
                        {
                          latitude: selectedRequest.pickup_lat || 0,
                          longitude: selectedRequest.pickup_lng || 0,
                        },
                      ]}
                      strokeColor="#007AFF"
                      strokeWidth={4}
                      lineDashPattern={[8, 8]}
                      lineCap="round"
                    />
                  )}
                  <Polyline
                    coordinates={[
                      {
                        latitude: selectedRequest.pickup_lat || 0,
                        longitude: selectedRequest.pickup_lng || 0,
                      },
                      {
                        latitude: selectedRequest.dest_lat || 0,
                        longitude: selectedRequest.dest_lng || 0,
                      },
                    ]}
                    strokeColor="#007AFF"
                    strokeWidth={4}
                    lineDashPattern={[8, 8]}
                    lineCap="round"
                  />

                  {/* Enhanced Pickup Marker */}
                  <Marker
                    coordinate={{
                      latitude: selectedRequest.pickup_lat || 0,
                      longitude: selectedRequest.pickup_lng || 0,
                    }}
                    title="Pickup Location"
                    description="Passenger pickup point"
                  >
                    <View style={styles.customPickupMarker}>
                      <View style={styles.markerPulse} />
                      <View style={styles.pickupMarkerInner}>
                        <Ionicons name="location" size={20} color="#fff" />
                      </View>
                    </View>
                  </Marker>

                  {/* Enhanced Destination Marker */}
                  <Marker
                    coordinate={{
                      latitude: selectedRequest.dest_lat || 0,
                      longitude: selectedRequest.dest_lng || 0,
                    }}
                    title="Drop-off Location"
                    description="Final destination"
                  >
                    <View style={styles.customDestMarker}>
                      <Ionicons name="flag" size={20} color="#fff" />
                    </View>
                  </Marker>

                  {/* Bus Marker */}
                  {busLocation && (
                    <Marker
                      coordinate={busLocation}
                      title="Bus Location"
                      description="Current bus position"
                    >
                      <View style={styles.customBusMarker}>
                        <Image source={require("@/assets/images/bus-icon.png")} style={{ width: 40, height: 40 }} />
                      </View>
                    </Marker>
                  )}
                </MapView>

                {/* Floating Distance Info */}
                <View style={styles.distanceInfoFloat}>
                  <View style={[styles.distanceInfoContent, {
                    borderLeftWidth: 4,
                    borderLeftColor: getRouteEfficiencyColor(calculateDistance(
                      selectedRequest.pickup_lat || 0,
                      selectedRequest.pickup_lng || 0,
                      selectedRequest.dest_lat || 0,
                      selectedRequest.dest_lng || 0
                    ))
                  }]}>
                    <Ionicons name="navigate" size={16} color={getRouteEfficiencyColor(calculateDistance(
                      selectedRequest.pickup_lat || 0,
                      selectedRequest.pickup_lng || 0,
                      selectedRequest.dest_lat || 0,
                      selectedRequest.dest_lng || 0
                    ))} />

                    <Text style={styles.distanceInfoText}>
                      {(() => {
                        const distance = calculateDistance(
                          selectedRequest.pickup_lat || 0,
                          selectedRequest.pickup_lng || 0,
                          selectedRequest.dest_lat || 0,
                          selectedRequest.dest_lng || 0
                        );
                        return `${formatDistance(distance)} • ${calculateEstimatedTime(distance)}`;
                      })()}
                    </Text>
                  </View>
                  <View style={styles.distanceInfoContent}>
                    <Ionicons name="time" size={16} color="#007AFF" />
                    <Text style={styles.distanceInfoText}>
                      {calculateEstimatedTime(calculateDistance(
                        selectedRequest.pickup_lat || 0,
                        selectedRequest.pickup_lng || 0,
                        selectedRequest.dest_lat || 0,
                        selectedRequest.dest_lng || 0
                      ))}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Enhanced Action Buttons */}
              <View style={styles.enhancedActionContainer}>
                <TouchableOpacity
                  style={[styles.enhancedActionButton, styles.declineRouteButton]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    setSelectedRequest(null);
                    handleDeclinePickup(selectedRequest.id);
                  }}
                  activeOpacity={0.8}
                >
                  <View style={styles.actionButtonContent}>
                    <Ionicons name="close-circle" size={24} color="#fff" />
                    <Text style={styles.declineRouteButtonText}>Decline</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.enhancedActionButton, styles.acceptRouteButton]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                    setSelectedRequest(null);
                    handleAcceptPickup(selectedRequest.id);
                  }}
                  activeOpacity={0.8}
                >
                  <View style={styles.actionButtonContent}>
                    <Ionicons name="checkmark-circle" size={24} color="#fff" />
                    <Text style={styles.acceptRouteButtonText}>Accept Request</Text>
                  </View>
                  <View style={styles.acceptButtonGlow} />
                </TouchableOpacity>
              </View>
            </SafeAreaView>
          </Modal>
        )}
      </Modal>
    );
  };

  const fetchPendingRequests = async () => {
    const busId = currentTrip?.buses?.id || assignedBus?.id;
    if (!busId) {
      console.log("No bus ID available for fetching pending requests.");
      return;
    }

    console.log("Fetching pending requests for bus ID:", busId);

    try {
      const { data, error } = await supabase
        .from("pickup_requests")
        .select("*")
        .eq("bus_id", busId)
        .eq("status", "pending");

      if (error) {
        console.error("Error fetching pending requests:", error);
        return;
      }

      console.log("Fetched pending requests data:", data);
      setPendingPickups(data || []);
    } catch (err) {
      console.error("Unexpected error fetching pending requests:", err);
    }
  };

  useEffect(() => {
    if (showPendingRequests) {
      fetchPendingRequests();
    }
  }, [showPendingRequests]);
  // Pulse animation for pending requests button
  const pendingRequestsPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let animationRef: Animated.CompositeAnimation | null = null;
    let isMounted = true;

    if (_pendingPickups.length > 0) {
      const runPulse = () => {
        if (!isMounted) return;

        animationRef = Animated.sequence([
          Animated.timing(pendingRequestsPulse, {
            toValue: 1.05,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pendingRequestsPulse, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ]);

        animationRef.start(({ finished }) => {
          if (finished && isMounted) {
            runPulse();
          }
        });
      };
      runPulse();
    } else {
      pendingRequestsPulse.setValue(1);
    }

    return () => {
      isMounted = false;
      if (animationRef) {
        animationRef.stop();
      }
      pendingRequestsPulse.stopAnimation();
    };
  }, [_pendingPickups.length, pendingRequestsPulse]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.loadingContainer}>
          <View style={styles.loadingSpinner}>
            <ActivityIndicator size="large" color="#0891B2" />
          </View>
          <Text style={styles.loadingText}>Loading your Dashboard...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentTrip) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />

        {/* Premium Gradient Header - Enhanced for No Active Trip */}
        <LinearGradient
          colors={["#0891B2", "#06B6D4", "#22D3EE"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <View style={styles.headerTop}>
            <View style={styles.headerContent}>
              <View style={styles.headerIconBg}>
                <Ionicons name="bus" size={24} color="#0891B2" />
              </View>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Conductor Dashboard</Text>
                <Text style={styles.headerSubtitle}>
                  {assignedBus
                    ? `${assignedBus.plate_number} • ${assignedBus.routes?.name || "No Route Assigned"}`
                    : "Not Assigned • Offline"
                  }
                </Text>
              </View>
            </View>
            <View style={styles.tripStatusBadge}>
              <View style={[styles.statusPulse, { backgroundColor: "#FFB000" }]} />
              <Text style={styles.tripStatusText}>Standby</Text>
            </View>
          </View>
        </LinearGradient>

        {/* Show assigned bus info card */}
        {assignedBus && (
          <View style={styles.assignedBusCard}>
            <View style={styles.assignedBusHeader}>
              <View style={styles.assignedBusIconContainer}>
                <Ionicons name="bus" size={24} color="#007AFF" />
              </View>
              <View style={styles.assignedBusInfo}>
                <Text style={styles.assignedBusTitle}>Your Assigned Bus</Text>
                <Text style={styles.assignedBusPlate}>{assignedBus.plate_number}</Text>
              </View>
              <View style={styles.capacityBadge}>
                <Ionicons name="people" size={14} color="#8e8e93" />
                <Text style={styles.capacityBadgeText}>{assignedBus.capacity} seats</Text>
              </View>
            </View>
            {assignedBus.routes && (
              <View style={styles.assignedBusRoute}>
                <View style={styles.routeInfoRow}>
                  <View style={styles.routeInfoIconBg}>
                    <Ionicons name="navigate" size={16} color="#007AFF" />
                  </View>
                  <View style={styles.routeInfoDetails}>
                    <Text style={styles.routeInfoLabel}>Route</Text>
                    <Text style={styles.routeInfoName}>{assignedBus.routes.name}</Text>
                  </View>
                </View>
                <View style={styles.routeStops}>
                  <View style={styles.routeStopItem}>
                    <View style={[styles.routeStopDot, { backgroundColor: "#34C759" }]} />
                    <Text style={styles.routeStopText} numberOfLines={2}>
                      {assignedBus.routes.start_address}
                    </Text>
                  </View>
                  <View style={styles.routeConnector} />
                  <View style={styles.routeStopItem}>
                    <View style={[styles.routeStopDot, { backgroundColor: "#FF3B30" }]} />
                    <Text style={styles.routeStopText} numberOfLines={2}>
                      {assignedBus.routes.end_address}
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </View>
        )}

        <View style={styles.emptyState}>
          <View style={styles.emptyStateIcon}>
            <Ionicons name="time-outline" size={64} color="#FF9500" />
          </View>
          <Text style={styles.emptyTitle}>No Active Trip</Text>
          <Text style={styles.emptySubtitle}>
            {assignedBus
              ? "Your bus doesn't have an active trip. Wait for the driver to start a trip."
              : "You don't have any active trips at the moment. Check back later or contact your driver."
            }
          </Text>
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              fetchCurrentTrip();
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="refresh" size={20} color="#007AFF" />
            <Text style={styles.refreshButtonText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      {/* Premium Gradient Header */}
      <LinearGradient
        colors={["#0891B2", "#06B6D4", "#22D3EE"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerTop}>
          <View style={styles.headerContent}>
            <View style={styles.headerIconBg}>
              <Ionicons name="bus" size={24} color="#0891B2" />
            </View>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Conductor Dashboard</Text>
              <Text style={styles.headerSubtitle}>
                {currentTrip?.buses?.plate_number || "Unknown Plate"} • {currentTrip?.buses?.routes?.name || "Unknown Route"}
              </Text>
            </View>
          </View>
          <View style={styles.tripStatusBadge}>
            <View style={[styles.statusPulse, { backgroundColor: currentTrip?.status === "ongoing" ? "#34C759" : "#FF9500" }]} />
            <Text style={styles.tripStatusText}>
              {currentTrip?.status === "ongoing" ? "Active" : "Waiting"}
            </Text>
          </View>
        </View>

        {/* Quick Stats Row */}
        <View style={styles.headerStats}>
          <View style={styles.statItem}>
            <View style={styles.statIconBg}>
              <Ionicons name="people" size={18} color="#0891B2" />
            </View>
            <View>
              <Text style={styles.statValue}>{passengerCount}</Text>
              <Text style={styles.statLabel}>Passengers</Text>
            </View>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <View style={styles.statIconBg}>
              <Ionicons name="checkmark-circle" size={18} color="#34C759" />
            </View>
            <View>
              <Text style={styles.statValue}>{passengers.filter(p => p.status === "boarded").length}</Text>
              <Text style={styles.statLabel}>Boarded</Text>
            </View>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <View style={styles.statIconBg}>
              <Ionicons name="time" size={18} color="#FF9500" />
            </View>
            <View>
              <Text style={styles.statValue}>{passengers.filter(p => p.status === "waiting").length}</Text>
              <Text style={styles.statLabel}>Waiting</Text>
            </View>
          </View>
        </View>
      </LinearGradient>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollContent}>
        {/* Real-time Map Card */}
        <View style={styles.mapCard}>
          <LinearGradient
            colors={["#0891B2", "#06B6D4"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.mapHeader}
          >
            <View style={styles.mapHeaderLeft}>
              <View style={styles.mapIconBg}>
                <Ionicons name="navigate" size={16} color="#0891B2" />
              </View>
              <Text style={styles.mapTitle}>Live Location</Text>
            </View>
            <View style={[styles.gpsIndicator, { backgroundColor: busLocation ? "rgba(52, 199, 89, 0.2)" : "rgba(255, 59, 48, 0.2)" }]}>
              <View style={[styles.gpsDot, { backgroundColor: busLocation ? "#34C759" : "#FF3B30" }]} />
              <Text style={[styles.gpsText, { color: busLocation ? "#34C759" : "#FF3B30" }]}>
                {busLocation ? "GPS Active" : "No Signal"}
              </Text>
            </View>
          </LinearGradient>
          <MapView
            style={styles.map}
            region={mapRegion}
            onRegionChangeComplete={setMapRegion}
            showsUserLocation={true}
            showsMyLocationButton={true}
          >
            {busLocation && (
              <Marker
                coordinate={busLocation}
                title="Your Bus"
                description={assignedBus?.plate_number}
              >
                <View style={styles.busMarkerContainer}>
                  <View style={styles.busMarkerPulse} />
                  <View style={styles.busMarkerCircle}>
                    <Ionicons name="bus" size={16} color="#fff" />
                  </View>
                </View>
              </Marker>
            )}
          </MapView>
        </View>

        {/* Trip Info Card */}
        <View style={styles.tripCard}>
          <View style={styles.tripHeader}>
            <View style={styles.tripInfo}>
              <Text style={styles.routeName}>
                {currentTrip?.buses?.routes?.name || "Unknown Route"}
              </Text>
              <Text style={styles.busPlate}>
                {currentTrip?.buses?.plate_number || "Unknown Plate"}
              </Text>
            </View>
            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor:
                    currentTrip.status === "ongoing" ? "#E8F5E8" : "#FFF3CD",
                },
              ]}
            >
              <Ionicons
                name={currentTrip.status === "ongoing" ? "play-circle" : "time"}
                size={16}
                color={currentTrip.status === "ongoing" ? "#4CAF50" : "#FF9500"}
              />
              <Text
                style={[
                  styles.statusText,
                  {
                    color:
                      currentTrip.status === "ongoing" ? "#4CAF50" : "#FF9500",
                  },
                ]}
              >
                {currentTrip.status === "ongoing" ? "In Progress" : "Waiting"}
              </Text>
            </View>
          </View>

          <View style={styles.routeDetails}>
            <View style={styles.routeItem}>
              <View
                style={[styles.locationMarker, { backgroundColor: "#4CAF50" }]}
              >
                <Ionicons name="location" size={12} color="#fff" />
              </View>
              <Text style={styles.locationText}>
                {currentTrip.buses.routes.start_address || "Unknown Start Address"}
              </Text>
            </View>
            <View style={styles.routeItem}>
              <View
                style={[styles.locationMarker, { backgroundColor: "#FF3B30" }]}
              >
                <Ionicons name="location" size={12} color="#fff" />
              </View>
              <Text style={styles.locationText}>
                {currentTrip.buses.routes.end_address || "Unknown End Address"}
              </Text>
            </View>
          </View>
        </View>
        {/* Passenger Count Card */}
        <View style={styles.passengerCountCard}>
          <View style={styles.countHeader}>
            <Ionicons name="people" size={24} color="#007AFF" />
            <Text style={styles.countTitle}>Boarded Passengers</Text>
          </View>
          <View style={styles.countDisplay}>
            <Text style={styles.countNumber}>{passengerCount}</Text>
            <Text style={styles.countTotal}>
              / {currentTrip?.buses?.capacity || "0"}
            </Text>
          </View>

          {/* Capacity Progress Bar */}
          <View style={styles.capacityProgress}>
            <View style={styles.progressBarContainer}>
              <Animated.View
                style={[
                  styles.progressBar,
                  {
                    width: `${Math.min((passengerCount / (currentTrip?.buses?.capacity || 1)) * 100, 100)}%`,
                    backgroundColor:
                      passengerCount / (currentTrip?.buses?.capacity || 1) >= 0.9
                        ? "#FF3B30"
                        : passengerCount / (currentTrip?.buses?.capacity || 1) >= 0.7
                          ? "#FF9500"
                          : "#34C759"
                  }
                ]}
              />
            </View>
            <Text style={styles.capacityText}>
              {Math.round((passengerCount / (currentTrip?.buses?.capacity || 1)) * 100)}% Capacity
            </Text>
          </View>

          {/* Show waiting passengers count if any */}
          {passengers.filter((p) => p.status === "waiting").length > 0 ? (
            <View style={styles.waitingBanner}>
              <Ionicons name="alert-circle" size={20} color="#FF9500" />
              <Text style={styles.waitingText}>
                {passengers
                  .filter((p) => p.status === "waiting")
                  .reduce((sum, p) => sum + (p.passenger_count || 1), 0)}
                {" "}passenger(s) waiting to board - Scan QR to board
              </Text>
            </View>
          ) : null}
          <View style={styles.countActions}>
            <TouchableOpacity
              style={[
                styles.actionButton,
                !hasPermission && styles.disabledButton
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setShowQRScanner(true);
              }}
              disabled={!hasPermission}
              activeOpacity={0.8}
            >
              <Ionicons name="qr-code" size={20} color="#fff" />
              <Text style={styles.actionButtonText}>Scan QR</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.guestButton]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setShowGuestModal(true);
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="person-add" size={20} color="#fff" />
              <Text style={styles.actionButtonText}>Add Guest</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Passengers List */}
        <View style={styles.passengersSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              All Passengers ({passengers.filter((p) => p.status !== "cancelled" && p.status !== "completed").length})
            </Text>
            <TouchableOpacity
              style={styles.reloadButton}
              onPress={fetchCurrentTrip}
              disabled={loading}
            >
              <Ionicons
                name="refresh"
                size={20}
                color={loading ? "#8e8e93" : "#007AFF"}
              />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.passengersList} showsVerticalScrollIndicator={true}>
            {passengers
              .filter((p) => p.status !== "cancelled" && p.status !== "completed")
              .map((item) => (
                <View key={item.id}>
                  {renderPassengerItem({ item })}
                </View>
              ))}
          </ScrollView>
        </View>
      </ScrollView>

      {/* QR Scanner Modal */}
      <Modal
        visible={showQRScanner}
        animationType="slide"
        onRequestClose={() => setShowQRScanner(false)}
      >
        <View style={styles.scannerContainer}>
          <View style={styles.scannerHeader}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowQRScanner(false);
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.scannerHeaderContent}>
              <Text style={styles.scannerTitle}>Scan QR Code</Text>
              <Text style={styles.scannerSubtitle}>Position passenger&apos;s QR code within the frame</Text>
            </View>
          </View>

          {hasPermission === null ? (
            <View style={styles.permissionContainer}>
              <Text style={styles.permissionText}>
                Requesting camera permission...
              </Text>
            </View>
          ) : hasPermission === false ? (
            <View style={styles.permissionContainer}>
              <Ionicons name="camera" size={64} color="#8e8e93" />
              <Text style={styles.permissionText}>
                Camera permission is required to scan QR codes
              </Text>
            </View>
          ) : (
            <View style={styles.cameraContainer}>
              <CameraView
                style={styles.camera}
                onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
                barcodeScannerSettings={{
                  barcodeTypes: ["qr"],
                }}
              />
              <View style={styles.scannerOverlay}>
                <View style={styles.scannerFrame}>

                  {/* Corner indicators */}
                  <View style={[styles.corner, styles.topLeft]} />
                  <View style={[styles.corner, styles.topRight]} />
                  <View style={[styles.corner, styles.bottomLeft]} />
                  <View style={[styles.corner, styles.bottomRight]} />

                  <Animated.View
                    style={[
                      styles.scanLine,
                      {
                        transform: [
                          {
                            translateY: scanLineAnimation.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0, 200],
                            }),
                          },
                        ],
                      },
                    ]}
                  />
                </View>
                <Text style={styles.scannerInstruction}>
                  Align the QR code within the frame
                </Text>
                <View style={styles.scannerTips}>
                  <Text style={styles.scannerTip}>• Ensure good lighting</Text>
                  <Text style={styles.scannerTip}>• Hold device steady</Text>
                </View>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* Guest Passenger Modal - Enhanced */}
      <Modal
        visible={showGuestModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowGuestModal(false)}
      >
        <View style={styles.guestModalOverlay}>
          <View style={styles.guestModalContainer}>
            {/* Modal Header with Gradient */}
            <LinearGradient
              colors={["#0891B2", "#06B6D4"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.guestModalHeader}
            >
              <View style={styles.guestModalIconBg}>
                <Ionicons name="people" size={28} color="#0891B2" />
              </View>
              <View style={styles.guestModalHeaderText}>
                <Text style={styles.guestModalTitle}>Add Guests</Text>
                <Text style={styles.guestModalSubtitle}>Walk-on passengers</Text>
              </View>
              <TouchableOpacity
                style={styles.guestModalClose}
                onPress={() => {
                  setShowGuestModal(false);
                  setGuestCount(1);
                }}
              >
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </LinearGradient>

            {/* Modal Content */}
            <View style={styles.guestModalContent}>
              <Text style={styles.guestModalDescription}>
                How many guests are boarding without using the app?
              </Text>

              {/* Number Picker */}
              <View style={styles.guestNumberPicker}>
                <TouchableOpacity
                  style={styles.guestNumberButton}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setGuestCount(Math.max(1, guestCount - 1));
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="remove" size={28} color="#0891B2" />
                </TouchableOpacity>

                <View style={styles.guestNumberDisplay}>
                  <Text style={styles.guestNumberValue}>{guestCount}</Text>
                  <Text style={styles.guestNumberLabel}>
                    {guestCount === 1 ? "guest" : "guests"}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.guestNumberButton}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setGuestCount(
                      Math.min(
                        currentTrip.buses.capacity - passengerCount,
                        guestCount + 1
                      )
                    );
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="add" size={28} color="#0891B2" />
                </TouchableOpacity>
              </View>

              {/* Capacity Indicator */}
              <View style={styles.guestCapacityInfo}>
                <View style={styles.guestCapacityRow}>
                  <Ionicons name="bus-outline" size={16} color="#64748B" />
                  <Text style={styles.guestCapacityText}>
                    {passengerCount + guestCount} / {currentTrip?.buses?.capacity || 0} seats after adding
                  </Text>
                </View>
                <View style={styles.guestCapacityBar}>
                  <View
                    style={[
                      styles.guestCapacityFill,
                      {
                        width: `${Math.min(((passengerCount + guestCount) / (currentTrip?.buses?.capacity || 1)) * 100, 100)}%`,
                        backgroundColor: (passengerCount + guestCount) / (currentTrip?.buses?.capacity || 1) > 0.9 ? "#EF4444" : "#0891B2"
                      }
                    ]}
                  />
                </View>
              </View>
            </View>

            {/* Modal Actions */}
            <View style={styles.guestModalActions}>
              <TouchableOpacity
                style={styles.guestCancelButton}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowGuestModal(false);
                  setGuestCount(1);
                }}
              >
                <Text style={styles.guestCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.guestConfirmButton}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  addGuestPassenger();
                }}
              >
                <LinearGradient
                  colors={["#0891B2", "#06B6D4"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.guestConfirmGradient}
                >
                  <Ionicons name="person-add" size={18} color="#fff" />
                  <Text style={styles.guestConfirmText}>Add {guestCount} Guest{guestCount > 1 ? "s" : ""}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Drop-Off Modal for partial group drop-offs */}
      <Modal
        visible={showDropOffModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setShowDropOffModal(false);
          setSelectedPassengerForDropOff(null);
        }}
      >
        <View style={styles.guestModalOverlay}>
          <View style={styles.guestModalContainer}>
            {/* Modal Header */}
            <LinearGradient
              colors={["#EF4444", "#DC2626"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.guestModalHeader}
            >
              <View style={styles.guestModalHeaderText}>
                <View style={styles.guestModalIconBg}>
                  <Ionicons name="exit-outline" size={24} color="#EF4444" />
                </View>
                <Text style={styles.guestModalTitle}>Drop Off Passengers</Text>
              </View>
              <TouchableOpacity
                style={styles.guestModalClose}
                onPress={() => {
                  setShowDropOffModal(false);
                  setSelectedPassengerForDropOff(null);
                }}
              >
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </LinearGradient>

            {/* Modal Content */}
            <View style={styles.guestModalContent}>
              <Text style={styles.guestModalDescription}>
                How many passengers do you want to drop off from this group?
              </Text>

              {/* Number Picker */}
              <View style={styles.guestNumberPicker}>
                <TouchableOpacity
                  style={styles.guestNumberButton}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setDropOffCount(Math.max(1, dropOffCount - 1));
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="remove" size={28} color="#EF4444" />
                </TouchableOpacity>

                <View style={styles.guestNumberDisplay}>
                  <Text style={[styles.guestNumberValue, { color: "#EF4444" }]}>{dropOffCount}</Text>
                  <Text style={styles.guestNumberLabel}>
                    of {selectedPassengerForDropOff?.passenger_count || 1}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.guestNumberButton}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setDropOffCount(
                      Math.min(
                        selectedPassengerForDropOff?.passenger_count || 1,
                        dropOffCount + 1
                      )
                    );
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="add" size={28} color="#EF4444" />
                </TouchableOpacity>
              </View>

              {/* Info */}
              <View style={styles.guestCapacityInfo}>
                <View style={styles.guestCapacityRow}>
                  <Ionicons name="people-outline" size={16} color="#64748B" />
                  <Text style={styles.guestCapacityText}>
                    {(selectedPassengerForDropOff?.passenger_count || 0) - dropOffCount} will remain after drop-off
                  </Text>
                </View>
              </View>
            </View>

            {/* Modal Actions */}
            <View style={styles.guestModalActions}>
              <TouchableOpacity
                style={styles.guestCancelButton}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowDropOffModal(false);
                  setSelectedPassengerForDropOff(null);
                }}
              >
                <Text style={styles.guestCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.guestConfirmButton}
                onPress={() => {
                  if (selectedPassengerForDropOff) {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    confirmDropOff(selectedPassengerForDropOff, dropOffCount);
                  }
                }}
              >
                <LinearGradient
                  colors={["#EF4444", "#DC2626"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.guestConfirmGradient}
                >
                  <Ionicons name="exit-outline" size={18} color="#fff" />
                  <Text style={styles.guestConfirmText}>Drop Off {dropOffCount}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
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

      {/* Boarding Notification */}
      {showNotification && notificationData && (
        <Animated.View
          style={[
            styles.notificationContainer,
            {
              opacity: notificationAnimation,
              transform: [
                {
                  translateY: notificationAnimation.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-100, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.notificationContent}>
            <View style={styles.notificationIcon}>
              <Ionicons name="checkmark-circle" size={24} color="#fff" />
            </View>
            <View style={styles.notificationText}>
              <Text style={styles.notificationTitle}>Passenger Boarded!</Text>
              <Text style={styles.notificationMessage}>
                {notificationData.name}
                {notificationData.count > 1 &&
                  ` (+${notificationData.count - 1} guest${notificationData.count > 2 ? "s" : ""
                  })`}
              </Text>
            </View>
          </View>
        </Animated.View>
      )}
      <Animated.View
        style={{
          transform: [{ scale: _pendingPickups.length > 0 ? pendingRequestsPulse : 1 }],
        }}
      >
        <TouchableOpacity
          style={[
            styles.showRequestsButton,
            _pendingPickups.length > 0 && styles.showRequestsButtonActive
          ]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowPendingRequests(true);
          }}
          activeOpacity={0.8}
        >
          <Ionicons
            name={_pendingPickups.length > 0 ? "notifications" : "notifications-outline"}
            size={20}
            color="#fff"
          />
          <Text style={styles.showRequestsButtonText}>
            Pending Requests {_pendingPickups.length > 0 && `(${_pendingPickups.length})`}
          </Text>
          {_pendingPickups.length > 0 && (
            <View style={styles.requestsBadge}>
              <Text style={styles.requestsBadgeText}>{_pendingPickups.length}</Text>
            </View>)}
        </TouchableOpacity>
      </Animated.View>

      {showPendingRequests && renderPendingRequests()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f2f2f7",
  }, loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f2f2f7",
  },
  loadingSpinner: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: "#E0F2FE",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  loadingContent: {
    alignItems: "center",
    padding: 40,
  },
  loadingText: {
    fontSize: 16,
    color: "#8e8e93",
    marginTop: 16,
    fontWeight: "500",
    textAlign: "center",
  },
  loadingDots: {
    flexDirection: "row",
    marginTop: 20,
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#007AFF",
    opacity: 0.3,
  },
  // Enhanced Loading Screen Styles
  loadingScreen: {
    flex: 1,
    backgroundColor: "#0891B2",
  },
  loadingGradient: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  loadingIconContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 32,
  },
  loadingIconBg: {
    width: 110,
    height: 110,
    borderRadius: 30,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  loadingPulseRing: {
    position: "absolute",
    width: 130,
    height: 130,
    borderRadius: 35,
    borderWidth: 3,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  loadingTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#fff",
    textAlign: "center",
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  loadingSubtitle: {
    fontSize: 16,
    color: "rgba(255, 255, 255, 0.85)",
    textAlign: "center",
    fontWeight: "500",
    marginBottom: 40,
  },
  loadingIndicatorContainer: {
    marginBottom: 30,
  },
  loadingDotsContainer: {
    flexDirection: "row",
    gap: 10,
  },
  loadingDotActive: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#fff",
  },
  loadingDotInactive: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
  },
  mapCard: {
    height: 180,
    backgroundColor: "#fff",
    borderRadius: 20,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  mapHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  mapHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  mapIconBg: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
  },
  mapTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.3,
  },
  gpsIndicator: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 6,
  },
  gpsDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  gpsText: {
    fontSize: 11,
    fontWeight: "700",
  },
  map: {
    flex: 1,
    minHeight: 140,
  },
  busMarkerContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  busMarkerPulse: {
    position: "absolute",
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(0, 122, 255, 0.2)",
  },
  busMarkerCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#0891B2",
    borderWidth: 2,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
  },
  header: {
    paddingTop: 16,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    elevation: 12,
    shadowColor: "#0891B2",
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    marginBottom: 10,
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  headerIconBg: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.3,
    marginBottom: 10,
  },
  headerSubtitle: {
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.85)",
    fontWeight: "600",
  },
  tripStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  statusPulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  tripStatusText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
  },
  headerStats: {
    flexDirection: "row",
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: 16,
    padding: 14,
    justifyContent: "space-around",
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  statIconBg: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
  },
  statValue: {
    fontSize: 18,
    fontWeight: "800",
    color: "#fff",
  },
  statLabel: {
    fontSize: 11,
    color: "rgba(255, 255, 255, 0.8)",
    fontWeight: "600",
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  scrollContent: {
    flex: 1,
    marginTop: -10,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  emptyStateIcon: {
    width: 90,
    height: 90,
    borderRadius: 60,
    backgroundColor: "#F0F8FF",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 14,
    borderWidth: 2,
    borderColor: "#E3F2FD",
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1c1c1e",
    marginBottom: 12,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 16,
    color: "#8e8e93",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 32,
  },
  refreshButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F0F8FF",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#007AFF",
    gap: 8,
  },
  refreshButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#007AFF",
  },
  assignedBusCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
    marginHorizontal: 20,
    marginTop: 10,
    marginBottom: 20,
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
    borderWidth: 1,
    borderColor: "#E3F2FD",
  },
  assignedBusHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  assignedBusIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#F0F8FF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  assignedBusInfo: {
    flex: 1,
  },
  assignedBusTitle: {
    fontSize: 13,
    color: "#8e8e93",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  assignedBusPlate: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1c1c1e",
  },
  capacityBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f2f2f7",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  capacityBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#8e8e93",
    marginLeft: 4,
  },
  assignedBusRoute: {
    backgroundColor: "#f8faff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#eef2ff",
  },
  routeInfoIconBg: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#eef2ff",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  routeInfoDetails: {
    flex: 1,
  },
  routeInfoName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#007AFF",
  },
  routeStops: {
    marginLeft: 4,
  },
  routeStopItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  routeStopDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 12,
  },
  routeStopText: {
    fontSize: 13,
    color: "#1c1c1e",
    fontWeight: "500",
    flex: 1,
  },
  routeConnector: {
    width: 2,
    height: 12,
    backgroundColor: "#eef2ff",
    marginLeft: 3,
    marginVertical: 4,
  },
  tripCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  tripHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  tripInfo: {
    flex: 1,
  },
  routeName: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1c1c1e",
    marginBottom: 4,
  },
  busPlate: {
    fontSize: 14,
    color: "#8e8e93",
    fontWeight: "500",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 6,
  },
  routeDetails: {
    gap: 8,
  },
  routeItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  locationMarker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  locationText: {
    fontSize: 14,
    color: "#1c1c1e",
    fontWeight: "500",
    flex: 1,
  },
  passengerCountCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 20,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  countHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  countTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1c1c1e",
    marginLeft: 8,
  },
  countDisplay: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
    marginBottom: 20,
  },
  countNumber: {
    fontSize: 48,
    fontWeight: "bold",
    color: "#007AFF",
  }, countTotal: {
    fontSize: 24,
    color: "#8e8e93",
    marginLeft: 8,
  },
  capacityProgress: {
    marginBottom: 16,
  },
  progressBarContainer: {
    height: 8,
    backgroundColor: "#E5E5EA",
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 8,
  }, progressBar: {
    height: "100%",
    borderRadius: 4,
  },
  capacityText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#8e8e93",
    textAlign: "center",
  },
  waitingBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF3E0",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  waitingText: {
    fontSize: 14,
    color: "#E65100",
    fontWeight: "500",
    flex: 1,
  },
  countActions: {
    flexDirection: "row",
    gap: 12,
  },
  actionButton: {
    flex: 1,
    backgroundColor: "#007AFF",
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  }, guestButton: {
    backgroundColor: "#34C759",
  },
  disabledButton: {
    backgroundColor: "#8e8e93",
    opacity: 0.6,
  },
  actionButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  }, passengersSection: {
    flex: 1,
    marginHorizontal: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1c1c1e",
    flex: 1,
  },
  reloadButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#f2f2f7",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  passengersList: {
    flex: 1,
  },
  passengerItem: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  passengerInfo: {
    flex: 1,
  },
  passengerName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1c1c1e",
    marginBottom: 4,
  },
  passengerDetails: {
    fontSize: 14,
    color: "#8e8e93",
    marginBottom: 2,
  }, passengerContact: {
    fontSize: 12,
    color: "#8e8e93",
  },
  // Enhanced passenger item styles
  passengerMainInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  passengerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#F0F8FF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
    borderWidth: 2,
    borderColor: "#E3F2FD",
  },
  passengerDetailsContainer: {
    flex: 1,
  },
  passengerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  groupBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#007AFF",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 2,
  },
  groupCount: {
    fontSize: 10,
    fontWeight: "600",
    color: "#fff",
  },
  passengerMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: "#8e8e93",
    fontWeight: "500",
  },
  statusIndicator: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  scannerContainer: {
    flex: 1,
    backgroundColor: "#000",
  }, scannerHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: "rgba(0, 0, 0, 0.9)",
  },
  closeButton: {
    marginRight: 16,
    padding: 8,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  scannerHeaderContent: {
    flex: 1,
  },
  scannerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 4,
  },
  scannerSubtitle: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.8)",
    fontWeight: "500",
  },
  permissionContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  permissionText: {
    fontSize: 16,
    color: "#8e8e93",
    textAlign: "center",
    marginTop: 16,
  },
  cameraContainer: {
    flex: 1,
    position: "relative",
  },
  camera: {
    flex: 1,
  },
  scannerOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  }, scannerFrame: {
    width: 280,
    height: 280,
    borderRadius: 16,
    position: "relative",
    overflow: "hidden",
  },
  corner: {
    position: "absolute",
    width: 30,
    height: 30,
    borderColor: "#007AFF",
    borderWidth: 4,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderTopLeftRadius: 16,
  },
  topRight: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
    borderTopRightRadius: 16,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderBottomLeftRadius: 16,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderBottomRightRadius: 16,
  },
  scanLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: "#007AFF",
    shadowColor: "#007AFF",
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  scannerInstruction: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    marginTop: 40,
    textAlign: "center",
  },
  scannerTips: {
    marginTop: 20,
    alignItems: "flex-start",
  },
  scannerTip: {
    color: "rgba(255, 255, 255, 0.8)",
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  modalContainer: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1c1c1e",
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 16,
    color: "#8e8e93",
    marginBottom: 24,
    lineHeight: 22,
  },
  inputContainer: {
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: "#1c1c1e",
    marginBottom: 12,
  },
  numberInput: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },
  numberButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#f2f2f7",
    justifyContent: "center",
    alignItems: "center",
  },
  numberDisplay: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#1c1c1e",
    minWidth: 60,
    textAlign: "center",
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  cancelButton: {
    backgroundColor: "#f2f2f7",
  },
  confirmButton: {
    backgroundColor: "#34C759",
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#8e8e93",
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
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
  }, notificationContainer: {
    position: "absolute",
    top: 60,
    left: 20,
    right: 20,
    backgroundColor: "#34C759",
    borderRadius: 16,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 12,
    zIndex: 1000,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  notificationContent: {
    flexDirection: "row",
    alignItems: "center",
  }, notificationIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255, 255, 255, 0.25)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  notificationText: {
    flex: 1,
  }, notificationTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#fff",
    marginBottom: 4,
  },
  notificationMessage: {
    fontSize: 15,
    color: "rgba(255, 255, 255, 0.95)",
    fontWeight: "600",
    lineHeight: 20,
  },
  showRequestsButton: {
    backgroundColor: "#0891B2",
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 20,
    marginBottom: 90, // Increased to account for bottom navbar
    shadowColor: "#0891B2",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
    gap: 10,
    position: "relative",
  },
  showRequestsButtonActive: {
    backgroundColor: "#FF9500",
    shadowColor: "#FF9500",
  },
  showRequestsButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  requestsBadge: {
    position: "absolute",
    top: -8,
    right: 12,
    backgroundColor: "#FF3B30",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  requestsBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
  }, modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#007AFF",
    paddingTop: 20,
    paddingBottom: 24,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    marginBottom: 20,
    elevation: 8,
    shadowColor: "#007AFF",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  modalHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  modalCloseButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  requestsCount: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF3E0",
    marginHorizontal: 20,
    marginTop: 10,
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    gap: 8,
  },
  requestsCountText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#E65100",
  },
  requestsList: {
    padding: 20,
  },
  requestCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  requestHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  commuterInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#E3F2FD",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  commuterDetails: {
    flex: 1,
  },
  commuterName: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1c1c1e",
    marginBottom: 4,
  },
  passengerCountBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  passengerCountText: {
    fontSize: 13,
    color: "#8e8e93",
    fontWeight: "500",
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF3E0",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FF9500",
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#E65100",
  },
  notesContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#F8F9FA",
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    gap: 8,
  },
  notesText: {
    fontSize: 14,
    color: "#495057",
    fontStyle: "italic",
    flex: 1,
    lineHeight: 20,
  }, locationInfo: {
    backgroundColor: "#F8F9FA",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  locationIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  locationTextContainer: {
    flex: 1,
  },
  locationLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#8e8e93",
    marginBottom: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  locationCoords: {
    fontSize: 14,
    color: "#1c1c1e",
    fontWeight: "500",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  locationDivider: {
    height: 1,
    backgroundColor: "#E5E5EA",
    marginVertical: 10,
  }, viewMapButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F0F8FF",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#007AFF",
    gap: 8,
    zIndex: 10,
    elevation: 1,
  },
  viewMapButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#007AFF",
  },
  requestActions: {
    flexDirection: "row",
    gap: 10,
  },
  requestActionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  declineActionButton: {
    backgroundColor: "#FF3B30",
  },
  approveActionButton: {
    backgroundColor: "#34C759",
  },
  declineActionText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
  },
  approveActionText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
  },
  emptyRequestsState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  emptyIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#E8F5E8",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  emptyRequestsTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1c1c1e",
    marginBottom: 8,
  },
  emptyRequestsMessage: {
    fontSize: 16,
    color: "#8e8e93",
    textAlign: "center",
    lineHeight: 22,
  },
  mapInfoBar: {
    backgroundColor: "#fff",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5EA",
  },
  mapInfoText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1c1c1e",
  },
  mapActionBar: {
    flexDirection: "row",
    backgroundColor: "#fff",
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "#E5E5EA",
  },
  mapActionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  mapDeclineButton: {
    backgroundColor: "#FF3B30",
  },
  mapApproveButton: {
    backgroundColor: "#34C759",
  },
  mapActionButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
  requestItem: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  requestTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1c1c1e",
    marginBottom: 4,
  },
  requestDetails: {
    fontSize: 14,
    color: "#8e8e93",
    marginBottom: 2,
  },
  emptyText: {
    fontSize: 16,
    color: "#8e8e93",
    textAlign: "center",
    marginTop: 20,
  },
  mapButton: {
    backgroundColor: "#007AFF",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    flexDirection: "row",
    gap: 8,
  },
  mapButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  actionButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },
  approveButton: {
    backgroundColor: "#34C759",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    marginRight: 8,
    flexDirection: "row",
    gap: 8,
  },
  approveButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  declineButton: {
    backgroundColor: "#FF3B30",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    flexDirection: "row",
    gap: 8,
  },
  declineButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  mapContainer: {
    flex: 1,
    backgroundColor: "#f2f2f7",
  },
  cardShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  }, buttonShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },

  // Enhanced Route Map Styles
  routeMapContainer: {
    flex: 1,
    backgroundColor: "#fff",
  },
  routeMapHeader: {
    backgroundColor: "#007AFF",
    paddingTop: Platform.OS === 'ios' ? 0 : 20,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  routeMapHeaderContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  routeMapCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  routeMapTitleContainer: {
    flex: 1,
  },
  routeMapTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 4,
  },
  routeMapSubtitleContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  routeMapSubtitle: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.8)",
    fontWeight: "500",
  },

  // Route Info Card
  routeInfoCard: {
    margin: 16,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  routeInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  routeInfoItem: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  routeInfoIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#f2f2f7",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  routeInfoTextContainer: {
    flex: 1,
  },
  routeInfoLabel: {
    fontSize: 12,
    color: "#8e8e93",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  routeInfoCoords: {
    fontSize: 14,
    color: "#1c1c1e",
    fontWeight: "500",
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  routeInfoDivider: {
    height: 1,
    backgroundColor: "#f2f2f7",
    marginVertical: 12,
  },
  passengerCountChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E3F2FD",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  passengerCountChipText: {
    fontSize: 12,
    color: "#007AFF",
    fontWeight: "600",
  },
  routeNotesContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  routeNotesText: {
    flex: 1,
    fontSize: 14,
    color: "#666",
    fontStyle: "italic",
    lineHeight: 20,
  },

  // Enhanced Map Styles
  enhancedMapContainer: {
    flex: 1,
    margin: 16,
    marginTop: 0,
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  enhancedMap: {
    flex: 1,
  },

  // Custom Markers
  customPickupMarker: {
    alignItems: "center",
    justifyContent: "center",
  },
  pickupMarkerInner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#34C759",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: "#fff",
    shadowColor: "#34C759",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 6,
  },
  markerPulse: {
    position: "absolute",
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(52, 199, 89, 0.3)",
    borderWidth: 2,
    borderColor: "rgba(52, 199, 89, 0.5)",
  },
  customDestMarker: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FF3B30",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: "#fff",
    shadowColor: "#FF3B30",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 6,
  },
  customBusMarker: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 6,
  },

  // Distance Info Float
  distanceInfoFloat: {
    position: "absolute",
    top: 16,
    left: 16,
    right: 16,
  },
  distanceInfoContent: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
    borderRadius: 20,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  distanceInfoText: {
    fontSize: 14,
    color: "#1c1c1e",
    fontWeight: "600",
  },

  // Enhanced Action Buttons
  enhancedActionContainer: {
    flexDirection: "row",
    gap: 12,
    margin: 16,
    marginTop: 0,
  },
  enhancedActionButton: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
    position: "relative",
    overflow: "hidden",
  },
  actionButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  declineRouteButton: {
    backgroundColor: "#FF6B6B",
  },
  declineRouteButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  acceptRouteButton: {
    backgroundColor: "#34C759",
    position: "relative",
  },
  acceptRouteButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  acceptButtonGlow: {
    position: "absolute",
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    backgroundColor: "rgba(52, 199, 89, 0.3)",
    borderRadius: 18,
    zIndex: -1,
  },
  // Enhanced Guest Modal Styles
  guestModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  guestModalContainer: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -10 },
    elevation: 20,
  },
  guestModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 20,
    paddingHorizontal: 20,
  },
  guestModalIconBg: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  guestModalHeaderText: {
    flex: 1,
  },
  guestModalTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#fff",
    marginBottom: 2,
  },
  guestModalSubtitle: {
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.8)",
    fontWeight: "500",
  },
  guestModalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  guestModalContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
  },
  guestModalDescription: {
    fontSize: 15,
    color: "#64748B",
    textAlign: "center",
    marginBottom: 28,
    lineHeight: 22,
  },
  guestNumberPicker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
    gap: 24,
  },
  guestNumberButton: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: "#F0FDFA",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#0891B2",
  },
  guestNumberDisplay: {
    alignItems: "center",
    minWidth: 80,
  },
  guestNumberValue: {
    fontSize: 48,
    fontWeight: "800",
    color: "#0891B2",
    lineHeight: 56,
  },
  guestNumberLabel: {
    fontSize: 14,
    color: "#64748B",
    fontWeight: "600",
  },
  guestCapacityInfo: {
    backgroundColor: "#F8FAFC",
    borderRadius: 16,
    padding: 16,
  },
  guestCapacityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  guestCapacityText: {
    fontSize: 13,
    color: "#64748B",
    fontWeight: "500",
  },
  guestCapacityBar: {
    height: 8,
    backgroundColor: "#E2E8F0",
    borderRadius: 4,
    overflow: "hidden",
  },
  guestCapacityFill: {
    height: "100%",
    borderRadius: 4,
  },
  guestModalActions: {
    flexDirection: "row",
    padding: 20,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  guestCancelButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
  },
  guestCancelText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#64748B",
  },
  guestConfirmButton: {
    flex: 2,
    borderRadius: 14,
    overflow: "hidden",
  },
  guestConfirmGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    gap: 8,
  },
  guestConfirmText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
  // Enhanced Pickup Request Styles
  pickupRequestsContainer: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  pickupRequestsHeader: {
    paddingTop: 50,
    paddingBottom: 24,
    paddingHorizontal: 20,
  },
  pickupHeaderContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  pickupHeaderIconBg: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  pickupHeaderTextContainer: {
    flex: 1,
  },
  pickupHeaderTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#fff",
    marginBottom: 4,
  },
  pickupHeaderSubtitle: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.85)",
    fontWeight: "600",
  },
  pickupHeaderClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  pickupRequestsList: {
    padding: 16,
    paddingBottom: 100,
  },
  pickupRequestCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    shadowColor: "#0891B2",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  pickupCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  pickupCommuterInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  pickupAvatarContainer: {
    marginRight: 12,
  },
  pickupAvatarGradient: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  pickupCommuterDetails: {
    flex: 1,
  },
  pickupCommuterName: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1E293B",
    marginBottom: 4,
  },
  pickupPassengerBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F0FDFA",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: "flex-start",
    gap: 4,
  },
  pickupPassengerText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#0891B2",
  },
  pickupStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF7ED",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    gap: 6,
  },
  pickupStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#F97316",
  },
  pickupStatusText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#F97316",
  },
  pickupNotesContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#F1F5F9",
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    gap: 8,
  },
  pickupNotesText: {
    flex: 1,
    fontSize: 13,
    color: "#64748B",
    lineHeight: 18,
  },
  pickupLocationCard: {
    backgroundColor: "#F8FAFC",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  pickupLocationRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  pickupLocationIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  pickupLocationDetails: {
    flex: 1,
  },
  pickupLocationLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
    marginBottom: 2,
  },
  pickupLocationCoords: {
    fontSize: 13,
    fontWeight: "500",
    color: "#1E293B",
  },
  pickupLocationConnector: {
    marginLeft: 16,
    paddingVertical: 8,
  },
  pickupConnectorLine: {
    width: 2,
    height: 20,
    backgroundColor: "#E2E8F0",
    borderRadius: 1,
  },
  pickupViewMapButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F0FDFA",
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 16,
    gap: 8,
  },
  pickupViewMapText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0891B2",
  },
  pickupActionButtons: {
    flexDirection: "row",
    gap: 12,
  },
  pickupDeclineButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEF2F2",
    paddingVertical: 14,
    borderRadius: 14,
    gap: 6,
  },
  pickupDeclineText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#EF4444",
  },
  pickupAcceptButton: {
    flex: 2,
    borderRadius: 14,
    overflow: "hidden",
  },
  pickupAcceptGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    gap: 8,
  },
  pickupAcceptText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
  },
  pickupEmptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 80,
  },
  pickupEmptyIcon: {
    marginBottom: 20,
  },
  pickupEmptyTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1E293B",
    marginBottom: 8,
  },
  pickupEmptyMessage: {
    fontSize: 15,
    color: "#64748B",
    textAlign: "center",
  },

  // Passenger Actions Styles
  passengerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dropOffButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEF2F2",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#FECACA",
    gap: 4,
  },
  dropOffButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FF3B30",
  },
});

export default ConductorScreen;

