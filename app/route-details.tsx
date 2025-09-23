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
  passengers?: number | null;
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
  const mapRef = useRef<MapView>(null);
  const [showBusModal, setShowBusModal] = useState(false);
  const [modalBus, setModalBus] = useState<Bus | null>(null);

  const originCoords: LatLng = {
    latitude: parseFloat((params.originLat as string) || "0"),
    longitude: parseFloat((params.originLng as string) || "0"),
  };
  const destCoords: LatLng = {
    latitude: parseFloat((params.destLat as string) || "0"),
    longitude: parseFloat((params.destLng as string) || "0"),
  };

  // --- Data Fetching and Real-time useEffects (Largely Unchanged) ---
  useEffect(() => {
    if (!destCoords.latitude) {
      Alert.alert("Error", "Missing destination.", [
        { text: "OK", onPress: () => router.back() },
      ]);
      return;
    }
    const findNearestRouteAndBuses = async () => {
      setLoading(true);
      try {
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
          return;
        }
        const fetchedRoute = routeData[0] as Route;
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

        // 1. Get active buses for the route
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

        // 2. Get trips for these buses (status: ongoing or waiting)
        const busIds = busesData.map((bus: any) => bus.id);
        const { data: tripsData, error: tripsError } = await supabase.rpc(
          "get_active_trips_with_geojson",
          { bus_ids: busIds }
        );

        // if (tripsError) throw tripsError;
        // console.log("tripsData:", tripsData);
        // if (Array.isArray(tripsData)) {
        //   tripsData.forEach((trip) => {
        //     console.log(
        //       `Trip bus_id: ${trip.bus_id}, status: ${trip.status}, current_location:`,
        //       trip.current_location
        //     );
        //   });
        // }
        // 3. Map bus to its latest trip location
        const formattedBuses: Bus[] = (busesData ?? []).map((bus: any) => {
          const trip = (tripsData ?? []).find(
            (t: any) =>
              t.bus_id === bus.id &&
              (t.status === "ongoing" || t.status === "waiting")
          );

          let location = null;
          if (trip?.current_location) {
            try {
              const geo = JSON.parse(trip.current_location); // { type: "Point", coordinates: [lng, lat] }
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
        console.log("formattedBuses: ", formattedBuses);
      } catch (err) {
        console.error("Error fetching data:", err);
        Alert.alert("Error", "Failed to fetch route and bus data.", [
          { text: "OK", onPress: () => router.back() },
        ]);
      } finally {
        setLoading(false);
      }
    };
    findNearestRouteAndBuses();
  }, [destCoords.latitude, destCoords.longitude]);

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

  // --- MODIFIED Handlers ---
  const handleBusSelect = (bus: Bus) => {
    if (bus.status !== "active") {
      Alert.alert("Bus Inactive", "This bus is not currently active.");
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

  const handleConfirmPickup = async () => {
    console.log("handleConfirmPickup called with:", {
      pickupLocation,
      selectedBus: selectedBus?.id,
      nearestRoute: !!nearestRoute,
    });

    if (!pickupLocation || !selectedBus || !nearestRoute) {
      console.log("Missing required data:", {
        pickupLocation: !!pickupLocation,
        selectedBus: !!selectedBus,
        nearestRoute: !!nearestRoute,
      });
      return;
    }

    try {
      // First, we need to get or create a trip ID for this bus
      // Check if there's an active trip for this bus
      const { data: existingTrip, error: tripError } = await supabase
        .from("trips")
        .select("id")
        .eq("bus_id", selectedBus.id)
        .eq("status", "waiting")
        .maybeSingle();

      console.log("Existing trip check:", { existingTrip, tripError });

      let tripId;
      if (existingTrip && !tripError) {
        tripId = existingTrip.id;
        console.log("Using existing trip:", tripId);
      } else {
        // Create a new trip if none exists
        console.log("Creating new trip for bus:", selectedBus.id);
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
          Alert.alert("Error", "Failed to create trip. Please try again.");
          return;
        }
        tripId = newTrip.id;
        console.log("Created new trip:", tripId);
      }

      // Navigate to the trip screen with the tripId
      const navigationParams = {
        busId: selectedBus.id,
        busPlateNumber: selectedBus.plate_number,
        tripId: tripId, // Add the tripId
        pickupLat: pickupLocation.latitude.toString(),
        pickupLng: pickupLocation.longitude.toString(),
        destLat: destCoords.latitude.toString(),
        destLng: destCoords.longitude.toString(),
        routePath: JSON.stringify(nearestRoute.path.coordinates),
      };

      console.log("Navigating to trip with params:", navigationParams);

      router.push({
        pathname: "/trip",
        params: navigationParams,
      });

      // Reset state after navigating
      setShowPickupSelection(false);
      setSelectedBus(null);
      setPickupLocation(null);
    } catch (error) {
      console.error("Error in handleConfirmPickup:", error);
      Alert.alert("Error", "Something went wrong. Please try again.");
    }
  };

  const handleCancelPickup = () => {
    setShowPickupSelection(false);
    setSelectedBus(null);
    setPickupLocation(null);
  };

  // --- Loading and Error States (Unchanged) ---
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text>Entering to trip mode...</Text>
      </View>
    );
  }

  if (!nearestRoute || !initialCamera) {
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
        onPress={(e) => handlePinLocation(e.nativeEvent.coordinate)} // Allow pinning location
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

        {/* --- NEW: Marker for the selected pickup location --- */}
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

      <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
        <Ionicons name="arrow-back" size={24} color="black" />
      </TouchableOpacity>

      {/* --- MODIFIED: Conditional Bottom Panel --- */}
      <View style={styles.bottomPanel}>
        {showPickupSelection ? (
          // --- NEW: Pickup Selection UI ---
          <View>
            <Text style={styles.panelTitle}>Set Your Pickup Location</Text>
            <Text style={styles.panelSubtitle}>
              Selected Bus: {selectedBus?.plate_number}
            </Text>
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
        ) : (
          // --- Original Bus List UI ---
          <>
            <Text style={styles.routeName}>
              Nearest Route: {nearestRoute.name}
            </Text>
            <Text style={styles.panelTitle}>Select a Bus</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {buses.map((bus) => {
                const availableSeats =
                  typeof bus.capacity === "number" &&
                  typeof bus.passengers === "number"
                    ? Math.max(bus.capacity - bus.passengers, 0)
                    : "N/A";
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
                        name="checkmark-circle"
                        size={16}
                        color="#28a745"
                      />
                      <Text style={styles.seatText}>
                        {availableSeats} seat{availableSeats === 1 ? "" : "s"}
                        available
                      </Text>
                    </View>
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
                <Text style={styles.noBusesText}>
                  No buses currently available on this route.
                </Text>
              )}
            </ScrollView>
          </>
        )}
      </View>

      {/* --- NEW: Modal for Bus Details --- */}
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
                    // Center the map camera on the bus location
                    if (modalBus.location) {
                      mapRef.current?.animateToRegion(
                        {
                          ...modalBus.location,
                          latitudeDelta: 0.01,
                          longitudeDelta: 0.01,
                        },
                        1000 // animation duration in ms
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
    marginRight: 10,
    alignItems: "center",
    minWidth: 120,
  },
  busPlate: { fontWeight: "bold", fontSize: 16 },
  driverName: { fontSize: 14, color: "#333", marginVertical: 2 },
  noBusesText: { fontStyle: "italic", color: "#6c757d", padding: 10 },
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
});
