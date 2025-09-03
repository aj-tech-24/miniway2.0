// components/AddRouteScreen.tsx

import { supabase } from "@/lib/supabase"; // Adjust path as needed
import { Ionicons } from "@expo/vector-icons";
import polyline from "@mapbox/polyline"; // For decoding Google's encoded polylines
import { router } from "expo-router"; // Assuming you use Expo Router
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { LatLng, Marker, Polyline } from "react-native-maps";

// Replace with your actual Google Maps API Key
const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLEMAPS_API;

// Type for the coordinates received from Google Geocoding
interface GeocodedLocation {
  latitude: number;
  longitude: number;
  name: string; // The formatted address
}

export default function AddRouteScreen() {
  const [routeName, setRouteName] = useState("");
  const [originAddress, setOriginAddress] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [originCoords, setOriginCoords] = useState<LatLng | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<LatLng | null>(
    null
  );
  const [routePolyline, setRoutePolyline] = useState<LatLng[]>([]);
  const [loading, setLoading] = useState(false);
  const [mapRegion, setMapRegion] = useState<any>(null);

  const mapRef = useRef<MapView>(null);

  const handleGoBack = () => {
    router.back();
  };

  // --- Step 1: Geocoding Addresses to Coordinates ---
  const geocodeAddress = async (
    address: string
  ): Promise<GeocodedLocation | null> => {
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
          address
        )}&key=${GOOGLE_MAPS_API_KEY}`
      );
      const data = await response.json();

      if (data.status === "OK" && data.results.length > 0) {
        const { lat, lng } = data.results[0].geometry.location;
        return {
          latitude: lat,
          longitude: lng,
          name: data.results[0].formatted_address,
        };
      } else {
        console.error("Geocoding error:", data.status, data.error_message);
        Alert.alert(
          "Geocoding Error",
          `Could not find coordinates for: ${address}. Please be more specific.`
        );
        return null;
      }
    } catch (error) {
      console.error("Geocoding API call failed:", error);
      Alert.alert("Error", "Failed to connect to geocoding service.");
      return null;
    }
  };

  // --- Step 2: Fetching Directions between Coordinates ---
  const fetchDirections = async (
    origin: LatLng,
    destination: LatLng
  ): Promise<LatLng[] | null> => {
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.latitude},${origin.longitude}&destination=${destination.latitude},${destination.longitude}&mode=driving&key=${GOOGLE_MAPS_API_KEY}`
      );
      const data = await response.json();

      if (data.status === "OK" && data.routes.length > 0) {
        const points = data.routes[0].overview_polyline.points;
        const decodedPath = polyline
          .decode(points)
          .map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
        return decodedPath;
      } else {
        console.error("Directions API error:", data.status, data.error_message);
        Alert.alert(
          "Directions Error",
          "Could not find a route between the specified locations."
        );
        return null;
      }
    } catch (error) {
      console.error("Directions API call failed:", error);
      Alert.alert("Error", "Failed to connect to directions service.");
      return null;
    }
  };

  // --- Main handler to process and display the route ---
  const previewRoute = async () => {
    if (!routeName.trim()) {
      Alert.alert("Error", "Please enter a route name.");
      return;
    }
    if (!originAddress.trim() || !destinationAddress.trim()) {
      Alert.alert(
        "Error",
        "Please enter both origin and destination addresses."
      );
      return;
    }

    setLoading(true);
    setRoutePolyline([]); // Clear previous route
    setOriginCoords(null);
    setDestinationCoords(null);

    try {
      // 1. Geocode Origin
      const originLoc = await geocodeAddress(originAddress);
      if (!originLoc) return;
      setOriginCoords(originLoc);

      // 2. Geocode Destination
      const destLoc = await geocodeAddress(destinationAddress);
      if (!destLoc) return;
      setDestinationCoords(destLoc);

      // 3. Fetch Directions
      const path = await fetchDirections(originLoc, destLoc);
      if (!path) return;
      setRoutePolyline(path);

      // 4. Fit map to show the entire route
      if (mapRef.current && path.length > 0) {
        const allCoords = [...path, originLoc, destLoc];
        mapRef.current.fitToCoordinates(allCoords, {
          edgePadding: { top: 100, right: 50, bottom: 100, left: 50 },
          animated: true,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  // --- Step 3: Saving the Route to Supabase ---
  const saveRoute = async () => {
    if (routePolyline.length === 0) {
      Alert.alert("Error", "Please preview a route first before saving.");
      return;
    }

    setLoading(true);
    try {
      // 1. Create the GeoJSON coordinates array
      const geoJsonCoordinates = routePolyline.map((coord) => [
        coord.longitude,
        coord.latitude,
      ]);

      // 2. Create the full GeoJSON object that our SQL function expects
      const routePathGeoJSON = {
        type: "LineString",
        coordinates: geoJsonCoordinates,
      };

      // 3. Call the SQL function using rpc() instead of insert()
      const { error } = await supabase.rpc("add_new_route", {
        route_name: routeName.trim(),
        route_path: routePathGeoJSON,
      });

      if (error) {
        // This will now give much clearer, function-related errors if something is wrong
        console.error("Error saving route via RPC:", error);
        Alert.alert("Save Error", error.message || "Failed to save route.");
        return;
      }

      Alert.alert("Success", "Route saved successfully!");
      router.back(); // Navigate back after saving
    } catch (error) {
      console.error("Unexpected error during save:", error);
      Alert.alert(
        "Error",
        "An unexpected error occurred while saving the route."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleGoBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="black" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Add New Route</Text>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.label}>Route Name</Text>
          <TextInput
            style={styles.input}
            value={routeName}
            onChangeText={setRouteName}
            placeholder="e.g., Digos City Loop North"
            placeholderTextColor="#888"
          />

          <Text style={styles.label}>Origin Address</Text>
          <TextInput
            style={styles.input}
            value={originAddress}
            onChangeText={setOriginAddress}
            placeholder="e.g., SM Digos, Rizal Ave"
            placeholderTextColor="#888"
          />

          <Text style={styles.label}>Destination Address</Text>
          <TextInput
            style={styles.input}
            value={destinationAddress}
            onChangeText={setDestinationAddress}
            placeholder="e.g., Digos Public Market"
            placeholderTextColor="#888"
          />

          <TouchableOpacity
            style={[styles.button, styles.previewButton]}
            onPress={previewRoute}
            disabled={loading}
          >
            {loading && routePolyline.length === 0 ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Preview Route</Text>
            )}
          </TouchableOpacity>

          {routePolyline.length > 0 && (
            <Text style={styles.previewText}>
              Route preview is available on the map.
            </Text>
          )}

          <View style={styles.mapContainer}>
            <MapView
              ref={mapRef}
              style={styles.map}
              initialRegion={{
                latitude: 6.75, // Default to a central point in Digos
                longitude: 125.35,
                latitudeDelta: 0.0922,
                longitudeDelta: 0.0421,
              }}
              onRegionChangeComplete={setMapRegion}
            >
              {originCoords && (
                <Marker
                  coordinate={originCoords}
                  title="Origin"
                  pinColor="green"
                />
              )}
              {destinationCoords && (
                <Marker
                  coordinate={destinationCoords}
                  title="Destination"
                  pinColor="red"
                />
              )}
              {routePolyline.length > 0 && (
                <Polyline
                  coordinates={routePolyline}
                  strokeColor="#007AFF"
                  strokeWidth={5}
                />
              )}
            </MapView>
          </View>

          {routePolyline.length > 0 && (
            <TouchableOpacity
              style={[styles.button, styles.saveButton]}
              onPress={saveRoute}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Save Route to Database</Text>
              )}
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    paddingTop: Platform.OS === "android" ? 25 : 0, // For Android status bar
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  backButton: {
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 100, // Ensure space for KeyboardAvoidingView
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
    color: "#333",
    marginTop: 15,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: "#fff",
    marginBottom: 10,
  },
  button: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
    flexDirection: "row", // For indicator
  },
  previewButton: {
    backgroundColor: "#007AFF",
  },
  saveButton: {
    backgroundColor: "#28a745",
    marginTop: 10,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  previewText: {
    textAlign: "center",
    marginTop: 15,
    fontSize: 14,
    color: "#555",
  },
  mapContainer: {
    height: 300,
    borderRadius: 10,
    overflow: "hidden",
    marginTop: 20,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
});
