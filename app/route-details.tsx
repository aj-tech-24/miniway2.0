import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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
};

type Route = {
  id: string;
  name: string;
  path: {
    type: "LineString";
    coordinates: [number, number][];
  };
};

// Helper function to calculate camera heading
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

export default function RouteDetailsScreen() {
  const params = useLocalSearchParams();
  const [loading, setLoading] = useState(true);
  const [nearestRoute, setNearestRoute] = useState<Route | null>(null);
  const [buses, setBuses] = useState<Bus[]>([]);
  const [selectedBus, setSelectedBus] = useState<Bus | null>(null);
  const [initialCamera, setInitialCamera] = useState<Camera | null>(null);
  const mapRef = useRef<MapView>(null);

  const originCoords: LatLng = {
    latitude: parseFloat((params.originLat as string) || "0"),
    longitude: parseFloat((params.originLng as string) || "0"),
  };

  const destCoords: LatLng = {
    latitude: parseFloat((params.destLat as string) || "0"),
    longitude: parseFloat((params.destLng as string) || "0"),
  };
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
        console.log("Sending to Supabase:", {
          origin: originCoords,
          destination: destCoords,
        });
        const { data: routeData, error: routeError } = await supabase.rpc(
          "find_best_route_for_trip",
          {
            origin_lon: originCoords.longitude,
            origin_lat: originCoords.latitude,
            dest_lon: destCoords.longitude,
            dest_lat: destCoords.latitude,
          }
        );
        console.log(
          "Supabase RPC routeData:",
          routeData,
          "routeError:",
          routeError
        );
        if (routeError) throw routeError;
        if (!routeData || routeData.length === 0) {
          setNearestRoute(null); // Explicitly set to null if not found
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

          // Ensure we set a full Camera object
          setInitialCamera({
            center: startPoint,
            pitch: 80,
            heading: heading,
            zoom: 14,
          });
        }

        // Fetch buses and drivers
        const { data: tripsData, error: tripsError } = await supabase
          .from("trips")
          .select(
            `status, current_location, bus:buses!inner(id, plate_number, route_id), driver:users(id, fullName)`
          )
          .eq("buses.route_id", fetchedRoute.id);

        if (tripsError) throw tripsError;
        if (!Array.isArray(tripsData)) throw new Error("Invalid data.");

        const formattedBuses: Bus[] = tripsData
          .filter((trip) => trip.bus)
          .map((trip: any) => ({
            id: trip.bus.id,
            plate_number: trip.bus.plate_number,
            route_id: trip.bus.route_id,
            status: trip.status || "inactive",
            driver: trip.driver || null,
            location: trip.current_location?.coordinates
              ? {
                  latitude: trip.current_location.coordinates[1],
                  longitude: trip.current_location.coordinates[0],
                }
              : null,
          }));
        setBuses(formattedBuses);
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

  // Real-time useEffect remains the same
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

  const handleBusSelect = (bus: Bus) => {
    setSelectedBus(bus);
    if (bus.location) {
      mapRef.current?.animateCamera(
        {
          center: bus.location,
          pitch: 45,
          zoom: 17,
        },
        { duration: 1000 }
      );
    }
  };

  // --- FIX 2: Restructured loading and error checks ---
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text>Finding route and buses...</Text>
      </View>
    );
  }

  // If loading is finished but we have no route or camera, show the "Not Found" view.
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

  // TypeScript now knows that nearestRoute and initialCamera are not null.
  const polylineCoords = nearestRoute.path.coordinates.map(([lng, lat]) => ({
    latitude: lat,
    longitude: lng,
  }));

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        pitchEnabled={true}
        initialCamera={initialCamera} // This is now guaranteed to be a full Camera object
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
        {buses.map((bus) => {
          if (!bus.location) return null;
          const isActive = bus.status === "active";
          const isSelected = selectedBus?.id === bus.id;
          return (
            <Marker
              key={bus.id}
              coordinate={bus.location}
              title={bus.plate_number}
              description={`Driver: ${bus.driver?.fullName || "N/A"}`}
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

      <View style={styles.bottomPanel}>
        <Text style={styles.routeName}>Nearest Route: {nearestRoute.name}</Text>
        <Text style={styles.panelTitle}>Available Buses</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {buses.map((bus) => (
            <TouchableOpacity
              key={bus.id}
              style={[
                styles.busCard,
                {
                  backgroundColor: bus.status === "active" ? "#fff" : "#e9ecef",
                },
                {
                  borderColor: selectedBus?.id === bus.id ? "#007AFF" : "#ddd",
                },
              ]}
              onPress={() => handleBusSelect(bus)}
            >
              <Text style={styles.busPlate}>{bus.plate_number}</Text>
              <Text style={styles.driverName}>
                {bus.driver ? bus.driver.fullName : "No driver"}
              </Text>
              <Text
                style={{
                  color: bus.status === "active" ? "#28a745" : "#6c757d",
                  fontSize: 12,
                }}
              >
                {bus.status === "active" ? "Active" : "Inactive"}
              </Text>
            </TouchableOpacity>
          ))}
          {buses.length === 0 && (
            <Text style={styles.noBusesText}>
              No buses currently available on this route.
            </Text>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

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
    padding: 15,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    elevation: 10,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  panelTitle: { fontSize: 16, fontWeight: "600", marginBottom: 10 },
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
  busIcon: { width: 24, height: 24 },
});
