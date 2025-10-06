import { mapDarkStyle } from "@/constants/mapDarkStyle";
import { useAppTheme } from "@/contexts/ThemeContext";
import { useThemeColor } from "@/hooks/useThemeColor";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLEMAPS_API;

// --- Data Types ---
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

interface Prediction {
  description: string;
  place_id: string;
}

interface Place {
  name: string;
  coordinate: {
    latitude: number;
    longitude: number;
  };
}

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
  const [routeData, setRouteData] = useState<Route | null>(null);
  const [routeLoading, setRouteLoading] = useState(true);

  // Search-related state
  const [searchQuery, setSearchQuery] = useState("");
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [showInstruction, setShowInstruction] = useState(true);

  // Debounced location update to prevent excessive map animations
  const updateLocationWithDebounce = useCallback(
    (location: Location.LocationObject) => {
      setUserLocation(location);
    },
    []
  );

  // Timeout ref to prevent excessive map animations
  const mapAnimationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const selectedRouteId = params.selectedRouteId as string;
  const selectedRouteName = params.selectedRouteName as string;

  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const primaryColor = useThemeColor({}, "tint");
  const buttonColor = useThemeColor({}, "buttonBackground");
  const buttonTextColor = useThemeColor({}, "buttonText");
  const placeholderTextColor = useThemeColor({}, "placeholderTextColor");
  const separatorColor = useThemeColor({}, "separatorColor");

  // Get user location with optimization
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

        // Check for cached location first for faster response
        const lastKnownPosition = await Location.getLastKnownPositionAsync({
          maxAge: 30000, // 30 seconds
          requiredAccuracy: 100, // 100 meters accuracy is acceptable
        });

        if (lastKnownPosition) {
          updateLocationWithDebounce(lastKnownPosition);
          setLocationLoading(false);

          // Animate map to cached location immediately
          mapRef.current?.animateToRegion({
            latitude: lastKnownPosition.coords.latitude,
            longitude: lastKnownPosition.coords.longitude,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          });
        }

        // Get more accurate current position in background
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced, // Balanced accuracy for faster response
        });
        updateLocationWithDebounce(location);

        // Update map with more accurate location (debounced)
        if (mapAnimationTimeoutRef.current) {
          clearTimeout(mapAnimationTimeoutRef.current);
        }
        mapAnimationTimeoutRef.current = setTimeout(() => {
          mapRef.current?.animateToRegion({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          });
        }, 100);
      } catch (error) {
        console.error("Error getting location:", error);
        Alert.alert("Error", "Failed to get your current location.");
      } finally {
        setLocationLoading(false);
      }
    };

    getCurrentLocation();
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (mapAnimationTimeoutRef.current) {
        clearTimeout(mapAnimationTimeoutRef.current);
      }
    };
  }, []);

  // Hide instruction after 5 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowInstruction(false);
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  // Fetch route data
  useEffect(() => {
    const fetchRouteData = async () => {
      if (!selectedRouteId) return;

      try {
        setRouteLoading(true);
        console.log("Fetching route data for ID:", selectedRouteId);

        // Fetch the route data using the same function as route-details.tsx
        const { data: routeData, error: routeError } = await supabase.rpc(
          "get_route_geojson",
          { route_id: selectedRouteId }
        );

        if (routeError) {
          console.error("Route fetch error:", routeError);
          throw routeError;
        }

        if (!routeData || routeData.length === 0) {
          console.error("Route not found with ID:", selectedRouteId);
          setRouteData(null);
          return;
        }

        // Process the route data
        const rawRoute = routeData[0];
        let routePath;

        if (rawRoute && rawRoute.geojson) {
          // Use the actual stored route path from the database
          console.log("Using stored route geojson from database");
          routePath = rawRoute.geojson;
        } else {
          // Fallback to a simple line if no geojson data
          console.log("No stored route geojson, using fallback path");
          routePath = {
            type: "LineString",
            coordinates: [
              [125.356, 6.7536], // Default coordinates
              [125.4, 6.8],
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

        setRouteData(fetchedRoute);
        console.log("Route data loaded successfully:", fetchedRoute);
      } catch (error) {
        console.error("Error fetching route data:", error);
        setRouteData(null);
      } finally {
        setRouteLoading(false);
      }
    };

    fetchRouteData();
  }, [selectedRouteId]);

  // Search functionality
  useEffect(() => {
    if (searchQuery.length > 2) {
      setIsSearching(true);
      setShowSearchResults(true);
      fetchPredictions(searchQuery);
    } else {
      setPredictions([]);
      setIsSearching(false);
      setShowSearchResults(false);
    }
  }, [searchQuery]);

  const fetchPredictions = async (query: string) => {
    if (!GOOGLE_MAPS_API_KEY) {
      console.error("Google Maps API Key is not configured.");
      setIsSearching(false);
      return;
    }

    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
      query
    )}&key=${GOOGLE_MAPS_API_KEY}&components=country:PH`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.status === "ZERO_RESULTS") {
        setPredictions([]);
      } else if (data.predictions) {
        setPredictions(data.predictions);
      }
    } catch (error) {
      console.error("Failed to fetch predictions:", error);
    } finally {
      setIsSearching(false);
    }
  };

  const handlePredictionSelect = async (placeId: string) => {
    Keyboard.dismiss();
    setPredictions([]);
    setShowSearchResults(false);
    setIsSearching(true);

    if (!GOOGLE_MAPS_API_KEY) {
      console.error("Google Maps API Key is not configured.");
      setIsSearching(false);
      return;
    }

    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${GOOGLE_MAPS_API_KEY}&fields=geometry,name`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.result?.geometry?.location) {
        const { location } = data.result.geometry;
        const placeDetails: Place = {
          name: data.result.name,
          coordinate: { latitude: location.lat, longitude: location.lng },
        };

        setSelectedPlace(placeDetails);
        setSearchQuery(placeDetails.name);

        // Set the dropped pin location to the selected place
        setDroppedPinLocation({
          latitude: location.lat,
          longitude: location.lng,
        });

        // Animate map to the selected place
        mapRef.current?.animateToRegion(
          {
            latitude: location.lat,
            longitude: location.lng,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          },
          1000
        );
      }
    } catch (error) {
      console.error("Failed to fetch place details:", error);
    } finally {
      setIsSearching(false);
    }
  };

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

  if (locationLoading || routeLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>
          {locationLoading ? "Getting your location..." : "Loading route..."}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor }]}>
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
            <Text style={styles.subtitle}>
              {routeData
                ? `Route: ${routeData.start_address || "Start"} → ${
                    routeData.end_address || "End"
                  }`
                : "Tap on the map to drop a pin"}
            </Text>
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
        {/* Route Line */}
        {routeData?.path?.coordinates && (
          <Polyline
            coordinates={routeData.path.coordinates.map(([lng, lat]) => ({
              latitude: lat,
              longitude: lng,
            }))}
            strokeColor="#007AFF"
            strokeWidth={6}
            lineDashPattern={[8, 4]}
            lineCap="round"
            lineJoin="round"
          />
        )}

        {/* Custom User Location Marker */}
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

        {/* Line from user location to searched place */}
        {selectedPlace && userLocation && (
          <Polyline
            coordinates={[
              {
                latitude: userLocation.coords.latitude,
                longitude: userLocation.coords.longitude,
              },
              {
                latitude: selectedPlace.coordinate.latitude,
                longitude: selectedPlace.coordinate.longitude,
              },
            ]}
            strokeColor="#FF6B6B"
            strokeWidth={3}
            lineDashPattern={[5, 5]}
          />
        )}

        {/* Searched Place Marker */}
        {selectedPlace && (
          <Marker
            coordinate={selectedPlace.coordinate}
            title={selectedPlace.name}
            pinColor="green"
          />
        )}

        {/* Destination Pin */}
        {droppedPinLocation && (
          <Marker
            coordinate={droppedPinLocation}
            draggable
            onDragEnd={(e) => setDroppedPinLocation(e.nativeEvent.coordinate)}
            pinColor="tomato"
            title="Destination"
          />
        )}
      </MapView>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={[styles.searchInputContainer, { backgroundColor }]}>
          <Ionicons name="search" size={20} color={placeholderTextColor} />
          <TextInput
            style={[styles.searchInput, { color: textColor }]}
            placeholder="Search for a place..."
            placeholderTextColor={placeholderTextColor}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onFocus={() => setShowSearchResults(true)}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                setSearchQuery("");
                setSelectedPlace(null);
                setShowSearchResults(false);
              }}
            >
              <Ionicons
                name="close-circle"
                size={20}
                color={placeholderTextColor}
              />
            </TouchableOpacity>
          )}
          {isSearching && (
            <ActivityIndicator size="small" color={primaryColor} />
          )}
        </View>

        {/* Search Results */}
        {showSearchResults && predictions.length > 0 && (
          <View style={[styles.searchResultsContainer, { backgroundColor }]}>
            <FlatList
              data={predictions}
              keyExtractor={(item) => item.place_id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.searchResultItem,
                    { borderBottomColor: separatorColor },
                  ]}
                  onPress={() => handlePredictionSelect(item.place_id)}
                >
                  <Ionicons name="location" size={16} color={primaryColor} />
                  <Text
                    style={[styles.searchResultText, { color: textColor }]}
                    numberOfLines={2}
                  >
                    {item.description}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={placeholderTextColor}
                  />
                </TouchableOpacity>
              )}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            />
          </View>
        )}
      </View>

      {/* Instruction */}
      {showInstruction && (
        <View
          style={[
            styles.instructionContainer,
            droppedPinLocation && styles.instructionContainerWithPin,
          ]}
        >
          <Text style={styles.instructionText}>
            {droppedPinLocation
              ? "📍 Drag the pin to adjust destination location"
              : "📍 Tap on the map to set your destination along the route"}
          </Text>
        </View>
      )}

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
    top: 170, // Position below the header
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

  // Search Styles
  searchContainer: {
    position: "absolute",
    top: 170,
    left: 20,
    right: 20,
    zIndex: 1003,
  },
  searchInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 25,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.05)",
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
    marginLeft: 12,
    marginRight: 8,
  },
  searchResultsContainer: {
    marginTop: 8,
    borderRadius: 16,
    maxHeight: 200,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.05)",
    overflow: "hidden",
  },
  searchResultItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  searchResultText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    marginLeft: 12,
    marginRight: 8,
  },

  // Custom User Marker Styles
  userMarkerContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  userMarkerIcon: {
    width: 32,
    height: 32,
  },
});
