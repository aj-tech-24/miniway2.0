import { mapDarkStyle } from "@/constants/mapDarkStyle";
import { useAuth } from "@/contexts/AuthContext";
import { useAppTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Camera, LatLng, Marker, Polyline } from "react-native-maps";

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
  status: "active" | "inactive";
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
    console.error("Error getting location:", error);
    Alert.alert(
      "Location Error",
      "Unable to get your current location. Please try again or select a location on the map.",
      [{ text: "OK" }]
    );
  } finally {
    setLocationLoading(false);
  }
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
  const [locationLoading, setLocationLoading] = useState(false);
  const mapRef = useRef<MapView>(null);
  const [showBusModal, setShowBusModal] = useState(false);
  const [modalBus, setModalBus] = useState<Bus | null>(null);

  // Enhanced UX states
  const [isSubmittingPickup, setIsSubmittingPickup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showLocationPermissionAlert, setShowLocationPermissionAlert] =
    useState(false);
  const [showWaitingModal, setShowWaitingModal] = useState(false);
  const [waitingPickupRequest, setWaitingPickupRequest] = useState<any>(null);
  const [passengerCount, setPassengerCount] = useState(1);

  const originCoords: LatLng = {
    latitude: parseFloat((params.originLat as string) || "0"),
    longitude: parseFloat((params.originLng as string) || "0"),
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
          console.log("Fetching route directly by ID:", routeId);

          // Fetch the route directly by ID with its actual path data using the existing function
          const { data: routeData, error: routeError } = await supabase.rpc(
            "get_route_geojson",
            { route_id: routeId }
          );

          if (routeError) {
            console.error("Route fetch error:", routeError);
            throw routeError;
          }

          if (!routeData) {
            console.error("Route not found with ID:", routeId);
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
            console.log("Using stored route geojson from database");
            routePath = rawRoute.geojson;
          } else {
            // Fallback to direct line if no geojson data
            console.log(
              "No stored route geojson, using direct line from origin to destination"
            );
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
            setInitialCamera({
              center: startPoint,
              pitch: 80,
              heading: heading,
              zoom: 14,
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
              driver:users (
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
            console.log(
              "Using origin and destination coordinates for best route path"
            );
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
            setInitialCamera({
              center: startPoint,
              pitch: 80,
              heading: heading,
              zoom: 14,
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
            driver:users (
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
        console.error("Error fetching data:", err);
        setError(
          "Failed to load route information. Please check your connection and try again."
        );
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [destCoords.latitude, destCoords.longitude, params.routeId]);

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
              driver:users (
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
      console.error("Error refreshing data:", err);
      setError("Failed to refresh data. Please try again.");
    } finally {
      setRefreshing(false);
    }
  };

  // Real-time updates
  useEffect(() => {
    if (!buses || buses.length === 0) return;
    const busIds = buses.map((bus) => bus.id);
    const channel = supabase
      .channel("realtime-trips")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "trips",
          filter: `bus_id=in.(${busIds.join(",")})`,
        },
        async (payload) => {
          const updatedTrip = payload.new as any;
          let driverProfile = null;
          if (updatedTrip.driver_id) {
            const { data } = await supabase
              .from("users")
              .select("id, fullName")
              .eq("id", updatedTrip.driver_id)
              .single();
            driverProfile = data;
          }
          setBuses((prev) =>
            prev.map((bus) => {
              if (bus.id === updatedTrip.bus_id) {
                const newLoc = updatedTrip.current_location?.coordinates
                  ? {
                      latitude: updatedTrip.current_location.coordinates[1],
                      longitude: updatedTrip.current_location.coordinates[0],
                    }
                  : null;
                if (selectedBus?.id === updatedTrip.bus_id && newLoc) {
                  mapRef.current?.animateToRegion(
                    { ...newLoc, latitudeDelta: 0.01, longitudeDelta: 0.01 },
                    1000
                  );
                }
                return {
                  ...bus,
                  status: updatedTrip.status,
                  location: newLoc,
                  driver: driverProfile,
                };
              }
              return bus;
            })
          );
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [buses, selectedBus]);

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
    if (bus.location) {
      mapRef.current?.animateToRegion({
        ...bus.location,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      });
    }
  };

  const handleUseCurrentLocation = () => {
    getCurrentLocation(
      (location) => {
        setPickupLocation(location);
        mapRef.current?.animateToRegion({
          ...location,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });
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
        console.error("Error fetching user profile:", profileError);
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
          `Cannot request ${passengerCount} seats. Only ${
            selectedBus.capacity - selectedBus.passengers
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
          console.error("Error creating trip:", createError);
          setError(
            "Unable to create a trip for this bus. Please try again or contact support."
          );
          return;
        }

        tripId = newTrip.id;
      } else {
        tripId = existingTrip.id;
      }

      // Check if trip_passengers record already exists
      const { data: existingTripPassenger, error: checkError } = await supabase
        .from("trip_passengers")
        .select("id, status")
        .eq("bus_id", selectedBus.id)
        .eq("passenger_id", session.user.id)
        .eq("trip_id", tripId)
        .maybeSingle();

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
          console.error("Error updating trip_passengers record:", updateError);
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
          console.error(
            "Error creating trip_passengers record:",
            tripPassengerError
          );
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
        console.error("Error creating pickup request:", pickupError);
        setError("Failed to create pickup request. Please try again.");
        return;
      }

      console.log("Pickup request created successfully:", pickupRequest);

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
      console.error("Error in handleConfirmPickup:", error);
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
    console.log(
      "Starting to listen for pickup request response:",
      pickupRequestId
    );

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
          console.log("Pickup request status updated:", payload);
          const newStatus = payload.new.status;

          if (newStatus === "accepted") {
            console.log(
              "Pickup request accepted! Navigating to trip screen..."
            );

            // Close waiting modal
            setShowWaitingModal(false);
            setWaitingPickupRequest(null);

            // Navigate directly to trip screen
            console.log(
              "Navigating to trip with passenger count:",
              passengerCount
            );
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
            supabase.removeChannel(pickupChannel);
            supabase.removeChannel(tripPassengerChannel);
          } else if (newStatus === "declined") {
            console.log("Pickup request declined by driver");

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
                    supabase.removeChannel(pickupChannel);
                    supabase.removeChannel(tripPassengerChannel);
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
          console.log("Trip passenger status updated:", payload);
          const newStatus = payload.new.status;

          if (newStatus === "boarded") {
            console.log("Passenger boarded! Navigating to trip screen...");

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
            supabase.removeChannel(pickupChannel);
            supabase.removeChannel(tripPassengerChannel);
          } else if (newStatus === "cancelled") {
            console.log("Trip cancelled by driver");
            Alert.alert(
              "Trip Cancelled",
              "The driver has cancelled your trip. Please try selecting another bus.",
              [
                {
                  text: "OK",
                  onPress: () => {
                    supabase.removeChannel(pickupChannel);
                    supabase.removeChannel(tripPassengerChannel);
                  },
                },
              ]
            );
          }
        }
      );

    // Subscribe to both channels
    pickupChannel.subscribe((status) => {
      console.log("Pickup request channel subscription status:", status);
      if (status === "SUBSCRIBED") {
        console.log("✅ Successfully subscribed to pickup request updates");
      } else if (status === "CHANNEL_ERROR") {
        console.error("❌ Failed to subscribe to pickup request updates");
      }
    });

    tripPassengerChannel.subscribe((status) => {
      console.log("Trip passenger channel subscription status:", status);
      if (status === "SUBSCRIBED") {
        console.log("✅ Successfully subscribed to trip passenger updates");
      } else if (status === "CHANNEL_ERROR") {
        console.error("❌ Failed to subscribe to trip passenger updates");
      }
    });

    // Fallback: Poll for pickup request status every 3 seconds as backup
    const pollInterval = setInterval(async () => {
      try {
        console.log("Polling for pickup request status...");
        const { data: requestData, error } = await supabase
          .from("pickup_requests")
          .select("status")
          .eq("id", pickupRequestId)
          .single();

        if (error) {
          console.error("Error polling pickup request:", error);
          return;
        }

        if (requestData) {
          console.log("Polled pickup request status:", requestData.status);

          if (requestData.status === "accepted") {
            console.log(
              "Pickup request accepted via polling! Navigating to trip screen..."
            );
            clearInterval(pollInterval);

            // Close waiting modal
            setShowWaitingModal(false);
            setWaitingPickupRequest(null);

            // Navigate directly to trip screen
            console.log(
              "Navigating to trip with passenger count:",
              passengerCount
            );
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
            supabase.removeChannel(pickupChannel);
            supabase.removeChannel(tripPassengerChannel);
          } else if (requestData.status === "declined") {
            console.log("Pickup request declined via polling");
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
                    supabase.removeChannel(pickupChannel);
                    supabase.removeChannel(tripPassengerChannel);
                  },
                },
              ]
            );
          }
        }
      } catch (error) {
        console.error("Error in polling interval:", error);
      }
    }, 3000); // Poll every 3 seconds

    // Clean up polling interval when channels are unsubscribed
    const originalRemoveChannel = supabase.removeChannel;
    supabase.removeChannel = (channel) => {
      clearInterval(pollInterval);
      return originalRemoveChannel.call(supabase, channel);
    };
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
          We couldn't find a route for your destination. Please try selecting a
          different destination.
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
        provider="google"
        customMapStyle={theme === "dark" ? [...mapDarkStyle] : []}
        style={StyleSheet.absoluteFill}
        pitchEnabled={true}
        initialCamera={initialCamera}
        showsCompass={false}
        onPress={(e) => handlePinLocation(e.nativeEvent.coordinate)}
      >
        <Marker
          coordinate={destCoords}
          title="Your Destination"
          pinColor="red"
        />
        <Polyline
          coordinates={polylineCoords}
          strokeColor="#007AFF"
          strokeWidth={6}
        />

        {pickupLocation && (
          <Marker
            coordinate={pickupLocation}
            title="Your Pickup Spot"
            pinColor="blue"
          />
        )}

        {buses.map((bus) => {
          const isActive = bus.status === "active";
          const isSelected = selectedBus?.id === bus.id;
          const startCoord = nearestRoute.path.coordinates?.[0];
          const fallbackLocation = startCoord
            ? { latitude: startCoord[1], longitude: startCoord[0] }
            : null;
          const markerCoordinate = bus.location || fallbackLocation;

          if (!markerCoordinate) return null;

          return (
            <Marker
              key={bus.id}
              coordinate={markerCoordinate}
              title={bus.plate_number}
              description={
                bus.location
                  ? `Driver: ${bus.driver?.fullName || "N/A"}`
                  : "No live location"
              }
              onPress={() => handleBusSelect(bus)}
            >
              <View
                style={[
                  styles.busMarker,
                  {
                    backgroundColor: isSelected
                      ? "#ffc107"
                      : isActive
                      ? "#28a745"
                      : "#6c757d",
                  },
                ]}
              >
                <Image
                  source={require("@/assets/images/bus-icon.png")}
                  style={styles.busIcon}
                />
              </View>
            </Marker>
          );
        })}
      </MapView>

      <View style={styles.headerContainer}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="black" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onRefresh}
          style={styles.refreshButton}
          disabled={refreshing}
        >
          <Ionicons
            name="refresh"
            size={20}
            color={refreshing ? "#6c757d" : "black"}
          />
        </TouchableOpacity>
      </View>

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

      {/* Bottom Panel */}
      <View style={styles.bottomPanel}>
        {showPickupSelection ? (
          <View>
            <Text style={styles.panelTitle}>Set Your Pickup Location</Text>
            <Text style={styles.panelSubtitle}>
              Selected Bus: {selectedBus?.plate_number}
            </Text>
            <Text style={styles.panelInstruction}>
              Tap on the map or use your current location.
            </Text>

            {pickupLocation && (
              <>
                <View style={styles.pickupLocationInfo}>
                  <Ionicons name="location" size={16} color="#007AFF" />
                  <Text style={styles.pickupLocationText}>
                    Pickup location selected
                  </Text>
                </View>

                <View style={styles.passengerCountContainer}>
                  <Text style={styles.passengerCountLabel}>
                    Number of Passengers:
                  </Text>
                  <View style={styles.passengerCountControls}>
                    <TouchableOpacity
                      style={[
                        styles.passengerCountButton,
                        passengerCount <= 1 ? styles.disabledButton : undefined,
                      ]}
                      onPress={() =>
                        setPassengerCount((prev) => Math.max(1, prev - 1))
                      }
                      disabled={passengerCount <= 1}
                    >
                      <Ionicons name="remove" size={20} color="#fff" />
                    </TouchableOpacity>
                    <Text style={styles.passengerCountText}>
                      {passengerCount}
                    </Text>
                    <TouchableOpacity
                      style={[
                        styles.passengerCountButton,
                        selectedBus &&
                        typeof selectedBus.capacity === "number" &&
                        passengerCount >=
                          selectedBus.capacity - (selectedBus.passengers || 0)
                          ? styles.disabledButton
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
                      <Ionicons name="add" size={20} color="#fff" />
                    </TouchableOpacity>
                  </View>
                  {selectedBus && typeof selectedBus.capacity === "number" && (
                    <Text style={styles.availableSeatsText}>
                      Available seats:{" "}
                      {selectedBus.capacity - (selectedBus.passengers || 0)}
                    </Text>
                  )}
                </View>
              </>
            )}

            <TouchableOpacity
              style={[
                styles.currentLocationButton,
                locationLoading ? styles.disabledButton : undefined,
              ]}
              onPress={handleUseCurrentLocation}
              disabled={locationLoading}
            >
              {locationLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="locate" size={20} color="#fff" />
                  <Text style={styles.buttonText}>Use My Current Location</Text>
                </>
              )}
            </TouchableOpacity>
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.actionButton, styles.cancelButton]}
                onPress={handleCancelPickup}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  styles.confirmButton,
                  (!pickupLocation || isSubmittingPickup) &&
                    styles.disabledButton,
                ]}
                onPress={handleConfirmPickup}
                disabled={!pickupLocation || isSubmittingPickup}
              >
                {isSubmittingPickup ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.buttonText}>Confirm Pickup</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.routeHeader}>
              <Text style={styles.routeName}>Route: {nearestRoute.name}</Text>
              <TouchableOpacity
                onPress={onRefresh}
                style={styles.refreshButtonSmall}
                disabled={refreshing}
              >
                <Ionicons
                  name="refresh"
                  size={16}
                  color={refreshing ? "#6c757d" : "#007AFF"}
                />
              </TouchableOpacity>
            </View>
            <Text style={styles.panelTitle}>
              Available Buses (
              {buses.filter((bus) => bus.status === "active").length})
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
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
                        backgroundColor: isActive ? "#fff" : "#f8d7da",
                        borderColor: isSelected ? "#007AFF" : "#ddd",
                        shadowColor: isSelected ? "#007AFF" : "#000",
                        shadowOpacity: isSelected ? 0.2 : 0.08,
                        shadowRadius: 8,
                        elevation: isSelected ? 6 : 2,
                      },
                    ]}
                    onPress={() => {
                      setModalBus(bus);
                      setShowBusModal(true);
                    }}
                    disabled={!isActive}
                  >
                    <Text style={styles.busPlate}>{bus.plate_number}</Text>
                    <View style={styles.busInfoRow}>
                      <Ionicons name="person" size={16} color="#007AFF" />
                      <Text style={styles.driverName}>
                        {bus.driver ? bus.driver.fullName : "No driver"}
                      </Text>
                    </View>
                    <View style={styles.busInfoRow}>
                      <Ionicons
                        name="people"
                        size={16}
                        color={availableSeats > 0 ? "#28a745" : "#dc3545"}
                      />
                      <Text
                        style={[
                          styles.seatText,
                          { color: availableSeats > 0 ? "#28a745" : "#dc3545" },
                        ]}
                      >
                        {availableSeats} / {bus.capacity || "?"} seats
                      </Text>
                    </View>
                    {availableSeats > 0 && (
                      <View style={styles.capacityBar}>
                        <View
                          style={[
                            styles.capacityFill,
                            {
                              width: `${
                                ((bus.passengers || 0) / (bus.capacity || 1)) *
                                100
                              }%`,
                              backgroundColor:
                                availableSeats > 5
                                  ? "#28a745"
                                  : availableSeats > 2
                                  ? "#ffc107"
                                  : "#dc3545",
                            },
                          ]}
                        />
                      </View>
                    )}
                    <Text
                      style={{
                        color: isActive ? "#28a745" : "#dc3545",
                        fontWeight: "bold",
                        fontSize: 13,
                        marginTop: 4,
                      }}
                    >
                      {isActive ? "Active" : "Inactive"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {buses.length === 0 && (
                <View style={styles.noBusesContainer}>
                  <Ionicons name="bus" size={48} color="#6c757d" />
                  <Text style={styles.noBusesText}>
                    No buses currently available on this route.
                  </Text>
                  <Text style={styles.noBusesSubtext}>
                    Check back later or try refreshing.
                  </Text>
                </View>
              )}
            </ScrollView>
          </>
        )}
      </View>

      {/* Bus Details Modal */}
      <Modal
        visible={showBusModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowBusModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Bus Details</Text>
            <Text style={styles.modalLabel}>Plate Number:</Text>
            <Text style={styles.modalValue}>{modalBus?.plate_number}</Text>
            <Text style={styles.modalLabel}>Driver:</Text>
            <Text style={styles.modalValue}>
              {modalBus?.driver?.fullName || "No driver"}
            </Text>
            <Text style={styles.modalLabel}>Capacity:</Text>
            <Text style={styles.modalValue}>{modalBus?.capacity ?? "N/A"}</Text>
            <Text style={styles.modalLabel}>Status:</Text>
            <Text
              style={[
                styles.modalValue,
                {
                  color: modalBus?.status === "active" ? "#28a745" : "#6c757d",
                },
              ]}
            >
              {modalBus?.status === "active" ? "Active" : "Inactive"}
            </Text>
            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={[styles.actionButton, styles.cancelButton]}
                onPress={() => setShowBusModal(false)}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  styles.confirmButton,
                  modalBus?.status !== "active" && styles.disabledButton,
                ]}
                onPress={() => {
                  if (modalBus?.status === "active") {
                    setSelectedBus(modalBus);
                    setShowPickupSelection(true);
                    setShowBusModal(false);
                    if (modalBus.location) {
                      mapRef.current?.animateToRegion(
                        {
                          ...modalBus.location,
                          latitudeDelta: 0.01,
                          longitudeDelta: 0.01,
                        },
                        1000
                      );
                    }
                  }
                }}
                disabled={modalBus?.status !== "active"}
              >
                <Text style={styles.buttonText}>Select Bus</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Waiting for Approval Modal */}
      <Modal
        visible={showWaitingModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          // Don't allow closing the modal - user must wait for response
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.waitingModalContent}>
            <View style={styles.waitingHeader}>
              <Ionicons name="time" size={48} color="#FF9500" />
              <Text style={styles.waitingTitle}>
                Waiting for Driver Approval
              </Text>
            </View>

            {waitingPickupRequest && (
              <View style={styles.waitingDetails}>
                <View style={styles.waitingInfoRow}>
                  <Ionicons name="bus" size={20} color="#007AFF" />
                  <Text style={styles.waitingInfoText}>
                    Bus: {waitingPickupRequest.busPlateNumber}
                  </Text>
                </View>

                <View style={styles.waitingInfoRow}>
                  <Ionicons name="person" size={20} color="#007AFF" />
                  <Text style={styles.waitingInfoText}>
                    Driver: {waitingPickupRequest.driverName}
                  </Text>
                </View>

                <View style={styles.waitingInfoRow}>
                  <Ionicons name="location" size={20} color="#007AFF" />
                  <Text style={styles.waitingInfoText}>
                    Pickup:{" "}
                    {waitingPickupRequest.pickupLocation.latitude.toFixed(4)},{" "}
                    {waitingPickupRequest.pickupLocation.longitude.toFixed(4)}
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.waitingStatus}>
              <ActivityIndicator size="large" color="#FF9500" />
              <Text style={styles.waitingStatusText}>
                Your pickup request has been sent to the driver.
              </Text>
              <Text style={styles.waitingStatusSubtext}>
                Please wait for them to accept or decline your request.
              </Text>
            </View>

            <View style={styles.waitingFooter}>
              <Text style={styles.waitingFooterText}>
                You will be notified as soon as the driver responds.
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

// --- Styles ---
const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginTop: 16,
    textAlign: "center",
  },
  loadingSubtext: {
    fontSize: 14,
    color: "#6c757d",
    marginTop: 8,
    textAlign: "center",
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#dc3545",
    marginTop: 16,
    textAlign: "center",
  },
  errorText: {
    fontSize: 16,
    color: "#6c757d",
    marginTop: 8,
    textAlign: "center",
    lineHeight: 22,
  },
  errorButtonRow: {
    flexDirection: "row",
    marginTop: 24,
    gap: 12,
  },
  goBackButton: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: "#007AFF",
    borderRadius: 8,
  },
  headerContainer: {
    position: "absolute",
    top: 60,
    left: 20,
    right: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  backButton: {
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    padding: 12,
    borderRadius: 25,
    elevation: 5,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  refreshButton: {
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    padding: 12,
    borderRadius: 25,
    elevation: 5,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  errorBanner: {
    position: "absolute",
    top: 120,
    left: 20,
    right: 20,
    backgroundColor: "#f8d7da",
    borderColor: "#f5c6cb",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  errorBannerText: {
    flex: 1,
    color: "#721c24",
    fontSize: 14,
    marginLeft: 8,
    marginRight: 8,
  },
  routeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  routeName: {
    fontSize: 18,
    fontWeight: "bold",
    flex: 1,
  },
  refreshButtonSmall: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: "rgba(0, 122, 255, 0.1)",
  },
  bottomPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "white",
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    elevation: 10,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  panelTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 5 },
  panelSubtitle: { fontSize: 14, color: "#6c757d", marginBottom: 10 },
  panelInstruction: {
    fontSize: 14,
    color: "#333",
    textAlign: "center",
    marginBottom: 15,
  },
  busCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 2,
    marginRight: 10,
    alignItems: "center",
    minWidth: 120,
  },
  busPlate: { fontWeight: "bold", fontSize: 16 },
  driverName: { fontSize: 14, color: "#333", marginVertical: 2 },
  noBusesContainer: {
    alignItems: "center",
    padding: 20,
    minWidth: 200,
  },
  noBusesText: {
    fontStyle: "italic",
    color: "#6c757d",
    textAlign: "center",
    marginTop: 8,
    fontSize: 16,
  },
  noBusesSubtext: {
    color: "#6c757d",
    textAlign: "center",
    marginTop: 4,
    fontSize: 14,
  },
  modalText: {
    fontSize: 16,
    color: "#6c757d",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 8,
  },
  busMarker: {
    padding: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "white",
  },
  busIcon: { width: 20, height: 20 },
  pickupLocationInfo: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#e3f2fd",
    padding: 8,
    borderRadius: 6,
    marginBottom: 10,
  },
  pickupLocationText: {
    marginLeft: 6,
    fontSize: 14,
    color: "#007AFF",
    fontWeight: "500",
  },
  currentLocationButton: {
    backgroundColor: "#007AFF",
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  actionButton: {
    flex: 1,
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
  },
  cancelButton: {
    backgroundColor: "#6c757d",
    marginRight: 10,
  },
  confirmButton: {
    backgroundColor: "#28a745",
  },
  disabledButton: {
    backgroundColor: "#a5d6a7",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 24,
    width: "80%",
    elevation: 10,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 16,
    color: "#007AFF",
    textAlign: "center",
  },
  modalLabel: {
    fontSize: 15,
    color: "#6c757d",
    marginTop: 8,
  },
  modalValue: {
    fontSize: 16,
    color: "#333",
    fontWeight: "bold",
    marginBottom: 4,
  },
  modalButtonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 18,
  },
  busInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  seatText: {
    marginLeft: 6,
    fontSize: 14,
    color: "#28a745",
    fontWeight: "bold",
  },

  // Waiting Modal Styles
  waitingModalContent: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 32,
    width: "90%",
    maxWidth: 400,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
  },
  waitingHeader: {
    alignItems: "center",
    marginBottom: 24,
  },
  waitingTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#FF9500",
    marginTop: 16,
    textAlign: "center",
  },
  waitingDetails: {
    backgroundColor: "#f8f9fa",
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
  },
  waitingInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  waitingInfoText: {
    fontSize: 16,
    color: "#333",
    marginLeft: 12,
    fontWeight: "500",
  },
  waitingStatus: {
    alignItems: "center",
    marginBottom: 24,
  },
  waitingStatusText: {
    fontSize: 18,
    color: "#333",
    fontWeight: "600",
    marginTop: 16,
    textAlign: "center",
  },
  waitingStatusSubtext: {
    fontSize: 14,
    color: "#666",
    marginTop: 8,
    textAlign: "center",
    lineHeight: 20,
  },
  waitingFooter: {
    alignItems: "center",
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#e5e5e7",
  },
  waitingFooterText: {
    fontSize: 14,
    color: "#8e8e93",
    textAlign: "center",
    fontStyle: "italic",
  },
  capacityBar: {
    height: 4,
    backgroundColor: "#e9ecef",
    borderRadius: 2,
    marginTop: 8,
    marginBottom: 8,
    width: "100%",
    overflow: "hidden",
  },
  capacityFill: {
    height: "100%",
    borderRadius: 2,
  },
  passengerCountContainer: {
    backgroundColor: "#f8f9fa",
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
  },
  passengerCountLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 10,
  },
  passengerCountControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 15,
  },
  passengerCountButton: {
    backgroundColor: "#007AFF",
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  passengerCountText: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
    minWidth: 30,
    textAlign: "center",
  },
  availableSeatsText: {
    fontSize: 14,
    color: "#6c757d",
    textAlign: "center",
    marginTop: 10,
    fontStyle: "italic",
  },
});