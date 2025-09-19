import { mapDarkStyle } from "@/constants/mapDarkStyle";
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

// --- Data Types (Unchanged) ---
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
  passengersOnboard?: number | null;
  availableSeats?: number | null;
};

type Route = {
  id: string;
  name: string;
  path: {
    type: "LineString";
    coordinates: [number, number][];
  };
};

// --- Helper & Location Functions (Unchanged) ---
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
  setLocationLoading: (loading: boolean) => void
) => {
  try {
    setLocationLoading(true);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Location Permission",
        "Location permission is required to use your current location for pickup."
      );
      return;
    }
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    const currentLatLng: LatLng = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    };
    setCurrentLocation(currentLatLng);
  } catch (error) {
    console.error("Error getting location:", error);
    Alert.alert("Error", "Failed to get your current location.");
  } finally {
    setLocationLoading(false);
  }
};

export default function RouteDetailsScreen() {
  const { theme } = useAppTheme();
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
  const [showDestPrompt, setShowDestPrompt] = useState(false);
  const [showBusDetails, setShowBusDetails] = useState(false);
  const [busLocationName, setBusLocationName] = useState<string | null>(null);
  const [busForDetails, setBusForDetails] = useState<Bus | null>(null);
  const [partySize, setPartySize] = useState<number>(1);
  const mapRef = useRef<MapView>(null);

  const routeId = (params.routeId as string) || null;
  const originCoords: LatLng = {
    latitude: parseFloat((params.originLat as string) || "0"),
    longitude: parseFloat((params.originLng as string) || "0"),
  };
  // Parse dest from params safely
  const destLat = Number(params.destLat);
  const destLng = Number(params.destLng);
  const destFromParams: LatLng | null =
    Number.isFinite(destLat) && Number.isFinite(destLng)
      ? { latitude: destLat, longitude: destLng }
      : null;

  // Allow local override to take precedence
  const [destinationLocation, setDestinationLocation] = useState<LatLng | null>(
    null
  );
  const [isChangingDest, setIsChangingDest] = useState(false);
  const [pendingDest, setPendingDest] = useState<LatLng | null>(null);
  const effectiveDest = destinationLocation ?? destFromParams;
  // NEW: Track if we're in "chosen route" mode vs "find nearest route" mode
  const isChosenRouteMode = !!routeId;

  useEffect(() => {
    async function fetchLocationName() {
      if (busForDetails?.location) {
        const [result] = await Location.reverseGeocodeAsync(
          busForDetails.location
        );
        if (result) {
          setBusLocationName(
            `${result.name || ""} ${result.street || ""}, ${result.city || ""}`
          );
        }
      }
    }
    fetchLocationName();
  }, [busForDetails?.location]);

  // --- Data Fetching and Real-time useEffects (MODIFIED) ---
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        if (routeId) {
          // fetch the chosen route directly
          const { data, error } = await supabase
            .from("routes_with_geojson")
            .select("id, name, path")
            .eq("id", routeId)
            .single();

          if (error) throw error;
          const fetchedRoute = data as Route;
          setNearestRoute(fetchedRoute);

          if (fetchedRoute.path?.coordinates?.length >= 2) {
            const coords = fetchedRoute.path.coordinates;
            console.log("route path coords count:", coords.length);
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
              heading,
              zoom: 14,
            });
            const fitCoords = coords.map(([lng, lat]) => ({
              latitude: lat,
              longitude: lng,
            }));
            setTimeout(() => {
              mapRef.current?.fitToCoordinates(fitCoords, {
                edgePadding: { top: 60, left: 40, right: 40, bottom: 260 },
                animated: true,
              });
              mapRef.current?.animateCamera(
                { center: startPoint, heading, pitch: 80, zoom: 15 },
                { duration: 1200 }
              );
            }, 0);
          }

          // load trips for the chosen route
          const { data: tripsData, error: tripsError } = await supabase.rpc(
            "get_trips_for_route",
            { p_route_id: fetchedRoute.id }
          );
          if (tripsError) throw tripsError;
          if (!Array.isArray(tripsData)) throw new Error("Invalid data.");
          const formattedBuses: Bus[] = tripsData.map((trip: any) => ({
            id: trip.bus_id,
            plate_number: trip.plate_number,
            route_id: trip.route_id,
            status: trip.status || "inactive",
            driver: trip.driver_id
              ? { id: trip.driver_id, fullName: trip.fullName }
              : null,
            location: trip.current_location?.coordinates
              ? {
                  latitude: trip.current_location.coordinates[1],
                  longitude: trip.current_location.coordinates[0],
                }
              : null,
            capacity: trip.capacity ?? null,
            passengersOnboard: trip.passengers_onboard ?? null,
            availableSeats:
              typeof trip.capacity === "number" &&
              typeof trip.passengers_onboard === "number"
                ? Math.max(trip.capacity - trip.passengers_onboard, 0)
                : null,
          }));
          setBuses(formattedBuses);

          if (!initialCamera) {
            const firstWithLoc = formattedBuses.find((b) => b.location);
            if (firstWithLoc?.location) {
              setInitialCamera({
                center: firstWithLoc.location,
                pitch: 80,
                heading: 0,
                zoom: 14,
              });
            }
          }
          // Show prompt to set destination when arriving from route list
          if (!effectiveDest) {
            setShowDestPrompt(true);
          }
        } else {
          // original path: compute a route only when we have an effective destination
          if (!effectiveDest) {
            setNearestRoute(null);
            setBuses([]);
            setInitialCamera(null);
            return;
          }
          const { data: routeData, error: routeError } = await supabase.rpc(
            "find_best_route_for_trip",
            {
              origin_lon: originCoords.longitude,
              origin_lat: originCoords.latitude,
              dest_lon: effectiveDest.longitude,
              dest_lat: effectiveDest.latitude,
            }
          );
          if (routeError) throw routeError;
          if (!routeData || routeData.length === 0) {
            setNearestRoute(null);
            setBuses([]);
            setInitialCamera(null);
            return;
          }
          const fetchedRoute = routeData[0] as Route;
          setNearestRoute(fetchedRoute);
          if (fetchedRoute.path?.coordinates?.length >= 2) {
            const coords = fetchedRoute.path.coordinates;
            console.log("route path coords count:", coords.length);
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
              heading,
              zoom: 14,
            });
            // Fit map to the entire route so the polyline is visible
            const fitCoords = coords.map(([lng, lat]) => ({
              latitude: lat,
              longitude: lng,
            }));
            setTimeout(() => {
              mapRef.current?.fitToCoordinates(fitCoords, {
                edgePadding: { top: 60, left: 40, right: 40, bottom: 260 },
                animated: true,
              });
            }, 0);
          }
          const { data: tripsData, error: tripsError } = await supabase.rpc(
            "get_trips_for_route",
            { p_route_id: fetchedRoute.id }
          );
          if (tripsError) throw tripsError;
          if (!Array.isArray(tripsData)) throw new Error("Invalid data.");
          const formattedBuses: Bus[] = tripsData.map((trip: any) => ({
            id: trip.bus_id,
            plate_number: trip.plate_number,
            route_id: trip.route_id,
            status: trip.status || "inactive",
            driver: trip.driver_id
              ? { id: trip.driver_id, fullName: trip.fullName }
              : null,
            location: trip.current_location?.coordinates
              ? {
                  latitude: trip.current_location.coordinates[1],
                  longitude: trip.current_location.coordinates[0],
                }
              : null,
            capacity: trip.capacity ?? null,
            passengersOnboard: trip.passengers_onboard ?? null,
            availableSeats:
              typeof trip.capacity === "number" &&
              typeof trip.passengers_onboard === "number"
                ? Math.max(trip.capacity - trip.passengers_onboard, 0)
                : null,
          }));
          setBuses(formattedBuses);
        }
      } catch (err) {
        console.error("Error fetching data:", err);
        Alert.alert("Error", "Failed to fetch route and bus data.", [
          { text: "OK", onPress: () => router.back() },
        ]);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [routeId]); // MODIFIED: Only depend on routeId, not effectiveDest

  // NEW: Separate effect to handle destination changes when NOT in chosen route mode
  useEffect(() => {
    if (isChosenRouteMode || !effectiveDest) return;

    const findNearestRoute = async () => {
      try {
        const { data: routeData, error: routeError } = await supabase.rpc(
          "find_best_route_for_trip",
          {
            origin_lon: originCoords.longitude,
            origin_lat: originCoords.latitude,
            dest_lon: effectiveDest.longitude,
            dest_lat: effectiveDest.latitude,
          }
        );
        if (routeError) throw routeError;
        if (!routeData || routeData.length === 0) {
          setNearestRoute(null);
          setBuses([]);
          return;
        }
        const fetchedRoute = routeData[0] as Route;
        setNearestRoute(fetchedRoute);

        // Load buses for the found route
        const { data: tripsData, error: tripsError } = await supabase.rpc(
          "get_trips_for_route",
          { p_route_id: fetchedRoute.id }
        );
        if (tripsError) throw tripsError;
        if (!Array.isArray(tripsData)) throw new Error("Invalid data.");
        const formattedBuses: Bus[] = tripsData.map((trip: any) => ({
          id: trip.bus_id,
          plate_number: trip.plate_number,
          route_id: trip.route_id,
          status: trip.status || "inactive",
          driver: trip.driver_id
            ? { id: trip.driver_id, fullName: trip.fullName }
            : null,
          location: trip.current_location?.coordinates
            ? {
                latitude: trip.current_location.coordinates[1],
                longitude: trip.current_location.coordinates[0],
              }
            : null,
        }));
        setBuses(formattedBuses);
      } catch (err) {
        console.error("Error finding nearest route:", err);
      }
    };

    findNearestRoute();
  }, [effectiveDest, isChosenRouteMode]);

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
                    1500
                  );
                }
                return {
                  ...bus,
                  status: updatedTrip.status,
                  location: newLoc,
                  driver: driverProfile,
                  capacity: updatedTrip.capacity ?? bus.capacity ?? null,
                  passengersOnboard:
                    updatedTrip.passengers_onboard ??
                    bus.passengersOnboard ??
                    null,
                  availableSeats:
                    typeof updatedTrip.capacity === "number" &&
                    typeof updatedTrip.passengers_onboard === "number"
                      ? Math.max(
                          updatedTrip.capacity - updatedTrip.passengers_onboard,
                          0
                        )
                      : bus.availableSeats ?? null,
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

  // --- MODIFIED Handlers ---
  const handleBusSelect = (bus: Bus) => {
    if (bus.status !== "active") {
      Alert.alert("Bus Inactive", "This bus is not currently active.");
      return;
    }
    if (typeof bus.availableSeats === "number" && bus.availableSeats <= 0) {
      Alert.alert("Bus is full", "Please choose another bus.");
      return;
    }
    // Validate party size vs availability if known
    if (
      typeof bus.availableSeats === "number" &&
      partySize > bus.availableSeats
    ) {
      Alert.alert(
        "Not enough seats",
        `Only ${bus.availableSeats} seat(s) available on this bus.`
      );
      return;
    }
    setSelectedBus(bus);
    setShowPickupSelection(true); // This triggers the new UI
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
    getCurrentLocation((location) => {
      setPickupLocation(location);
      mapRef.current?.animateToRegion({
        ...location,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    }, setLocationLoading);
  };

  const handlePinLocation = (coordinate: LatLng) => {
    if (showPickupSelection) {
      setPickupLocation(coordinate);
    }
  };

  const handleConfirmPickup = () => {
    if (
      !pickupLocation ||
      !selectedBus ||
      !nearestRoute?.path?.coordinates?.length
    )
      return;
    if (!effectiveDest) {
      Alert.alert("Destination required", "Please set a destination first.");
      return;
    }
    router.push({
      pathname: "/trip",
      params: {
        busId: selectedBus.id,
        busPlateNumber: selectedBus.plate_number,
        pickupLat: pickupLocation.latitude,
        pickupLng: pickupLocation.longitude,
        destLat: effectiveDest.latitude,
        destLng: effectiveDest.longitude,
        routePath: JSON.stringify(nearestRoute.path.coordinates),
        partySize: String(partySize),
      },
    });
    setShowPickupSelection(false);
    setSelectedBus(null);
    setPickupLocation(null);
  };

  const handleCancelPickup = () => {
    setShowPickupSelection(false);
    setSelectedBus(null);
    setPickupLocation(null);
  };

  // NEW: Destination change workflow
  const handleChangeDestination = () => {
    setIsChangingDest(true);
    setPendingDest(effectiveDest ?? null);
    setShowPickupSelection(false);
    setSelectedBus(null);
    setPickupLocation(null);
  };

  const handleCancelDestinationChange = () => {
    setIsChangingDest(false);
    setPendingDest(null);
  };

  const handleConfirmDestinationChange = () => {
    if (!pendingDest) return;
    setDestinationLocation(pendingDest);
    router.setParams({
      destLat: String(pendingDest.latitude),
      destLng: String(pendingDest.longitude),
    });
    setIsChangingDest(false);
  };

  // --- Loading and Error States (Unchanged) ---
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text>Finding route and buses...</Text>
      </View>
    );
  }

  if (!nearestRoute) {
    return (
      <View style={styles.centered}>
        <Text>No nearest route was found.</Text>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.goBackButton}
        >
          <Text style={{ color: "white" }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const polylineCoords =
    nearestRoute?.path?.coordinates?.map(([lng, lat]) => ({
      latitude: lat,
      longitude: lng,
    })) ?? [];
  // console.log("Polyline coords:", polylineCoords);

  const defaultCamera: Camera = {
    center: { latitude: 6.7536, longitude: 125.356 },
    pitch: 80,
    heading: 0,
    zoom: 12,
  };

  return (
    <View style={styles.container}>
      <MapView
        key={`route-${nearestRoute?.id || "none"}`}
        ref={mapRef}
        provider="google"
        customMapStyle={theme === "dark" ? [...mapDarkStyle] : []}
        style={StyleSheet.absoluteFill}
        pitchEnabled={true}
        initialCamera={initialCamera || defaultCamera}
        showsCompass={false}
        onMapReady={() => {
          const coords = nearestRoute?.path?.coordinates;
          if (!coords || coords.length < 2) return;
          const fitCoords = coords.map(([lng, lat]) => ({
            latitude: lat,
            longitude: lng,
          }));
          mapRef.current?.fitToCoordinates(fitCoords, {
            edgePadding: { top: 60, left: 40, right: 40, bottom: 260 },
            animated: false,
          });
          const startPoint = {
            latitude: coords[0][1],
            longitude: coords[0][0],
          };
          const endPoint = {
            latitude: coords[coords.length - 1][1],
            longitude: coords[coords.length - 1][0],
          };
          const heading = calculateBearing(startPoint, endPoint);
          setTimeout(() => {
            mapRef.current?.animateCamera(
              { center: startPoint, heading, pitch: 80, zoom: 15 },
              { duration: 600 }
            );
          }, 50);
        }}
        onLongPress={(e) => {
          // Long-press to start or adjust destination while editing
          const coord = e.nativeEvent.coordinate;
          if (isChangingDest) {
            setPendingDest(coord);
            mapRef.current?.animateToRegion(
              { ...coord, latitudeDelta: 0.01, longitudeDelta: 0.01 },
              300
            );
          }
        }}
        onPress={(e) => {
          const coord = e.nativeEvent.coordinate;
          if (!effectiveDest && !isChangingDest) {
            // first-time set via tap
            setDestinationLocation(coord);
            router.setParams({
              destLat: String(coord.latitude),
              destLng: String(coord.longitude),
            });
            return;
          }
          if (isChangingDest) {
            // tap to adjust while changing
            setPendingDest(coord);
            return;
          }
          // otherwise treat as pickup pinning
          handlePinLocation(coord);
        }}
      >
        {(effectiveDest || destinationLocation) && !isChangingDest && (
          <Marker
            coordinate={(effectiveDest as any) || destinationLocation!}
            title="Your Destination"
            pinColor="red"
          />
        )}
        {isChangingDest && (pendingDest || effectiveDest) && (
          <Marker
            coordinate={(pendingDest as any) || (effectiveDest as any)}
            title="Adjust Destination"
            pinColor="red"
            draggable
            onDragEnd={(e) => setPendingDest(e.nativeEvent.coordinate)}
          />
        )}
        {polylineCoords.length > 0 && (
          <Polyline
            coordinates={polylineCoords}
            strokeColor="#007AFF"
            strokeWidth={8}
            geodesic
          />
        )}

        {/* --- NEW: Marker for the selected pickup location --- */}
        {pickupLocation && (
          <Marker
            coordinate={pickupLocation}
            title="Your Pickup Spot"
            pinColor="blue"
          />
        )}

        {(() => {
          const routeStart = nearestRoute?.path?.coordinates?.[0]
            ? {
                latitude: nearestRoute.path.coordinates[0][1],
                longitude: nearestRoute.path.coordinates[0][0],
              }
            : null;
          const defaultCamera = {
            center: { latitude: 6.7536, longitude: 125.356 },
            pitch: 80,
            heading: 0,
            zoom: 12,
          } as Camera;
          const cameraCenter = initialCamera?.center || defaultCamera.center;

          return buses.map((bus) => {
            const isActive = bus.status === "active";
            const isSelected = selectedBus?.id === bus.id;
            const markerCoordinate = bus.location || routeStart || cameraCenter;

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
          });
        })()}
      </MapView>

      <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
        <Ionicons name="arrow-back" size={24} color="black" />
      </TouchableOpacity>

      {/* Bus Details Modal */}
      <Modal
        transparent
        visible={showBusDetails}
        animationType="fade"
        onRequestClose={() => setShowBusDetails(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Bus Details</Text>
            {busForDetails ? (
              <View style={styles.modalContentContainer}>
                {/* General Bus Info */}
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Plate Number:</Text>
                  <Text style={styles.detailValue}>
                    {busForDetails.plate_number}
                  </Text>
                </View>
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Status:</Text>
                  <Text
                    style={[
                      styles.detailValue,
                      {
                        color:
                          busForDetails.status === "active"
                            ? "#28a745"
                            : "#6c757d",
                      },
                    ]}
                  >
                    {busForDetails.status === "active" ? "Active" : "Inactive"}
                  </Text>
                </View>

                {/* Driver Info */}
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Driver:</Text>
                  <Text style={styles.detailValue}>
                    {busForDetails.driver?.fullName || "No driver assigned"}
                  </Text>
                </View>

                {/* Capacity Info */}
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Capacity:</Text>
                  <Text style={styles.detailValue}>
                    {typeof busForDetails.capacity === "number"
                      ? busForDetails.capacity
                      : "N/A"}
                  </Text>
                </View>
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Passengers Onboard:</Text>
                  <Text style={styles.detailValue}>
                    {typeof busForDetails.passengersOnboard === "number"
                      ? busForDetails.passengersOnboard
                      : "N/A"}
                  </Text>
                </View>
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Available Seats:</Text>
                  <Text
                    style={[
                      styles.detailValue,
                      {
                        color:
                          typeof busForDetails.availableSeats === "number" &&
                          busForDetails.availableSeats <= 0
                            ? "#dc3545" // Red for full
                            : typeof busForDetails.availableSeats ===
                                "number" && busForDetails.availableSeats <= 5
                            ? "#ffc107" // Orange for few seats
                            : "#28a745", // Green for available
                      },
                    ]}
                  >
                    {typeof busForDetails.availableSeats === "number"
                      ? busForDetails.availableSeats
                      : "N/A"}
                  </Text>
                </View>

                {/* Location - optional, can be kept simple or enhanced */}
                <View style={[styles.detailSection, { borderBottomWidth: 0 }]}>
                  <Text style={styles.detailLabel}>Current Location:</Text>
                  <Text style={styles.detailValue}>
                    {busLocationName ? busLocationName : "N/A"}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.modalButton, { marginTop: 20 }]}
                  onPress={() => setShowBusDetails(false)}
                >
                  <Text style={styles.modalButtonText}>Close</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text>No bus selected.</Text>
            )}
          </View>
        </View>
      </Modal>

      {/* --- MODIFIED: Conditional Bottom Panel --- */}
      <View style={styles.bottomPanel}>
        {showDestPrompt && !effectiveDest ? (
          <Modal
            transparent
            visible={showDestPrompt}
            animationType="fade"
            onRequestClose={() => setShowDestPrompt(false)}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>Set your destination</Text>
                <Text style={styles.modalText}>
                  Tap anywhere on the map to drop your destination pin.
                </Text>
                <TouchableOpacity
                  style={styles.modalButton}
                  onPress={() => setShowDestPrompt(false)}
                >
                  <Text style={styles.modalButtonText}>Got it</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        ) : showPickupSelection ? (
          // --- Pickup Selection UI ---
          <View>
            <Text style={styles.panelTitle}>Set Your Pickup Location</Text>
            <Text style={styles.panelSubtitle}>
              Selected Bus: {selectedBus?.plate_number}
            </Text>
            <Text style={styles.panelInstruction}>
              Passengers in your party
            </Text>
            <View style={styles.partyRow}>
              <TouchableOpacity
                style={styles.partyAdjustButton}
                onPress={() => setPartySize((n) => Math.max(1, n - 1))}
              >
                <Text style={styles.partyAdjustText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.partyCount}>{partySize}</Text>
              <TouchableOpacity
                style={styles.partyAdjustButton}
                onPress={() =>
                  setPartySize((n) =>
                    Math.min(
                      10,
                      typeof selectedBus?.availableSeats === "number"
                        ? Math.max(1, selectedBus.availableSeats)
                        : n + 1
                    )
                  )
                }
              >
                <Text style={styles.partyAdjustText}>+</Text>
              </TouchableOpacity>
            </View>
            {typeof selectedBus?.availableSeats === "number" && (
              <Text style={styles.panelSubtitle}>
                Available seats: {selectedBus.availableSeats}
              </Text>
            )}
            <Text style={styles.panelInstruction}>
              Tap on the map or use your current location.
            </Text>
            <TouchableOpacity
              style={styles.currentLocationButton}
              onPress={handleUseCurrentLocation}
              disabled={locationLoading}
            >
              {locationLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Use My Current Location</Text>
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
                  !pickupLocation && styles.disabledButton,
                ]}
                onPress={handleConfirmPickup}
                disabled={!pickupLocation}
              >
                <Text style={styles.buttonText}>Confirm Pickup</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : isChangingDest ? (
          // --- Destination edit UI ---
          <View>
            <Text style={styles.panelTitle}>Adjust Destination</Text>
            <Text style={styles.panelInstruction}>
              Tap or long-press on the map to move the destination pin. Drag the
              pin to fine-tune.
            </Text>
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.actionButton, styles.cancelButton]}
                onPress={handleCancelDestinationChange}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  styles.confirmButton,
                  !pendingDest && styles.disabledButton,
                ]}
                onPress={handleConfirmDestinationChange}
                disabled={!pendingDest}
              >
                <Text style={styles.buttonText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          // --- Bus List UI with Change Destination Option ---
          <>
            <View style={styles.routeHeader}>
              <Text style={styles.routeName}>
                {isChosenRouteMode ? "Selected Route" : "Nearest Route"}:
                {nearestRoute?.name}
              </Text>
            </View>

            {/* Show current destination and change button */}
            {effectiveDest && (
              <View style={styles.destinationSection}>
                <View style={styles.destinationInfo}>
                  <Ionicons name="location" size={16} color="#28a745" />
                  <Text style={styles.destinationText}>Destination set</Text>
                </View>
                <TouchableOpacity
                  style={styles.changeDestButton}
                  onPress={handleChangeDestination}
                >
                  <Ionicons name="create-outline" size={14} color="#007AFF" />
                  <Text style={styles.changeDestText}>Change</Text>
                </TouchableOpacity>
              </View>
            )}

            <Text style={styles.panelTitle}>Select a Bus</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              {buses.map((bus) => {
                const isFull =
                  typeof bus.availableSeats === "number" &&
                  bus.availableSeats <= 0;
                const canShowProgress =
                  typeof bus.capacity === "number" &&
                  typeof bus.passengersOnboard === "number" &&
                  bus.capacity > 0;
                const fillPct = canShowProgress
                  ? Math.min(
                      100,
                      Math.max(
                        0,
                        Math.round(
                          (bus.passengersOnboard! / bus.capacity!) * 100
                        )
                      )
                    )
                  : 0;
                return (
                  <TouchableOpacity
                    key={bus.id}
                    style={[
                      styles.busCard,
                      {
                        backgroundColor:
                          bus.status === "active" ? "#fff" : "#f1f3f5",
                      },
                      {
                        borderColor:
                          selectedBus?.id === bus.id
                            ? "#007AFF"
                            : isFull
                            ? "#dc3545"
                            : "#ddd",
                        opacity: isFull ? 0.9 : 1,
                      },
                    ]}
                    onPress={() => handleBusSelect(bus)}
                    disabled={isFull}
                  >
                    <View style={styles.busHeaderRow}>
                      <Text style={styles.busPlate}>{bus.plate_number}</Text>
                      <View
                        style={[
                          styles.capacityBadge,
                          {
                            backgroundColor: isFull ? "#dc3545" : "#E7F8EF",
                            borderColor: isFull ? "#b02a37" : "#10b981",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.capacityBadgeText,
                            { color: isFull ? "#fff" : "#065f46" },
                          ]}
                        >
                          {isFull
                            ? "Full"
                            : typeof bus.availableSeats === "number"
                            ? `Seats: ${bus.availableSeats}`
                            : "Seats: N/A"}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.driverName}>
                      {bus.driver ? bus.driver.fullName : "No driver"}
                    </Text>
                    <Text style={styles.capacityLabel}>
                      {typeof bus.passengersOnboard === "number" &&
                      typeof bus.capacity === "number"
                        ? `${bus.passengersOnboard}/${bus.capacity} onboard`
                        : "Capacity: N/A"}
                    </Text>
                    {canShowProgress && (
                      <View style={styles.progressBarContainer}>
                        <View
                          style={[
                            styles.progressBarFill,
                            { width: `${fillPct}%` },
                          ]}
                        />
                      </View>
                    )}
                    <Text
                      style={{
                        color: bus.status === "active" ? "#28a745" : "#6c757d",
                        fontSize: 12,
                      }}
                    >
                      {bus.status === "active" ? "Active" : "Inactive"}
                    </Text>
                    <TouchableOpacity
                      style={styles.detailsButton}
                      onPress={() => {
                        setBusForDetails(bus);
                        setShowBusDetails(true);
                      }}
                    >
                      <Text style={styles.detailsButtonText}>Details</Text>
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })}
              {buses.length === 0 && (
                <Text style={styles.noBusesText}>
                  No buses currently available on this route.
                </Text>
              )}
            </ScrollView>
          </>
        )}
      </View>
    </View>
  );
}

