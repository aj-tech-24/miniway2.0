import { BottomSheet } from "@/components/commuter/BottomSheet";
import { UserMarker3D } from "@/components/model/UserMarker3D";
import { mapDarkStyle } from "@/constants/mapDarkStyle";
import { useAuth } from "@/contexts/AuthContext";
import { useAppTheme } from "@/contexts/ThemeContext";
import { useThemeColor } from "@/hooks/useThemeColor";
import { supabase } from "@/lib/supabase";
import { FontAwesome, Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Keyboard,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import MapView, { Marker } from "react-native-maps";
import {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

// --- Type Definitions ---
type Minibus = {
  id: string;
  plateNumber: string;
  currentLocation: { latitude: number; longitude: number };
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

// --- Constants ---
const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const BOTTOM_SHEET_MAX_HEIGHT = SCREEN_HEIGHT * 0.6;
const BOTTOM_SHEET_MIN_HEIGHT = SCREEN_HEIGHT * 0.35;
const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLEMAPS_API;

export function CommuterHomeScreen() {
  // Hooks and State declarations remain the same...
  const { session } = useAuth();
  const { theme } = useAppTheme();
  const mapRef = useRef<MapView>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [minibuses, setMinibuses] = useState<Minibus[]>([]);
  const [userLocation, setUserLocation] =
    useState<Location.LocationObject | null>(null);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [noResultsFound, setNoResultsFound] = useState(false);
  const [dropoffLocation, setDropoffLocation] = useState("");
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isPinDroppingMode, setIsPinDroppingMode] = useState(false);
  const [isPinDropLoading, setIsPinDropLoading] = useState(false);
  const [droppedPinLocation, setDroppedPinLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [confirmedDestination, setConfirmedDestination] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const primaryColor = useThemeColor({}, "tint");
  const placeholderTextColor = useThemeColor({}, "placeholderTextColor");
  const separatorColor = useThemeColor({}, "separatorColor");
  const translateY = useSharedValue(0);
  const context = useSharedValue({ y: 0 });
  const animatedBottomSheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const handleFindRide = () => {
    if (!userLocation || !confirmedDestination) {
      Alert.alert(
        "Missing Information",
        "Please ensure your location is enabled and a destination is set."
      );
      return;
    }
    router.push({
      pathname: "/route-details",
      params: {
        originLat: userLocation.coords.latitude,
        originLng: userLocation.coords.longitude,
        destLat: confirmedDestination.latitude,
        destLng: confirmedDestination.longitude,
      },
    });
  };

  // All functions (fetchActiveMinibuses, useEffects, fetchPredictions, etc.) remain the same until the UI Handlers...
  const fetchActiveMinibuses = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("minibuses")
        .select("id, plateNumber, currentLocation")
        .eq("status", "active");
      if (error) throw error;
      const formattedData = data.map((bus) => {
        const [longitude, latitude] = bus.currentLocation
          .replace("POINT(", "")
          .replace(")", "")
          .split(" ")
          .map(Number);
        return { ...bus, currentLocation: { latitude, longitude } };
      });
      runOnJS(setMinibuses)(formattedData);
    } catch (error) {
      if (error instanceof Error) {
        runOnJS(Alert.alert)("Error", "Could not fetch minibus locations.");
      }
    }
  }, []);

  useEffect(() => {
    translateY.value = withSpring(-BOTTOM_SHEET_MIN_HEIGHT);
    const initialize = async () => {
      const hasSeenModal = await AsyncStorage.getItem("hasSeenWelcomeModal");
      if (!hasSeenModal) {
        runOnJS(setShowWelcomeModal)(true);
      }
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission Denied",
          "Permission to access location was denied."
        );
        runOnJS(setInitialLoading)(false);
        return;
      }
      let location = await Location.getCurrentPositionAsync({});
      runOnJS(setUserLocation)(location);
      if (location) {
        mapRef.current?.animateToRegion({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        });
      }
      await fetchActiveMinibuses();
      runOnJS(setInitialLoading)(false);
    };
    initialize();
    const subscription = supabase
      .channel("public:minibuses")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "minibuses" },
        () => fetchActiveMinibuses()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(subscription);
    };
  }, [fetchActiveMinibuses]);

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    if (searchQuery.length > 2) {
      setIsSearching(true);
      setNoResultsFound(false);
      timeoutRef.current = setTimeout(() => {
        fetchPredictions(searchQuery);
      }, 500);
    } else {
      setPredictions([]);
      setIsSearching(false);
      setNoResultsFound(false);
    }
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [searchQuery]);

  const fetchPredictions = async (query: string) => {
    if (!GOOGLE_MAPS_API_KEY) {
      console.error("Google Maps API Key is not configured.");
      Alert.alert(
        "Configuration Error",
        "The search feature is currently unavailable."
      );
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
        setNoResultsFound(true);
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
        mapRef.current?.animateToRegion(
          {
            ...placeDetails.coordinate,
            latitudeDelta: 0.02,
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

  // --- UI Handlers ---
  const handleSetDestinationOnMap = () => {
    setIsPinDropLoading(true);
    setIsPinDroppingMode(true);
    translateY.value = withSpring(SCREEN_HEIGHT, { damping: 15 });
    setTimeout(() => {
      setIsPinDropLoading(false);
    }, 600); // Adjust duration to match animation
  };

  const handleConfirmDestination = async () => {
    if (!droppedPinLocation) return;
    setIsGeocoding(true);
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${droppedPinLocation.latitude},${droppedPinLocation.longitude}&key=${GOOGLE_MAPS_API_KEY}`;
    try {
      const response = await fetch(url);
      const data = await response.json();
      if (data.results && data.results.length > 0) {
        setDropoffLocation(data.results[0].formatted_address);
        setConfirmedDestination(droppedPinLocation); // <-- Save the confirmed coordinates
        setIsPinDroppingMode(false);
        setDroppedPinLocation(null);
        translateY.value = withSpring(-BOTTOM_SHEET_MIN_HEIGHT, {
          damping: 15,
        });
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

  const handleCancelPinDrop = () => {
    setIsPinDroppingMode(false);
    setDroppedPinLocation(null);
    translateY.value = withSpring(-BOTTOM_SHEET_MIN_HEIGHT, { damping: 15 });
  };

  const handleModalDismiss = async () => {
    await AsyncStorage.setItem("hasSeenWelcomeModal", "true");
    setShowWelcomeModal(false);
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    setPredictions([]);
    setSelectedPlace(null);
    setNoResultsFound(false);
    Keyboard.dismiss();
  };

  const trackUserLocation = () => {
    if (userLocation) {
      mapRef.current?.animateToRegion(
        {
          latitude: userLocation.coords.latitude,
          longitude: userLocation.coords.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        },
        1000
      );
    }
  };

  const panGesture = Gesture.Pan()
    .onStart(() => {
      context.value = { y: translateY.value };
    })
    .onUpdate((event) => {
      translateY.value = event.translationY + context.value.y;
      translateY.value = Math.max(translateY.value, -BOTTOM_SHEET_MAX_HEIGHT);
      translateY.value = Math.min(translateY.value, -BOTTOM_SHEET_MIN_HEIGHT);
    })
    .onEnd(() => {
      if (translateY.value > -SCREEN_HEIGHT / 2) {
        translateY.value = withSpring(-BOTTOM_SHEET_MIN_HEIGHT, {
          damping: 15,
        });
      } else {
        translateY.value = withSpring(-BOTTOM_SHEET_MAX_HEIGHT, {
          damping: 15,
        });
      }
    });

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={[styles.container, { backgroundColor }]}>
        <StatusBar style={theme === "dark" ? "light" : "dark"} />
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider="google"
          customMapStyle={theme === "dark" ? [...mapDarkStyle] : []}
          initialRegion={{
            latitude: 6.7536,
            longitude: 125.356,
            latitudeDelta: 0.0922,
            longitudeDelta: 0.0421,
          }}
          onPress={(e) => {
            if (isPinDroppingMode) {
              setDroppedPinLocation(e.nativeEvent.coordinate);
            }
          }}
        >
          {/* Map-specific components ONLY go here */}
          {selectedPlace && (
            <Marker
              coordinate={selectedPlace.coordinate}
              title={selectedPlace.name}
            />
          )}
          {userLocation && (
            <Marker
              coordinate={userLocation.coords}
              title="Your Location"
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <UserMarker3D />
            </Marker>
          )}
          {minibuses.map((bus) => (
            <Marker
              key={bus.id}
              coordinate={bus.currentLocation}
              title={`Bus: ${bus.plateNumber}`}
            >
              <View style={styles.markerContainer}>
                <FontAwesome name="bus" size={20} color="#fff" />
              </View>
            </Marker>
          ))}
          {droppedPinLocation && (
            <Marker
              coordinate={droppedPinLocation}
              draggable
              onDragEnd={(e) => setDroppedPinLocation(e.nativeEvent.coordinate)}
              pinColor="tomato"
            />
          )}
        </MapView>
        {/* FIX: All UI Overlays are now OUTSIDE and AFTER the MapView component */}
        <Modal
          animationType="fade"
          transparent={true}
          visible={showWelcomeModal}
          onRequestClose={handleModalDismiss}
        >
          {/* ... Modal Content ... */}
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor }]}>
              <Ionicons name="bus" size={60} color="#007AFF" />
              <Text style={[styles.modalTitle, { color: textColor }]}>
                Welcome to Miniway!
              </Text>
              <Text style={[styles.modalText, { color: textColor }]}>
                Ready to find your ride? Track minibuses in real-time and travel
                smarter.
              </Text>
              <TouchableOpacity
                style={styles.modalButton}
                onPress={handleModalDismiss}
              >
                <Text style={styles.modalButtonText}>Let's Go!</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {isPinDropLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>
              Preparing map for pin drop...
            </Text>
          </View>
        )}
        <View style={styles.topContainer}>
          {/* ... Search Bar and Predictions ... */}
          <View style={[styles.searchContainer, { backgroundColor }]}>
            <Ionicons name="search" size={20} color={textColor} />
            <TextInput
              placeholder="Search for a destination..."
              placeholderTextColor={placeholderTextColor}
              style={[styles.searchInput, { color: textColor }]}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={handleClearSearch}
                style={styles.clearIcon}
              >
                <Ionicons
                  name="close-circle"
                  size={20}
                  color={placeholderTextColor}
                />
              </TouchableOpacity>
            )}

            {isSearching && <ActivityIndicator size="small" />}
          </View>

          {predictions.length > 0 ? (
            <View style={[styles.predictionsContainer, { backgroundColor }]}>
              <FlatList
                data={predictions}
                keyExtractor={(item) => item.place_id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.predictionItem}
                    onPress={() => handlePredictionSelect(item.place_id)}
                  >
                    <Text style={{ color: textColor }}>{item.description}</Text>
                  </TouchableOpacity>
                )}
                ItemSeparatorComponent={() => (
                  <View
                    style={[
                      styles.separator,
                      { backgroundColor: separatorColor },
                    ]}
                  />
                )}
                keyboardShouldPersistTaps="handled"
              />
            </View>
          ) : (
            noResultsFound &&
            !isSearching && (
              <View style={[styles.predictionsContainer, { backgroundColor }]}>
                <Text style={[styles.noResultsText, { color: textColor }]}>
                  No results found
                </Text>
              </View>
            )
          )}
        </View>
        {/* <View>
          <TouchableOpacity
            style={styles.findRideButton}
            onPress={() => router.push("/AddRouteScreen")}
          >
            <Text style={styles.findRideButtonText}>Add Route</Text>
          </TouchableOpacity>
        </View> */}

        {/* FIX: Pin Dropping UI Overlays moved here */}
        {isPinDroppingMode && (
          <>
            <View style={styles.instructionContainer}>
              <Text style={styles.instructionText}>
                {droppedPinLocation
                  ? "Drag the pin to adjust"
                  : "Tap on the map to drop a pin"}
              </Text>
            </View>
            <View style={styles.pinActionContainer}>
              <TouchableOpacity
                style={[styles.pinActionButton, styles.cancelButton]}
                onPress={handleCancelPinDrop}
              >
                <Text style={styles.pinActionButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pinActionButton, styles.confirmButton]}
                onPress={handleConfirmDestination}
                disabled={!droppedPinLocation || isGeocoding}
              >
                {isGeocoding ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.pinActionButtonText}>Confirm Pin</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
        <TouchableOpacity
          style={styles.trackButton}
          onPress={trackUserLocation}
        >
          <Ionicons name="navigate-circle-outline" size={24} color="#fff" />
        </TouchableOpacity>

        <GestureDetector gesture={panGesture}>
          <BottomSheet
            animatedStyle={animatedBottomSheetStyle}
            dropoffLocation={dropoffLocation}
            onSetDestination={handleSetDestinationOnMap}
            onFindRide={handleFindRide}
            textColor={textColor}
            backgroundColor={backgroundColor}
            minibuses={minibuses}
          />
        </GestureDetector>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topContainer: {
    position: "absolute",
    top: 40,
    left: 10,
    right: 10,
    zIndex: 1,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 16,
  },
  clearIcon: {
    padding: 5,
    marginRight: 5,
  },
  activityIndicator: {
    marginLeft: 5,
  },
  noResultsText: {
    padding: 15,
    textAlign: "center",
    fontSize: 16,
    fontStyle: "italic",
  },
  predictionsContainer: {
    borderRadius: 8,
    marginTop: 8,
    maxHeight: 250, // Limit the height of the list
  },
  predictionItem: {
    padding: 15,
  },
  separator: {
    height: 1,
    width: "95%",
    alignSelf: "center",
  },
  markerContainer: {
    backgroundColor: "#007AFF",
    padding: 8,
    borderRadius: 20,
    borderColor: "#fff",
    borderWidth: 2,
  },
  userMarker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0, 122, 255, 0.3)",
    borderColor: "#007AFF",
    borderWidth: 3,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 10,
    color: "#fff",
    fontSize: 16,
  },
  trackButton: {
    position: "absolute",
    bottom: SCREEN_HEIGHT * 0.72, // Position above the collapsed bottom sheet
    right: 20,
    backgroundColor: "#007AFF",
    padding: 12,
    borderRadius: 30,
    elevation: 5,
  },
  bottomSheet: {
    position: "absolute",
    width: "100%",
    height: SCREEN_HEIGHT,
    top: SCREEN_HEIGHT, // Start off-screen
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    elevation: 10,
  },
  handleBar: {
    width: 40,
    height: 5,
    backgroundColor: "#ccc",
    borderRadius: 3,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 15,
  },
  bottomSheetTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 20,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f0f2f5",
    borderRadius: 10,
    paddingHorizontal: 15,
    marginBottom: 15,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    height: 50,
    fontSize: 16,
  },
  instructionContainer: {
    position: "absolute",
    top: 60, // Adjust as needed
    alignSelf: "center",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  instructionText: {
    color: "#fff",
    fontSize: 16,
  },
  pinActionContainer: {
    position: "absolute",
    bottom: 30, // Adjust as needed
    left: 20,
    right: 20,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  pinActionButton: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 10,
    elevation: 5,
  },
  confirmButton: {
    backgroundColor: "#007AFF",
  },
  cancelButton: {
    backgroundColor: "#6c757d",
  },
  pinActionButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  savedLocationsContainer: {
    flexDirection: "row",
    marginBottom: 20,
  },
  savedLocationButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#e9f2ff",
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 20,
    marginRight: 10,
  },
  savedLocationText: {
    marginLeft: 8,
    color: "#007AFF",
    fontWeight: "600",
  },
  findRideButton: {
    backgroundColor: "#007AFF",
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 25,
    marginTop: 100,
  },
  findRideButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  nearbyContainer: {},
  nearbyTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 10,
  },
  busItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f2f5",
  },
  busInfo: {
    marginLeft: 15,
  },
  busPlate: {
    fontSize: 16,
    fontWeight: "600",
  },
  busStatus: {
    color: "#666",
  },
  noBusesText: {
    textAlign: "center",
    color: "#888",
    marginTop: 20,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  modalContent: {
    width: "85%",
    backgroundColor: "white",
    borderRadius: 20,
    padding: 30,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: "bold",
    marginTop: 15,
    marginBottom: 10,
    textAlign: "center",
  },
  modalText: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginBottom: 25,
    lineHeight: 24,
  },
  modalButton: {
    backgroundColor: "#007AFF",
    borderRadius: 10,
    paddingVertical: 15,
    paddingHorizontal: 50,
  },
  modalButtonText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 16,
  },
  inputTouchable: {
    flex: 1,
    height: 50,
    justifyContent: "center",
  },
  inputText: {
    fontSize: 16,
  },
  centerPinContainer: {
    position: "absolute",
    top: "50%",
    left: "50%",
    // Offset by half the icon's size to truly center it
    marginLeft: -20,
    marginTop: -40, // Adjust this to have the tip of the pin at the center
  },
});

export default CommuterHomeScreen;
