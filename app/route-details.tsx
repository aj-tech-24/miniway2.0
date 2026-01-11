import SafeText from "@/components/SafeText";
import { mapDarkStyle } from "@/constants/mapDarkStyle";
import { useAuth } from "@/contexts/AuthContext";
import { useAppTheme } from "@/contexts/ThemeContext";
import { useThemeColor } from "@/hooks/useThemeColor";
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

const AvailableSeatsColor = (seats: number) => {
  if (seats > 5) return "#4CAF50";
  if (seats > 2) return "#FFC107";
  return "#FF5252";
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
              pitch: 90,
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

  // Get user location on mount
  useEffect(() => {
    const getUserLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          console.log("Location permission denied");
          return;
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setUserLocation(location);
      } catch (error) {
        console.error("Error getting user location:", error);
      }
    };

    getUserLocation();
  }, []);

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
      console.error("Error refreshing data:", err);
      setError("Failed to refresh data. Please try again.");
    } finally {
      setRefreshing(false);
    }
  }; // Real-time updates
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
                  mapRef.current?.animateCamera(
                    {
                      center: newLoc,
                      zoom: 17,
                      pitch: 70,
                      heading: 0,
                    },
                    { duration: 1000 }
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

  // Restore waiting state if requested
  useEffect(() => {
    const restoreState = async () => {
      if (params.restorePickupRequestId && nearestRoute) {
        console.log("Restoring pickup request state:", params.restorePickupRequestId);
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
            console.error("Error fetching restored request:", error);
            return;
          }

          if (request.status !== 'pending') {
            console.log("Restored request is not pending:", request.status);
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
          console.error("Error restoring state:", e);
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
      console.log("MapRef current:", mapRef.current);

      if (bus.location) {
        // If bus has live location, focus on it
        console.log("Focusing on bus location:", bus.location); // Use animateCamera for better control over zoom and pitch
        if (mapRef.current) {
          mapRef.current.animateCamera(
            {
              center: {
                latitude: bus.location.latitude,
                longitude: bus.location.longitude,
              },
              zoom: 17,
              pitch: 70,
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
        console.log("Focusing on fallback location:", fallbackLocation);
        if (mapRef.current) {
          mapRef.current.animateCamera(
            {
              center: {
                latitude: fallbackLocation.latitude,
                longitude: fallbackLocation.longitude,
              },
              zoom: 17,
              pitch: 70,
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
            zoom: 17,
            pitch: 70,
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
          console.error("Error creating trip:", createError);
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

      console.log("Existing trip_passengers record check:", {
        existingRecord: existingTripPassenger,
        error: checkError,
        busId: selectedBus.id,
        passengerId: session.user.id,
        tripId: tripId,
      });

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
          strokeWidth={6}
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
                source={require("../assets/images/end-route.png")}
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
            <View style={styles.userMarkerContainer}>
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
          const markerCoordinate = bus.location || fallbackLocation;
          const availableSeats =
            typeof bus.capacity === "number" &&
              typeof bus.passengers === "number"
              ? Math.max(bus.capacity - bus.passengers, 0)
              : 0;

          if (!markerCoordinate) return null;

          return (
            <Marker
              key={bus.id}
              coordinate={markerCoordinate}
              title={`Bus ${bus.plate_number}`}
              description={
                bus.location
                  ? `${availableSeats} seats available • Tap to select`
                  : "No live location"
              }
              onPress={() => handleBusSelect(bus)}
            >
              <View style={styles.busMarkerContainer}>
                <Image
                  source={require("../assets/images/bus-icon.png")}
                  style={styles.busMarkerIcon}
                  resizeMode="contain"
                />
                <View
                  style={[
                    styles.busMarkerPointer,
                    { borderTopColor: isActive ? "#28a745" : "#dc3545" },
                  ]}
                />
              </View>
            </Marker>
          );
        })}
      </MapView>

      {/* Enhanced Header with Route Info */}
      <View style={styles.headerContainer}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={24} color="#007AFF" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>Route Details</Text>
          <Text style={styles.headerSubtitle}>
            {nearestRoute?.name || "Loading..."}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onRefresh}
          style={[styles.refreshButton, refreshing && styles.refreshingButton]}
          disabled={refreshing}
          activeOpacity={0.7}
        >
          <Ionicons
            name="refresh"
            size={20}
            color={refreshing ? "#6c757d" : "#007AFF"}
            style={refreshing ? { transform: [{ rotate: "180deg" }] } : {}}
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

      {/* Enhanced Bottom Panel */}
      <View style={styles.bottomPanel}>
        {showPickupSelection ? (
          <View>
            <SafeText style={styles.panelTitle}>
              Set Your Pickup Location
            </SafeText>
            <SafeText style={styles.panelSubtitle}>
              Selected Bus: {selectedBus?.plate_number || "Unknown"}
            </SafeText>
            <SafeText style={styles.panelInstruction}>
              Tap on the map or use your current location.
            </SafeText>

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
                      Available seats:
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
                <Text style={[styles.buttonText, { color: "#333" }]}>Cancel</Text>
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
              <SafeText style={[styles.routeName, { color: textColor }]}>
                Route: {nearestRoute?.name || "Unknown Route"}
              </SafeText>
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
            <SafeText style={styles.panelTitle}>
              Available Buses (
              {buses.filter((bus) => bus.status === "active").length || 0})
            </SafeText>
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
          </>
        )}
      </View>

      {/* Enhanced Bus Details Modal */}
      <Modal
        visible={showBusModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowBusModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContentCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderIcon}>
                <Ionicons name="bus" size={32} color="#007AFF" />
              </View>
              <Text style={styles.modalTitle}>Minibus Details</Text>
              <Text style={styles.modalSubtitle}>Vehicle Information</Text>
            </View>

            <View style={styles.modalBody}>
              <View style={styles.detailRow}>
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Plate Number</Text>
                  <Text style={styles.detailValue}>{modalBus?.plate_number}</Text>
                </View>
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Status</Text>
                  <Text style={[styles.detailValue, { color: modalBus?.status === 'active' ? '#4CAF50' : '#FF5252' }]}>
                    {modalBus?.status === 'active' ? 'Active' : 'Inactive'}
                  </Text>
                </View>
              </View>

              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Driver</Text>
                <View style={styles.driverRow}>
                  <Ionicons name="person-circle" size={36} color="#007AFF" />
                  <Text style={styles.driverValue}>{modalBus?.driver?.fullName || "No driver assigned"}</Text>
                </View>
              </View>

              <View style={styles.detailSection}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={styles.detailLabel}>Capacity</Text>
                  <Text style={styles.seatCountValue}>
                    <Text style={{ color: '#007AFF', fontWeight: 'bold' }}>
                      {typeof modalBus?.capacity === 'number' && typeof modalBus?.passengers === 'number'
                        ? Math.max(modalBus.capacity - modalBus.passengers, 0)
                        : '?'}
                    </Text>
                    /{modalBus?.capacity ?? "N/A"} seats available
                  </Text>
                </View>
                <View style={styles.modalCapacityBarBg}>
                  <View
                    style={[
                      styles.modalCapacityBarFill,
                      {
                        width: modalBus?.capacity && modalBus?.passengers
                          ? `${(modalBus.passengers / modalBus.capacity) * 100}%`
                          : '0%',
                        backgroundColor: '#007AFF'
                      }
                    ]}
                  />
                </View>
              </View>
            </View>

            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={[styles.actionButton, styles.cancelButton]}
                onPress={() => setShowBusModal(false)}
              >
                <Text style={[styles.buttonText, { color: "#333" }]}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  styles.confirmButton,
                  modalBus?.status !== "active" && styles.disabledButton,
                ]}
                onPress={() => {
                  if (modalBus?.status === "active") {
                    setShowBusModal(false);
                    handleBusSelect(modalBus);
                  }
                }}
                disabled={modalBus?.status !== "active"}
              >
                <Text style={styles.buttonText}>Select Bus</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" style={{ marginLeft: 8 }} />
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
                    Pickup:
                    {waitingPickupRequest.pickupLocation.latitude.toFixed(4)},
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
    backgroundColor: '#fff',
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
    top: 50,
    left: 20,
    right: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  backButton: {
    backgroundColor: "rgba(0, 122, 255, 0.1)",
    padding: 10,
    borderRadius: 20,
    elevation: 2,
    shadowColor: "#007AFF",
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  headerInfo: {
    flex: 1,
    alignItems: "center",
    marginHorizontal: 16,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#007AFF",
    marginBottom: 2,
  },
  headerSubtitle: {
    fontSize: 13,
    color: "#666",
    fontWeight: "500",
  },
  refreshButton: {
    backgroundColor: "rgba(0, 122, 255, 0.1)",
    padding: 10,
    borderRadius: 20,
    elevation: 2,
    shadowColor: "#007AFF",
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  refreshingButton: {
    backgroundColor: "rgba(108, 117, 125, 0.1)",
  },
  errorBanner: {
    position: "absolute",
    top: 140,
    left: 20,
    right: 20,
    backgroundColor: "#ffebee",
    borderColor: "#f8bbd9",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    elevation: 8,
    shadowColor: "#dc3545",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
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
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0, 0, 0, 0.08)",
  },
  routeName: {
    fontSize: 16,
    fontWeight: "700",
    flex: 1,
    letterSpacing: -0.2,
  },
  refreshButtonSmall: {
    padding: 10,
    borderRadius: 22,
    backgroundColor: "rgba(0, 122, 255, 0.12)",
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  bottomPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#ffffff",
    padding: 24,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    elevation: 24,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    borderTopWidth: 1,
    borderTopColor: "rgba(0, 0, 0, 0.05)",
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 16,
    color: "#1a1a1a",
    letterSpacing: -0.3,
  },
  panelSubtitle: {
    fontSize: 15,
    color: "#666",
    marginBottom: 12,
    fontWeight: "500",
  },
  panelInstruction: {
    fontSize: 15,
    color: "#444",
    textAlign: "center",
    marginBottom: 18,
    lineHeight: 21,
    fontWeight: "400",
  },
  // New Enhanced Bus Card Styles
  busCard: {
    width: 200,
    marginRight: 16,
    borderRadius: 20,
    padding: 16,
    justifyContent: 'space-between',
    minHeight: 140,
  },
  busCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  busIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  busPlate: {
    fontWeight: "700",
    fontSize: 18,
    letterSpacing: 0.5,
  },
  busStatusText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  busCardBody: {
    marginBottom: 12,
    gap: 6,
  },
  busInfoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  busInfoText: {
    fontSize: 13,
    color: '#555',
    fontWeight: '500',
    flex: 1,
  },

  noBusesContainer: {
    alignItems: "center",
    padding: 24,
    width: 300,
    backgroundColor: "#f8f9fa",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.05)",
    borderStyle: 'dashed',
    marginLeft: 4,
  },
  noBusesIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#eee',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  noBusesText: {
    color: "#333",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  noBusesSubtext: {
    color: "#888",
    fontSize: 13,
  },

  // Modal Content Card Style
  modalContentCard: {
    backgroundColor: "#fff",
    borderRadius: 28,
    padding: 0,
    width: "90%",
    maxWidth: 400,
    elevation: 24,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    overflow: 'hidden',
  },
  modalHeader: {
    alignItems: 'center',
    paddingVertical: 24,
    backgroundColor: '#F8F9FA',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  modalHeaderIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#1a1a1a",
    letterSpacing: -0.5,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  modalBody: {
    padding: 24,
    gap: 24,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  detailItem: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 12,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '600',
    marginBottom: 6,
  },
  detailValue: {
    fontSize: 16,
    color: '#333',
    fontWeight: '700',
  },
  detailSection: {},
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  driverValue: {
    fontSize: 16,
    color: '#333',
    fontWeight: '600',
  },
  seatCountValue: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  modalCapacityBarBg: {
    height: 10,
    backgroundColor: '#F0F0F0',
    borderRadius: 5,
    overflow: 'hidden',
  },
  modalCapacityBarFill: {
    height: '100%',
    borderRadius: 5,
  },

  modalButtonRow: {
    flexDirection: "row",
    padding: 24,
    paddingTop: 0,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: 'center',
    flexDirection: 'row',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  cancelButton: {
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowOpacity: 0,
    elevation: 0,
  },
  confirmButton: {
    backgroundColor: "#007AFF",
    shadowColor: "#007AFF",
  },
  disabledButton: {
    backgroundColor: "#B0C4DE",
    opacity: 0.7,
    shadowOpacity: 0.05,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
  // Override for cancel button text
  cancelButtonText: {
    color: '#333',
  },

  // ... other existing styles ...
  capacityBar: {
    height: 6,
    backgroundColor: "#F0F0F0",
    borderRadius: 3,
    marginTop: 10,
    marginBottom: 4,
    width: "100%",
    overflow: "hidden",
  },
  capacityFill: {
    height: "100%",
    borderRadius: 3,
  },
  passengerCountContainer: {
    backgroundColor: "#f8f9fa",
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.05)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
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
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
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

  // Bus Marker Styles
  busMarkerContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  busMarkerIcon: {
    width: 50,
    height: 50,
  },
  busMarkerPointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 10,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  // Enhanced Marker Styles
  destinationMarkerContainer: {
    alignItems: "center",
    justifyContent: "flex-end",
    height: 50,
    width: 50,
  },
  destinationMarkerHead: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FF4B4B",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  }, destinationMarkerPoint: {
    width: 0,
    height: 0,
    backgroundColor: "transparent",
    borderStyle: "solid",
    borderTopWidth: 8,
    borderRightWidth: 4,
    borderBottomWidth: 0,
    borderLeftWidth: 4,
    borderTopColor: "#FF4B4B",
    borderRightColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: "transparent",
    marginTop: -2,
  },
  destinationIcon: {
    width: 44,
    height: 44,
    zIndex: 2,
  },
  pickupMarkerContainer: {
    alignItems: "center",
    justifyContent: "flex-end",
    height: 50,
    width: 50,
  },
  pickupMarkerHead: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#34C759",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  },
  pickupMarkerPoint: {
    width: 0,
    height: 0,
    backgroundColor: "transparent",
    borderStyle: "solid",
    borderTopWidth: 8,
    borderRightWidth: 4,
    borderBottomWidth: 0,
    borderLeftWidth: 4,
    borderTopColor: "#34C759",
    borderRightColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: "transparent",
    marginTop: -2,
  },
  userMarkerContainer: {
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
  },
  userLocationDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#007AFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  },
  userLocationRipple: {
    position: "absolute",
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0, 122, 255, 0.3)",
    borderWidth: 2,
    borderColor: "rgba(0, 122, 255, 0.5)",
  },
  userMarkerIcon: {
    width: 32,
    height: 32,
  },

  // Route Start/End Marker Styles
  routeMarkerContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  routeMarkerIcon: {
    width: 36,
    height: 36,
    zIndex: 2,
  },
  // Waiting Modal Styles (retained)
  waitingModalContent: {
    backgroundColor: "#fff",
    borderRadius: 28,
    padding: 36,
    width: "92%",
    maxWidth: 420,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 16,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.05)",
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 28,
    width: "85%",
    maxWidth: 400,
    elevation: 16,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  // Location Permission Modal
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
  modalText: {
    fontSize: 16,
    color: "#6c757d",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 8,
    marginTop: 10,
  },
  pickupLocationInfo: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#e8f5e8",
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#c8e6c9",
    shadowColor: "#4caf50",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  pickupLocationText: {
    marginLeft: 8,
    fontSize: 15,
    color: "#2e7d32",
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  currentLocationButton: {
    backgroundColor: "#007AFF",
    padding: 16,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
});
