import { supabase } from "@/lib/supabase"; // Make sure this is your configured Supabase client
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { LatLng, Marker, Polyline } from "react-native-maps";

// UPDATED: This type matches the output of your SQL function
type Route = {
  id: string;
  name: string;
  path: {
    // The path is already a GeoJSON object
    type: "LineString";
    coordinates: [number, number][]; // [longitude, latitude]
  };
};

export default function RouteDetailsScreen() {
  const params = useLocalSearchParams();
  const [loading, setLoading] = useState(true);
  const [nearestRoute, setNearestRoute] = useState<Route | null>(null);
  const mapRef = useRef<MapView>(null);

  const destCoords: LatLng = {
    latitude: parseFloat((params.destLat as string) || "0"),
    longitude: parseFloat((params.destLng as string) || "0"),
  };

  useEffect(() => {
    if (!destCoords.latitude || !destCoords.longitude) {
      Alert.alert(
        "Error",
        "Missing destination. Please go back and try again.",
        [{ text: "OK", onPress: () => router.back() }]
      );
      return;
    }

    const findNearestRoute = async () => {
      try {
        setLoading(true);

        // UPDATED: Call your specific SQL function with its arguments
        const { data, error } = await supabase.rpc(
          "find_route_near_destination",
          {
            dest_lon: destCoords.longitude,
            dest_lat: destCoords.latitude,
          }
        );

        if (error) {
          throw error;
        }
        console.log(
          "Fetched Route Data from Supabase:",
          JSON.stringify(data, null, 2)
        );

        if (data && data.length > 0) {
          const fetchedRoute = data[0] as Route;
          setNearestRoute(fetchedRoute);

          // Fit map to the route and destination
          setTimeout(() => {
            const allCoordinates: LatLng[] = [destCoords];
            if (fetchedRoute.path?.coordinates) {
              fetchedRoute.path.coordinates.forEach(([lng, lat]) => {
                allCoordinates.push({ latitude: lat, longitude: lng });
              });
            }

            if (mapRef.current && allCoordinates.length > 1) {
              mapRef.current.fitToCoordinates(allCoordinates, {
                edgePadding: { top: 150, right: 50, bottom: 150, left: 50 },
                animated: true,
              });
            }
          }, 500); // Delay to ensure map is ready
        } else {
          Alert.alert(
            "No Routes Found",
            "Could not find any mini-bus routes near your destination.",
            [{ text: "OK", onPress: () => router.back() }]
          );
        }
      } catch (err) {
        console.error("Error finding nearest route:", err);
        Alert.alert(
          "Error",
          "Failed to find the nearest route. Please try again.",
          [{ text: "OK", onPress: () => router.back() }]
        );
      } finally {
        setLoading(false);
      }
    };

    findNearestRoute();
  }, [destCoords.latitude, destCoords.longitude]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text>Searching for nearest route...</Text>
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
    nearestRoute.path.coordinates.map(([lng, lat]) => ({
      latitude: lat,
      longitude: lng,
    })) || [];

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: destCoords.latitude,
          longitude: destCoords.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        <Marker
          coordinate={destCoords}
          title="Your Destination"
          pinColor="red"
        />
        {polylineCoords.length > 0 && (
          <Polyline
            coordinates={polylineCoords}
            strokeColor="#007AFF"
            strokeWidth={6}
          />
        )}
      </MapView>

      <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
        <Ionicons name="arrow-back" size={24} color="black" />
      </TouchableOpacity>

      <View style={styles.routeInfo}>
        <Text style={styles.routeName}>Nearest Route: {nearestRoute.name}</Text>
        <Text style={styles.routeSubtext}>
          This is the closest mini-bus route to your destination.
        </Text>
      </View>
    </View>
  );
}

// Styles remain the same
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
  routeInfo: {
    position: "absolute",
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: "white",
    padding: 15,
    borderRadius: 10,
    elevation: 5,
    alignItems: "center",
  },
  routeName: {
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "center",
  },
  routeSubtext: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
    textAlign: "center",
  },
});
