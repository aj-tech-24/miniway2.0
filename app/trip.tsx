import { mapDarkStyle } from "@/constants/mapDarkStyle";
import { useAppTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Camera, LatLng, Marker, Polyline } from "react-native-maps";

type BusLocation = LatLng;

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLEMAPS_API;

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

export default function TripScreen() {
  const { theme } = useAppTheme();
  const params = useLocalSearchParams();
  const mapRef = useRef<MapView>(null);
  const previousLocationRef = useRef<BusLocation | null>(null);

  const busId = params.busId as string;
  const busPlateNumber = params.busPlateNumber as string;
  const pickupCoords: LatLng = {
    latitude: parseFloat(params.pickupLat as string),
    longitude: parseFloat(params.pickupLng as string),
  };
  const destCoords: LatLng = {
    latitude: parseFloat(params.destLat as string),
    longitude: parseFloat(params.destLng as string),
  };
  const routePath: [number, number][] = JSON.parse(params.routePath as string);
  const polylineCoords = routePath.map(([lng, lat]) => ({
    latitude: lat,
    longitude: lng,
  }));

  const [busLocation, setBusLocation] = useState<BusLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [eta, setEta] = useState<string | null>("Calculating...");

  const fetchETA = async (origin: LatLng, destination: LatLng) => {
    // (fetchETA function is unchanged)
    if (!GOOGLE_MAPS_API_KEY) {
      console.error("Google Maps API key is not configured.");
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
      console.error("Error fetching ETA:", error);
      setEta("Error calculating ETA");
    }
  };

  useEffect(() => {
    const fetchInitialLocation = async () => {
      if (!busId) return;
      setLoading(true);
      try {
        // MODIFIED: Call the new RPC function instead of selecting from the table
        const { data, error } = await supabase.rpc("get_initial_bus_location", {
          p_bus_id: busId,
        });

        if (error) throw error;

        // MODIFIED: The 'data' variable is now the GeoJSON object itself,
        // so we check for 'data.coordinates' directly.
        if (data?.coordinates) {
          const location = {
            latitude: data.coordinates[1],
            longitude: data.coordinates[0],
          };
          setBusLocation(location);
          previousLocationRef.current = location;
          await fetchETA(location, pickupCoords);
        } else {
          Alert.alert("Error", "Could not find the bus's initial location.");
        }
      } catch (err) {
        console.error("Failed to fetch initial bus location:", err);
        Alert.alert(
          "Error",
          "An error occurred while fetching the bus location."
        );
      } finally {
        setLoading(false);
      }
    };
    fetchInitialLocation();
  }, [busId]);

  useEffect(() => {
    // (Real-time update useEffect is unchanged)
    if (!busId) return;
    const channel = supabase
      .channel(`realtime-trip-${busId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "trips",
          filter: `bus_id=eq.${busId}`,
        },
        async (payload) => {
          const updatedTrip = payload.new as any;
          if (updatedTrip.current_location?.coordinates) {
            const newLocation: LatLng = {
              latitude: updatedTrip.current_location.coordinates[1],
              longitude: updatedTrip.current_location.coordinates[0],
            };
            setBusLocation(newLocation);
            await fetchETA(newLocation, pickupCoords);

            const prevLocation = previousLocationRef.current;
            let heading = 0;
            if (prevLocation) {
              heading = calculateBearing(prevLocation, newLocation);
            }

            const camera: Partial<Camera> = {
              center: newLocation,
              pitch: 75,
              heading: heading,
              zoom: 18,
            };

            mapRef.current?.animateCamera(camera, { duration: 1500 });

            previousLocationRef.current = newLocation;
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [busId]);

  // Loading state remains the same
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text>Finding your bus...</Text>
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
          // MODIFIED: The fallback to pickupCoords is no longer needed,
          // as we now guarantee busLocation exists before rendering the map.
          center: busLocation,
          pitch: 75,
          heading: 0,
          zoom: 18,
        }}
        showsUserLocation
        showsMyLocationButton={false}
      >
        <Polyline
          coordinates={polylineCoords}
          strokeColor="#007AFF"
          strokeWidth={5}
        />
        <Marker
          coordinate={destCoords}
          title="Your Destination"
          pinColor="red"
        />
        <Marker
          coordinate={pickupCoords}
          title="Your Pickup Spot"
          pinColor="blue"
        />
        {busLocation && (
          <Marker
            coordinate={busLocation}
            title={busPlateNumber}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.busMarker}>
              <Image
                source={require("@/assets/images/bus-icon.png")}
                style={styles.busIcon}
              />
            </View>
          </Marker>
        )}
      </MapView>

      <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
        <Ionicons name="arrow-back" size={24} color="black" />
      </TouchableOpacity>

      <View style={styles.bottomPanel}>
        <View style={styles.etaContainer}>
          <Text style={styles.etaLabel}>Arriving in</Text>
          <Text style={styles.etaText}>{eta}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.tripInfoContainer}>
          <FontAwesome5 name="bus-alt" size={20} color="#333" />
          <Text style={styles.dots}>········</Text>
          <Ionicons name="location-sharp" size={20} color="#007AFF" />
          <Text style={styles.dots}>········</Text>
          <FontAwesome5 name="flag-checkered" size={20} color="#28a745" />
        </View>
        <Text style={styles.destinationText}>
          Bus {busPlateNumber} to Your Destination
        </Text>
      </View>
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
  backButton: {
    position: "absolute",
    top: 60,
    left: 20,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    padding: 8,
    borderRadius: 20,
    elevation: 5,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  bottomPanel: {
    position: "absolute",
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: "white",
    borderRadius: 16,
    padding: 16,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  etaContainer: {
    alignItems: "center",
  },
  etaLabel: {
    fontSize: 14,
    color: "#6c757d",
  },
  etaText: {
    fontSize: 36,
    fontWeight: "bold",
    color: "#007AFF",
  },
  divider: {
    height: 1,
    backgroundColor: "#e9ecef",
    marginVertical: 12,
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
  busMarker: {
    padding: 5,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: "white",
    backgroundColor: "#ffc107",
    elevation: 5,
  },
  busIcon: { width: 20, height: 20 },
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
});
