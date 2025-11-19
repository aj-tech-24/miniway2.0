import { useAppTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { Camera, CameraView } from "expo-camera";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
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
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
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
      Animated.loop(pulse).start();
    } else {
      pulseAnimation.setValue(1);
    }
  }, [passengers]);

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

      // Find current trip for this conductor (assuming conductor is assigned to a bus)
      const { data: busData, error: busError } = await supabase
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
        .single();

      if (busError || !busData) {
        showAlert(
          "No Bus Assignment",
          "You haven't been assigned to a bus yet. Please contact your administrator.",
          "warning"
        );
        return;
      }

      // Find active trip for this bus
      const { data: tripData, error: tripError } = await supabase
        .from("trips")
        .select(
          `
          id,
          status,
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
        .in("status", ["waiting", "ongoing"])
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();

      if (tripError || !tripData) {
        // No active trip found
        console.log("Trip query error:", tripError);
        console.log("Trip data:", tripData);
        console.log("Bus ID:", busData.id);
        setCurrentTrip(null);
        setPassengers([]);
        setPassengerCount(0);
        return;
      }

      // Transform the data to match our interface
      const busInfo = Array.isArray(tripData.buses)
        ? tripData.buses[0]
        : tripData.buses;
      const transformedTrip: Trip = {
        id: tripData.id,
        status: tripData.status,
        buses: {
          ...busInfo,
          routes: Array.isArray(busInfo.routes)
            ? busInfo.routes[0]
            : busInfo.routes,
        },
        trip_passengers: (tripData.trip_passengers || []).map((p: any) => ({
          id: p.id,
          passenger_id: p.passenger_id,
          status: p.status,
          boarded_at: p.boarded_at,
          passenger_count: p.passenger_count,
          users: Array.isArray(p.users) ? p.users[0] : p.users,
        })),
      };      // Calculate data before state updates to batch them
      const boardedPassengers = transformedTrip.trip_passengers.filter(
        (p: Passenger) => p.status === "boarded"
      );
      const totalBoardedCount = boardedPassengers.reduce(
        (sum: number, p: Passenger) => sum + (p.passenger_count || 1),
        0
      );
      const passengerIds = new Set(
        boardedPassengers.map((p: Passenger) => p.passenger_id)
      );

      // Batch all state updates together to prevent multiple re-renders
      setCurrentTrip(transformedTrip);
      setPassengers(transformedTrip.trip_passengers);
      setPassengerCount(totalBoardedCount);
      setScannedPassengers(passengerIds);

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
        },        async (payload) => {
          console.log("New passenger boarded:", payload.new);

          // Use setTimeout to batch state updates and prevent useInsertionEffect warning
          setTimeout(async () => {
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

            // Refresh data after a delay to prevent cascade updates
            fetchCurrentTrip();
          }, 0);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "trip_passengers",
          filter: `trip_id=eq.${currentTrip.id}`,
        },        async (payload) => {
          console.log("Passenger updated:", payload.new);
          
          // Use setTimeout to batch state updates and prevent useInsertionEffect warning
          setTimeout(async () => {
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

            // Refresh data after a delay to prevent cascade updates
            fetchCurrentTrip();
          }, 0);
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [currentTrip?.id, fetchCurrentTrip]);
  // Add debugging logs to the `pickup_requests` subscription.
  useEffect(() => {
    if (!currentTrip?.buses?.id) {
      console.log("No bus ID available for subscription.");
      return;
    }

    const pickupSubscription = supabase
      .channel(`pickup_requests_${currentTrip.buses.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "pickup_requests",
          filter: `bus_id=eq.${currentTrip.buses.id}`,
        },        (payload) => {
          console.log("New pickup request received:", payload.new);

          // Use setTimeout to prevent state updates during render
          setTimeout(() => {
            // Add the new pickup request to the state
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
          }, 0);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "pickup_requests",
          filter: `bus_id=eq.${currentTrip.buses.id}`,
        },        (payload) => {
          console.log("Pickup request updated:", payload.new);

          // Use setTimeout to prevent state updates during render
          setTimeout(() => {
            // If status changed to accepted or declined, remove from pending list
            if (payload.new.status === "accepted" || payload.new.status === "declined") {
              setPendingPickups((prev) => prev.filter((p) => p.id !== payload.new.id));
            } else {
              // Update the pickup request in state
              setPendingPickups((prev) =>
                prev.map((p) => (p.id === payload.new.id ? { ...p, ...payload.new } : p))
              );
            }
          }, 0);
        }
      )
      .subscribe();

    console.log("Subscribed to pickup_requests for bus ID:", currentTrip.buses.id);

    return () => {
      console.log("Unsubscribing from pickup_requests for bus ID:", currentTrip.buses.id);
      pickupSubscription.unsubscribe();
    };
  }, [currentTrip?.buses?.id]);  const handleAcceptPickup = async (pickupId: string) => {
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
  };  const handleDeclinePickup = async (pickupId: string) => {
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
        `${
          passenger.users?.fullName || "Passenger"
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

  // Add guest passenger
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
      // Create a guest passenger record
      const { error: insertError } = await supabase
        .from("trip_passengers")
        .insert({
          trip_id: currentTrip.id,
          bus_id: currentTrip.buses.id,
          passenger_id: `guest_${Date.now()}`, // Generate unique guest ID
          status: "boarded",
          boarded_at: new Date().toISOString(),
          passenger_count: guestCount,
        });

      if (insertError) {
        throw insertError;
      }

      // Update bus passenger count
      const newPassengerCount = passengerCount + guestCount;
      const { error: busError } = await supabase
        .from("buses")
        .update({ passengers: newPassengerCount })
        .eq("id", currentTrip.buses.id);

      if (busError) {
        console.error("Error updating bus passenger count:", busError);
      }

      // Update local state
      setPassengerCount(newPassengerCount);

      const guestText = guestCount > 1 ? `${guestCount} guests` : "1 guest";
      showAlert(
        "Guests Added! ✅",
        `${guestText} have been added to the passenger count.`,
        "success"
      );

      setShowGuestModal(false);
      setGuestCount(1);

      // Refresh data
      fetchCurrentTrip();
    } catch (error) {
      console.error("Error adding guest passengers:", error);
      showAlert(
        "Error",
        "Failed to add guest passengers. Please try again.",
        "error"
      );
    }
  };
  const renderPassengerItem = ({ item }: { item: Passenger }) => {
    const isGuest = item.passenger_id.startsWith('guest_');
    const passengerName = item.users?.fullName || 
      (isGuest ? `Guest Passenger` : `Passenger #${item.id.substring(0, 8)}`);
    
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
      </Animated.View>
    );
  };

  // Add a button to show pending requests and display their pickup locations.
  const [showPendingRequests, setShowPendingRequests] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<PendingPickupRequest | null>(null);
  
  // Enhanced Route Map state
  const [mapLoading, setMapLoading] = useState(true);
  const pulseAnimationRef = useRef(new Animated.Value(1)).current;

  // Pulse animation for pickup marker
  useEffect(() => {
    const pulse = () => {
      Animated.sequence([
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
      ]).start(() => pulse());
    };
    
    if (selectedRequest) {
      pulse();
    }
    
    return () => {
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
        <SafeAreaView style={styles.container}>
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderLeft}>
              <Ionicons name="notifications" size={28} color="#fff" />
              <Text style={styles.headerTitle}>Pickup Requests</Text>
            </View>
            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowPendingRequests(false);
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
          </View>
          
          {_pendingPickups.length > 0 && (
            <View style={styles.requestsCount}>
              <Ionicons name="time" size={20} color="#FF9500" />
              <Text style={styles.requestsCountText}>
                {_pendingPickups.length} pending {_pendingPickups.length === 1 ? 'request' : 'requests'}
              </Text>
            </View>
          )}

          <FlatList
            data={_pendingPickups}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.requestsList}
            renderItem={({ item }) => (
              <View style={[styles.requestCard, styles.cardShadow]}>
                <View style={styles.requestHeader}>
                  <View style={styles.commuterInfo}>
                    <View style={styles.avatarPlaceholder}>
                      <Ionicons name="person" size={24} color="#007AFF" />
                    </View>
                    <View style={styles.commuterDetails}>
                      <Text style={styles.commuterName}>
                        {item.commuter_name || "Unknown Commuter"}
                      </Text>
                      {item.passenger_count && item.passenger_count > 1 && (
                        <View style={styles.passengerCountBadge}>
                          <Ionicons name="people" size={14} color="#8e8e93" />
                          <Text style={styles.passengerCountText}>
                            {item.passenger_count} passengers
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <View style={styles.statusPill}>
                    <View style={styles.statusDot} />
                    <Text style={styles.statusPillText}>Pending</Text>
                  </View>
                </View>

                {item.notes && (
                  <View style={styles.notesContainer}>
                    <Ionicons name="chatbubble-outline" size={16} color="#8e8e93" />
                    <Text style={styles.notesText}>{item.notes}</Text>
                  </View>
                )}

                <View style={styles.locationInfo}>
                  <View style={styles.locationRow}>
                    <View style={styles.locationIconContainer}>
                      <Ionicons name="location" size={18} color="#34C759" />
                    </View>
                    <View style={styles.locationTextContainer}>
                      <Text style={styles.locationLabel}>Pickup</Text>
                      <Text style={styles.locationCoords}>
                        {item.pickup_lat?.toFixed(6)}, {item.pickup_lng?.toFixed(6)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.locationDivider} />

                  <View style={styles.locationRow}>
                    <View style={styles.locationIconContainer}>
                      <Ionicons name="location" size={18} color="#FF3B30" />
                    </View>
                    <View style={styles.locationTextContainer}>
                      <Text style={styles.locationLabel}>Drop-off</Text>
                      <Text style={styles.locationCoords}>
                        {item.dest_lat?.toFixed(6)}, {item.dest_lng?.toFixed(6)}
                      </Text>
                    </View>
                  </View>
                </View>
                {/* View on Map Button */}
                <TouchableOpacity
                  style={styles.viewMapButton}
                  onPress={() => {
                    console.log("View Map button pressed for:", item.commuter_name);
                    setSelectedRequest(item);
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="map-outline" size={20} color="#007AFF" />
                  <Text style={styles.viewMapButtonText}>View Route on Map</Text>
                  <Ionicons name="chevron-forward" size={20} color="#007AFF" />
                </TouchableOpacity>

                {/* Action Buttons */}
                <View style={styles.requestActions}>
                  <TouchableOpacity
                    style={[styles.requestActionButton, styles.declineActionButton]}
                    onPress={() => handleDeclinePickup(item.id)}
                  >
                    <Ionicons name="close-circle" size={22} color="#fff" />
                    <Text style={styles.declineActionText}>Decline</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.requestActionButton, styles.approveActionButton]}
                    onPress={() => handleAcceptPickup(item.id)}
                  >
                    <Ionicons name="checkmark-circle" size={22} color="#fff" />
                    <Text style={styles.approveActionText}>Accept Request</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.emptyRequestsState}>
                <View style={styles.emptyIconContainer}>
                  <Ionicons name="checkmark-done-circle" size={64} color="#34C759" />
                </View>
                <Text style={styles.emptyRequestsTitle}>All Caught Up!</Text>
                <Text style={styles.emptyRequestsMessage}>
                  No pending pickup requests at the moment.
                </Text>
              </View>
            }
          />
        </SafeAreaView>
        
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
    if (!currentTrip?.buses?.id) {
      console.log("No bus ID available for fetching pending requests.");
      return;
    }

    console.log("Fetching pending requests for bus ID:", currentTrip.buses.id);

    try {
      const { data, error } = await supabase
        .from("pickup_requests")
        .select("*")
        .eq("bus_id", currentTrip.buses.id)
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
    if (_pendingPickups.length > 0) {
      const pulse = () => {
        Animated.sequence([
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
        ]).start(() => pulse());
      };
      pulse();
    } else {
      pendingRequestsPulse.setValue(1);
    }
    
    return () => {
      pendingRequestsPulse.stopAnimation();
    };
  }, [_pendingPickups.length]);
  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style={theme === "dark" ? "light" : "dark"} />
        <View style={styles.loadingContainer}>
          <View style={styles.loadingContent}>
            <Ionicons name="bus" size={48} color="#007AFF" />
            <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 16 }} />
            <Text style={styles.loadingText}>Loading conductor dashboard...</Text>
            <View style={styles.loadingDots}>
              <View style={[styles.dot, { animationDelay: "0s" }]} />
              <View style={[styles.dot, { animationDelay: "0.2s" }]} />
              <View style={[styles.dot, { animationDelay: "0.4s" }]} />
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentTrip) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style={theme === "dark" ? "light" : "dark"} />
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <Ionicons name="person-circle" size={28} color="#fff" />
            <Text style={styles.headerTitle}>Conductor Dashboard</Text>
          </View>
        </View>
        <View style={styles.emptyState}>
          <View style={styles.emptyStateIcon}>
            <Ionicons name="bus-outline" size={64} color="#007AFF" />
          </View>
          <Text style={styles.emptyTitle}>No Active Trip</Text>
          <Text style={styles.emptySubtitle}>
            You don't have any active trips at the moment. Check back later or contact your driver.
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
      <StatusBar style={theme === "dark" ? "light" : "dark"} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Ionicons name="person-circle" size={28} color="#fff" />
          <Text style={styles.headerTitle}>Conductor Dashboard</Text>
        </View>
        <Text style={styles.headerSubtitle}>
          {currentTrip?.buses?.plate_number || "Unknown Plate"} • {currentTrip?.buses?.routes?.name || "Unknown Route"}
        </Text>
      </View>

      <ScrollView>
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
        {passengers.filter((p) => p.status === "waiting").length > 0 && (
          <View style={styles.waitingBanner}>
            <Ionicons name="alert-circle" size={20} color="#FF9500" />
            <Text style={styles.waitingText}>
              {passengers
                .filter((p) => p.status === "waiting")
                .reduce((sum, p) => sum + (p.passenger_count || 1), 0)}
              passenger(s) waiting to board - Scan QR to board
            </Text>
          </View>
        )}
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
            All Passengers ({passengers.length})
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
          {passengers.map((item) => (
            <View key={item.id} style={styles.passengerItem}>
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
              <Text style={styles.scannerSubtitle}>Position passenger's QR code within the frame</Text>
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
                  <View style={[styles.corner, styles.topLeft]}/>
                  <View style={[styles.corner, styles.topRight]}/>
                  <View style={[styles.corner, styles.bottomLeft]}/>
                  <View style={[styles.corner, styles.bottomRight]}/>
                  
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

      {/* Guest Passenger Modal */}
      <Modal
        visible={showGuestModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowGuestModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Add Guest Passengers</Text>
            <Text style={styles.modalSubtitle}>
              How many guests are boarding without using the app?
            </Text>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Number of Guests</Text>
              <View style={styles.numberInput}>
                <TouchableOpacity
                  style={styles.numberButton}
                  onPress={() => setGuestCount(Math.max(1, guestCount - 1))}
                >
                  <Ionicons name="remove" size={20} color="#007AFF" />
                </TouchableOpacity>
                <Text style={styles.numberDisplay}>{guestCount}</Text>
                <TouchableOpacity
                  style={styles.numberButton}
                  onPress={() =>
                    setGuestCount(
                      Math.min(
                        currentTrip.buses.capacity - passengerCount,
                        guestCount + 1
                      )
                    )
                  }
                >
                  <Ionicons name="add" size={20} color="#007AFF" />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setShowGuestModal(false);
                  setGuestCount(1);
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton]}
                onPress={addGuestPassenger}
              >
                <Text style={styles.confirmButtonText}>Add Guests</Text>
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
                  ` (+${notificationData.count - 1} guest${
                    notificationData.count > 2 ? "s" : ""
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
          </View>        )}
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
  },  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f2f2f7",
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
  },header: {
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
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#fff",
    marginLeft: 12,
  },
  headerSubtitle: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.8)",
    fontWeight: "500",
  },  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  emptyStateIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#F0F8FF",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
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
  },  countTotal: {
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
  },  progressBar: {
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
  },  guestButton: {
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
  },  passengersSection: {
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
  },  passengerContact: {
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
  },  scannerHeader: {
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
  },  scannerFrame: {
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
  },  notificationContainer: {
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
  },  notificationIcon: {
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
  },  notificationTitle: {
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
  },showRequestsButton: {
    backgroundColor: "#007AFF",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 20,
    marginBottom: 16,
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    gap: 8,
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
  },  modalHeader: {
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
  },  locationInfo: {
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
  },  viewMapButton: {
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
  map: {
    flex: 1,
  },
  cardShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },  buttonShadow: {
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
  },  acceptButtonGlow: {
    position: "absolute",
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    backgroundColor: "rgba(52, 199, 89, 0.3)",
    borderRadius: 18,
    zIndex: -1,
  },
});

export default ConductorScreen;
