import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";

// Define a type for our route data
type Route = {
  id: string;
  name: string;
  path: {
    type: "LineString";
    coordinates: [number, number][]; // Array of [longitude, latitude]
  };
};

export default function RouteDetailsScreen() {
  const params = useLocalSearchParams();
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState<Route | null>(null);

  // Parse coordinates from navigation parameters, with validation
  const destCoords = {
    latitude: parseFloat((params.destLat as string) || "0"),
    longitude: parseFloat((params.destLng as string) || "0"),
  };

  useEffect(() => {
    // Ensure we have valid coordinates before fetching
    if (!destCoords.latitude) {
      Alert.alert(
        "Error",
        "Missing location data. Please go back and try again.",
        [{ text: "OK", onPress: () => router.back() }]
      );
      return;
    }

    const fetchRoute = async () => {
      try {
        // Call the NEW, simpler Supabase function
        const { data, error } = await supabase.rpc(
          "find_route_near_destination",
          {
            dest_lat: destCoords.latitude,
            dest_lon: destCoords.longitude,
          }
        );

        if (error) throw error;

        if (data && data.length > 0) {
          setRoute(data[0]);
        } else {
          Alert.alert(
            "No Route Found",
            "We couldn't find a minibus route near your selected locations.",
            [{ text: "OK", onPress: () => router.back() }]
          );
        }
      } catch (err) {
        console.error("Error fetching route:", err);
        Alert.alert("Error", "Failed to find a route. Please try again.", [
          { text: "OK", onPress: () => router.back() },
        ]);
      } finally {
        setLoading(false);
      }
    };

    fetchRoute();
  }, []);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text>Finding the best route...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView style={StyleSheet.absoluteFill}>
        <Marker
          coordinate={destCoords}
          title="Your Destination"
          pinColor="red"
        />

        {route && (
          <Polyline
            coordinates={route.path.coordinates.map(([lng, lat]) => ({
              latitude: lat,
              longitude: lng,
            }))}
            strokeColor="#007AFF"
            strokeWidth={6}
          />
        )}
      </MapView>

      <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
        <Ionicons name="arrow-back" size={24} color="black" />
      </TouchableOpacity>

      {route && (
        <View style={styles.routeInfo}>
          <Text style={styles.routeName}>Suggested Route: {route.name}</Text>
          <Text style={styles.routeSubtext}>
            Minibuses on this line will be shown.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
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
  },
  routeSubtext: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
  },
});