// --- ADDED New Styles ---
const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "90%",
    backgroundColor: "white",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    overflow: "hidden", // Prevent content overflow
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 8,
    maxWidth: "100%",
    textAlign: "center", // Center and wrap text
  },
  modalText: {
    fontSize: 14,
    color: "#333",
    textAlign: "center",
    marginBottom: 16,
  },
  modalButton: {
    backgroundColor: "#dc3545",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  modalButtonText: {
    textAlign: "center",
    color: "white",
    fontWeight: "600",
  },
  goBackButton: {
    marginTop: 20,
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: "#007AFF",
    borderRadius: 8,
  },
  backButton: {
    position: "absolute",
    top: 60,
    left: 20,
    backgroundColor: "rgba(255, 255, 255, 0.8)",
    padding: 8,
    borderRadius: 20,
    elevation: 5,
  },
  routeName: {
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 10,
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
    marginRight: 15,
    alignItems: "center",
    width: 200,
    // maxWidth: "100%",
  },
  busPlate: { fontWeight: "bold", fontSize: 16 },
  driverName: { fontSize: 14, color: "#333", marginVertical: 2 },
  noBusesText: { fontStyle: "italic", color: "#6c757d", padding: 10 },
  busHeaderRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  capacityBadge: {
    borderWidth: 1,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  capacityBadgeText: { fontSize: 12, fontWeight: "700" },
  progressBarContainer: {
    width: "100%",
    height: 6,
    backgroundColor: "#e9ecef",
    borderRadius: 6,
    overflow: "hidden",
    marginTop: 4,
    marginBottom: 6,
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: "#10b981",
  },
  busMarker: {
    padding: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "white",
  },
  busIcon: { width: 20, height: 20 },
  currentLocationButton: {
    backgroundColor: "#007AFF",
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 10,
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
  routeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  changeDestButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: "#f8f9fa",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#007AFF",
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  changeDestText: {
    color: "#007AFF",
    fontSize: 13,
    fontWeight: "600",
    marginLeft: 4,
  },
  destinationInfo: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f0f8f0",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 15,
    marginBottom: 12,
    alignSelf: "flex-start",
  },
  destinationText: {
    color: "#28a745",
    fontSize: 12,
    fontWeight: "500",
    marginLeft: 6,
  },
  destinationSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  routeTitleContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  capacityLabel: { fontSize: 12, color: "#333", marginVertical: 2 },
  availableSeatsLabel: { fontSize: 12, color: "#28a745", marginBottom: 4 },
  detailsButton: {
    marginTop: 6,
    backgroundColor: "#007AFF",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  detailsButtonText: { color: "#fff", fontWeight: "600" },
  partyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  partyAdjustButton: {
    width: 36,
    height: 36,
    backgroundColor: "#f1f3f5",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 10,
  },
  partyAdjustText: { fontSize: 20, fontWeight: "700", color: "#333" },
  partyCount: {
    fontSize: 18,
    fontWeight: "700",
    minWidth: 30,
    textAlign: "center",
  },
  modalContentContainer: {
    width: "100%",
    paddingHorizontal: 10,
  },
  detailSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  detailLabel: {
    fontSize: 15,
    fontWeight: "500",
    color: "#555",
    maxWidth: "50%",
    flexShrink: 1,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
    maxWidth: "50%",
    flexShrink: 1,
    textAlign: "right",
  },
});
