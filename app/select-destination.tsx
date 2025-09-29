import { mapDarkStyle } from "@/constants/mapDarkStyle";
import { useAppTheme } from "@/contexts/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Marker } from "react-native-maps";

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLEMAPS_API;

export default function SelectDestinationScreen() {
  const { theme } = useAppTheme();
  const params = useLocalSearchParams();
  const mapRef = useRef<MapView>(null);

  const [userLocation, setUserLocation] =
    useState<Location.LocationObject | null>(null);
  const [droppedPinLocation, setDroppedPinLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [locationLoading, setLocationLoading] = useState(true);

  const selectedRouteId = params.selectedRouteId as string;
  const selectedRouteName = params.selectedRouteName as string;

  // Get user location
  useEffect(() => {
    const getCurrentLocation = async () => {
      try {
        setLocationLoading(true);
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            "Permission Denied",
            "Permission to access location was denied."
          );
          setLocationLoading(false);
          return;
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setUserLocation(location);

        // Animate map to user location
        mapRef.current?.animateToRegion({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        });
      } catch (error) {
        console.error("Error getting location:", error);
        Alert.alert("Error", "Failed to get your current location.");
      } finally {
        setLocationLoading(false);
      }
    };

    getCurrentLocation();
  }, []);

  const handleMapPress = (e: any) => {
    setDroppedPinLocation(e.nativeEvent.coordinate);
  };

  const handleConfirmDestination = async () => {
    if (!droppedPinLocation) return;

    setIsGeocoding(true);
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${droppedPinLocation.latitude},${droppedPinLocation.longitude}&key=${GOOGLE_MAPS_API_KEY}`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.results && data.results.length > 0) {
        // Navigate to route details with the selected route and destination
        if (selectedRouteId && userLocation) {
          const routeParams = {
            originLat: userLocation.coords.latitude.toString(),
            originLng: userLocation.coords.longitude.toString(),
            destLat: droppedPinLocation.latitude.toString(),
            destLng: droppedPinLocation.longitude.toString(),
            routeId: selectedRouteId,
          };

          console.log("Navigating to route details with params:", routeParams);
          console.log("Selected Route ID:", selectedRouteId);
          console.log("Selected Route Name:", selectedRouteName);

          router.push({
            pathname: "/route-details",
            params: routeParams,
          });
        }
      } else {
        Alert.alert(
          "Location Unrecognized",
          "Could not find a specific address. Please try a different spot."
        );
      }
    } catch (error) {
      console.error("Failed to fetch address:", error);
      Alert.alert(
        "Error",
        "Could not determine the address. Please check your connection."
      );
    } finally {
      setIsGeocoding(false);
    }
  };

  const handleCancel = () => {
    router.back();
  };

  if (locationLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Getting your location...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.headerIconContainer}>
            <Ionicons name="bus" size={28} color="#fff" />
          </View>
          <View style={styles.headerTextContainer}>
            <Text style={styles.title}>
              Set Destination for {selectedRouteName}
            </Text>
            <Text style={styles.subtitle}>Tap on the map to drop a pin</Text>
          </View>
          <TouchableOpacity style={styles.closeButton} onPress={handleCancel}>
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map}
        provider="google"
        customMapStyle={theme === "dark" ? [...mapDarkStyle] : []}
        initialRegion={{
          latitude: 6.7536,
          longitude: 125.356,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        }}
        onPress={handleMapPress}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {droppedPinLocation && (
          <Marker
            coordinate={droppedPinLocation}
            draggable
            onDragEnd={(e) => setDroppedPinLocation(e.nativeEvent.coordinate)}
            pinColor="tomato"
          />
        )}
      </MapView>

      {/* Instruction */}
      <View
        style={[
          styles.instructionContainer,
          droppedPinLocation && styles.instructionContainerWithPin,
        ]}
      >
        <Text style={styles.instructionText}>
          {droppedPinLocation
            ? "📍 Drag the pin to adjust location"
            : "📍 Tap on the map to set your destination for this route"}
        </Text>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionContainer}>
        <TouchableOpacity
          style={[styles.actionButton, styles.cancelButton]}
          onPress={handleCancel}
        >
          <Text style={styles.actionButtonText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.actionButton,
            styles.confirmButton,
            droppedPinLocation && styles.confirmButtonActive,
            (!droppedPinLocation || isGeocoding) && styles.disabledButton,
          ]}
          onPress={handleConfirmDestination}
          disabled={!droppedPinLocation || isGeocoding}
        >
          {isGeocoding ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.actionButtonText}>
              {droppedPinLocation ? "✓ Confirm" : "Confirm Pin"}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f8f9fa",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: "#666",
  },
  header: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingTop: 50, // Account for status bar
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    zIndex: 1001,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerIconContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  headerTextContainer: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.8)",
  },
  closeButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  map: {
    flex: 1,
  },
  instructionContainer: {
    position: "absolute",
    top: 150, // Position below the header
    alignSelf: "center",
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    zIndex: 1002,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },
  instructionContainerWithPin: {
    backgroundColor: "rgba(0, 122, 255, 0.9)",
    borderWidth: 2,
    borderColor: "#007AFF",
  },
  instructionText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  actionContainer: {
    position: "absolute",
    bottom: 40,
    left: 20,
    right: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 1002,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 8,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  confirmButton: {
    backgroundColor: "#007AFF",
  },
  confirmButtonActive: {
    backgroundColor: "#34C759",
    transform: [{ scale: 1.05 }],
  },
  cancelButton: {
    backgroundColor: "#6c757d",
  },
  disabledButton: {
    backgroundColor: "#8E8E93",
    opacity: 0.6,
  },
  actionButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
});