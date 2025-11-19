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
  Animated,
  FlatList,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
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

  // Animation states
  const [searchBarFocused, setSearchBarFocused] = useState(false);
  const [mapInteracted, setMapInteracted] = useState(false);
  
  // Animation values
  const searchBarScale = useRef(new Animated.Value(1)).current;
  const instructionOpacity = useRef(new Animated.Value(1)).current;
  const buttonScale = useRef(new Animated.Value(0.95)).current;
  const pinBounce = useRef(new Animated.Value(0)).current;
  const targetPulse = useRef(new Animated.Value(1)).current;
  const cancelButtonScale = useRef(new Animated.Value(1)).current;
  const confirmButtonScale = useRef(new Animated.Value(1)).current;
  const confirmButtonGlow = useRef(new Animated.Value(0)).current;
  const userLocationPulse = useRef(new Animated.Value(1)).current;
  

  // Debounced location update to prevent excessive map animations
  const updateLocationWithDebounce = useCallback(
    (location: Location.LocationObject) => {
      setUserLocation(location);
      
      // Start pulsing animation for user location marker
      Animated.loop(
        Animated.sequence([
          Animated.timing(userLocationPulse, {
            toValue: 1.3,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(userLocationPulse, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      ).start();
    },
    [userLocationPulse]
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

          // Animate map to cached location with nice 3D view
          mapRef.current?.animateCamera({
            center: {
              latitude: lastKnownPosition.coords.latitude,
              longitude: lastKnownPosition.coords.longitude,
            },
            zoom: 15,
            pitch: 20, // Slight 3D angle for better perspective
            heading: 0,
          }, { duration: 800 });
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
          mapRef.current?.animateCamera({
            center: {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
            },
            zoom: 15,
            pitch: 20, // Slight 3D angle
            heading: 0,
          }, { duration: 600 });
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

  // Cleanup timeout and animations on unmount
  useEffect(() => {
    return () => {
      if (mapAnimationTimeoutRef.current) {
        clearTimeout(mapAnimationTimeoutRef.current);
      }
      // Stop all running animations
      targetPulse.stopAnimation();
      pinBounce.stopAnimation();
      cancelButtonScale.stopAnimation();
      confirmButtonScale.stopAnimation();
      confirmButtonGlow.stopAnimation();
      userLocationPulse.stopAnimation();
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

        // Auto-focus on the selected destination with 3D view
        autoFocusOnDestination(location.lat, location.lng);

        // Animate confirm button glow when place is selected
        Animated.timing(confirmButtonGlow, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }).start();

        // Animate pin bounce for selected place
        Animated.sequence([
          Animated.timing(pinBounce, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(pinBounce, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();

        // Start pulsing animation for target circle
        Animated.loop(
          Animated.sequence([
            Animated.timing(targetPulse, {
              toValue: 1.2,
              duration: 800,
              useNativeDriver: true,
            }),
            Animated.timing(targetPulse, {
              toValue: 1,
              duration: 800,
              useNativeDriver: true,
            }),
          ])
        ).start();
      }
    } catch (error) {
      console.error("Failed to fetch place details:", error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleMapPress = (e: any) => {
    const coordinate = e.nativeEvent.coordinate;
    setDroppedPinLocation(coordinate);
    setMapInteracted(true);
    
    // Auto-focus on the tapped location with 3D view
    autoFocusOnDestination(coordinate.latitude, coordinate.longitude);
    
    // Animate confirm button glow when pin is dropped
    Animated.timing(confirmButtonGlow, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
    
    // Animate pin bounce effect
    Animated.sequence([
      Animated.timing(pinBounce, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(pinBounce, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    // Start pulsing animation for target circle
    Animated.loop(
      Animated.sequence([
        Animated.timing(targetPulse, {
          toValue: 1.2,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(targetPulse, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Animate instruction fade out
    if (showInstruction) {
      Animated.timing(instructionOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => setShowInstruction(false));
    }
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

  // Auto-zoom and pitch functions
  const autoFitMapToRoute = useCallback(() => {
    if (!mapRef.current || !routeData?.path?.coordinates || !userLocation) return;

    const coordinates = routeData.path.coordinates;
    if (coordinates.length === 0) return;

    // Calculate bounds for the route
    const lats = coordinates.map(([lng, lat]) => lat);
    const lngs = coordinates.map(([lng, lat]) => lng);
    
    const minLat = Math.min(...lats, userLocation.coords.latitude);
    const maxLat = Math.max(...lats, userLocation.coords.latitude);
    const minLng = Math.min(...lngs, userLocation.coords.longitude);
    const maxLng = Math.max(...lngs, userLocation.coords.longitude);

    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    const latDelta = (maxLat - minLat) * 1.4; // Add padding
    const lngDelta = (maxLng - minLng) * 1.4;

    // Animate to fit the route with a nice 3D view
    mapRef.current.animateCamera({
      center: { latitude: centerLat, longitude: centerLng },
      zoom: 17, // Good zoom level for route overview
      pitch: 70, // Nice 3D angle
      heading: 0,
    }, { duration: 1000 });
  }, [routeData, userLocation]);

  const autoFocusOnDestination = useCallback((latitude: number, longitude: number) => {
    if (!mapRef.current || !userLocation) return;

    // If destination is far from user, show both in view
    const userLat = userLocation.coords.latitude;
    const userLng = userLocation.coords.longitude;
    const distance = Math.sqrt(Math.pow(latitude - userLat, 2) + Math.pow(longitude - userLng, 2));

    if (distance > 0.01) { // If more than ~1km apart, show both
      const centerLat = (userLat + latitude) / 2;
      const centerLng = (userLng + longitude) / 2;
      const latDelta = Math.abs(userLat - latitude) * 1.5;
      const lngDelta = Math.abs(userLng - longitude) * 1.5;

      mapRef.current.animateCamera({
        center: { latitude: centerLat, longitude: centerLng },
        zoom: 17, // Show both points
        pitch: 70, // Nice overview angle
        heading: 0,
      }, { duration: 1000 });
    } else {
      // Close destination - zoom in with elevated pitch for better view
      mapRef.current.animateCamera({
        center: { latitude, longitude },
        zoom: 17, // Close zoom for destination
        pitch: 70, // Higher pitch for destination view
        heading: 0,
      }, { duration: 800 });
    }
  }, [userLocation]);

  const resetToUserLocation = useCallback(() => {
    if (!mapRef.current || !userLocation) return;
    
    mapRef.current.animateCamera({
      center: {
        latitude: userLocation.coords.latitude,
        longitude: userLocation.coords.longitude,
      },
      zoom: 17,
      pitch: 70, // Flat view for user location
      heading: 0,
    }, { duration: 600 });
  }, [userLocation]);

  // Auto-fit map when route data changes
  useEffect(() => {
    if (routeData && userLocation) {
      setTimeout(() => {
        autoFitMapToRoute();
      }, 500); // Small delay to ensure map is ready
    }
  }, [routeData, userLocation, autoFitMapToRoute]);

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

      {/* Enhanced Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.headerIconContainer}>
            <Ionicons name="bus" size={28} color="#fff" />
          </View>
          <View style={styles.headerTextContainer}>
            <Text style={styles.title}>
              🎯 Set Destination for {selectedRouteName}
            </Text>
            <Text style={styles.subtitle}>
              {routeData
                ? `Route: ${routeData.start_address || "Start"} → ${
                    routeData.end_address || "End"
                  }`
                : "Search or tap on the map to set your destination"}
            </Text>
          </View>
          <TouchableOpacity 
            style={styles.closeButton} 
            onPress={handleCancel}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map}  
        googleRenderer="LEGACY"
        customMapStyle={theme === "dark" ? [...mapDarkStyle] : []}
        initialRegion={{
          latitude: 6.7536,
          longitude: 125.356,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        }}
        onPress={handleMapPress}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsBuildings={true}
        showsIndoors={true}
        pitchEnabled={true}
        rotateEnabled={true}
        zoomEnabled={true}
        scrollEnabled={true}
        mapPadding={{ top: 0, right: 0, bottom: 100, left: 0 }}
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
              <View style={styles.userLocationDot}>
                <Ionicons name="person" size={16} color="#fff" />
              </View>
              <Animated.View 
                style={[
                  styles.userLocationRipple,
                  {
                    transform: [{ scale: userLocationPulse }],
                    opacity: userLocationPulse.interpolate({
                      inputRange: [1, 1.3],
                      outputRange: [0.6, 0.1],
                    }),
                  }
                ]} 
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

        {/* Enhanced Destination Pin with Clear Point Indicator */}
        {droppedPinLocation && (
          <Marker
            coordinate={droppedPinLocation}
            draggable
            onDragEnd={(e) => setDroppedPinLocation(e.nativeEvent.coordinate)}
            title="📍 Your Destination"
            description="Drag to adjust location"
            anchor={{ x: 0.5, y: 1 }} // Anchor at the bottom point of the pin
          >
            <Animated.View 
              style={[
                styles.destinationPin,
                { 
                  transform: [
                    { scale: pinBounce.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.15]
                    }) }
                  ]
                }
              ]}
            >
              <View style={styles.customPinContainer}>
                {/* Simple pin design */}
                <View style={styles.pinHead}>
                  <Ionicons name="location" size={20} color="#fff" />
                </View>
                <View style={styles.pinPoint} />
                {/* Simple pulsing circle */}
                <Animated.View 
                  style={[
                    styles.targetCircle,
                    {
                      transform: [{ scale: targetPulse }]
                    }
                  ]}
                />
              </View>
            </Animated.View>
          </Marker>
        )}
      </MapView>

      {/* Enhanced Search Bar */}
      <Animated.View 
        style={[
          styles.searchContainer, 
          { 
            transform: [{ scale: searchBarScale }],
            opacity: searchBarFocused ? 1 : 0.95 
          }
        ]}
      >
        <View style={[styles.searchInputContainer, { backgroundColor }]}>
          <Ionicons 
            name="search" 
            size={20} 
            color={searchBarFocused ? primaryColor : placeholderTextColor} 
          />
          <TextInput
            style={[styles.searchInput, { color: textColor }]}
            placeholder="🔍 Search places nearby..."
            placeholderTextColor={placeholderTextColor}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onFocus={() => {
              setShowSearchResults(true);
              setSearchBarFocused(true);
              Animated.spring(searchBarScale, {
                toValue: 1.02,
                useNativeDriver: true,
              }).start();
            }}
            onBlur={() => {
              setSearchBarFocused(false);
              Animated.spring(searchBarScale, {
                toValue: 1,
                useNativeDriver: true,
              }).start();
            }}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                setSearchQuery("");
                setSelectedPlace(null);
                setShowSearchResults(false);
              }}
              style={styles.clearButton}
              activeOpacity={0.7}
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

        {/* Enhanced Search Results */}
        {showSearchResults && predictions.length > 0 && (
          <Animated.View 
            style={[
              styles.searchResultsContainer, 
              { backgroundColor },
              { 
                opacity: searchBarFocused ? 1 : 0.95,
                transform: [{ translateY: searchBarFocused ? 0 : 5 }]
              }
            ]}
          >
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
                  activeOpacity={0.8}
                >
                  <View style={styles.searchResultIcon}>
                    <Ionicons name="location" size={18} color={primaryColor} />
                  </View>
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
          </Animated.View>
        )}
      </Animated.View>

      {/* Enhanced Floating Instruction */}
      {showInstruction && (
        <Animated.View
          style={[
            styles.instructionContainer,
            droppedPinLocation && styles.instructionContainerWithPin,
            { opacity: instructionOpacity }
          ]}
        >
          <View style={styles.instructionContent}>
            <Ionicons 
              name={droppedPinLocation ? "move" : "hand-left"} 
              size={18} 
              color="#fff" 
              style={styles.instructionIcon}
            />
            <Text style={styles.instructionText}>
              {droppedPinLocation
                ? "Drag the pin to adjust destination"
                : "Tap anywhere on the map to set destination"}
            </Text>
          </View>
        </Animated.View>
      )}

      {/* Floating Reset View Button */}
      <TouchableOpacity
        style={styles.resetViewButton}
        onPress={resetToUserLocation}
        activeOpacity={0.8}
      >
        <Ionicons name="locate" size={20} color="#fff" />
      </TouchableOpacity>



      {/* Enhanced Action Buttons */}
      <View style={styles.actionContainer}>
        {/* Cancel Button */}
        <Animated.View 
          style={{ 
            flex: 0.8, 
            transform: [{ scale: cancelButtonScale }] 
          }}
        >
          <TouchableOpacity
            style={[styles.actionButton, styles.cancelButton]}
            onPress={handleCancel}
            onPressIn={() => {
              Animated.spring(cancelButtonScale, {
                toValue: 0.95,
                useNativeDriver: true,
              }).start();
            }}
            onPressOut={() => {
              Animated.spring(cancelButtonScale, {
                toValue: 1,
                useNativeDriver: true,
              }).start();
            }}
            activeOpacity={0.9}
          >
            <Ionicons name="close" size={20} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </Animated.View>
        
        {/* Confirm Button */}
        <Animated.View 
          style={{ 
            flex: 1.5, 
            marginLeft: 12,
            transform: [{ scale: confirmButtonScale }] 
          }}
        >
          <TouchableOpacity
            style={[
              styles.actionButton,
              styles.confirmButton,
              droppedPinLocation && styles.confirmButtonActive,
              (!droppedPinLocation || isGeocoding) && styles.disabledButton,
            ]}
            onPress={handleConfirmDestination}
            onPressIn={() => {
              if (droppedPinLocation && !isGeocoding) {
                Animated.spring(confirmButtonScale, {
                  toValue: 0.97,
                  useNativeDriver: true,
                }).start();
              }
            }}
            onPressOut={() => {
              Animated.spring(confirmButtonScale, {
                toValue: 1,
                useNativeDriver: true,
              }).start();
            }}
            disabled={!droppedPinLocation || isGeocoding}
            activeOpacity={0.9}
          >
            {isGeocoding ? (
              <View style={styles.buttonContent}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={[styles.confirmButtonText, { marginLeft: 10 }]}>
                  Processing...
                </Text>
              </View>
            ) : (
              <View style={styles.buttonContent}>
                <Ionicons 
                  name={droppedPinLocation ? "checkmark-circle-outline" : "navigate-circle-outline"} 
                  size={22} 
                  color="#fff" 
                  style={{ marginRight: 8 }} 
                />
                <Text style={styles.confirmButtonText}>
                  {droppedPinLocation ? "Confirm Destination" : "Drop Pin to Continue"}
                </Text>
              </View>
            )}
            
            {/* Progress Indicator when pin is selected */}
            {droppedPinLocation && !isGeocoding && (
              <Animated.View 
                style={[
                  styles.readyIndicator,
                  {
                    opacity: confirmButtonGlow.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, 1],
                    }),
                    transform: [{
                      scale: confirmButtonGlow.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.5, 1],
                      })
                    }]
                  }
                ]}
              >
                <View style={styles.readyDot} />
              </Animated.View>
            )}
          </TouchableOpacity>
        </Animated.View>
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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 12,
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
    top: 280, // Position below the search bar
    alignSelf: "center",
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 30,
    zIndex: 1002,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 12,
    maxWidth: "85%",
  },
  instructionContainerWithPin: {
    backgroundColor: "rgba(52, 199, 89, 0.95)",
    borderWidth: 2,
    borderColor: "#34C759",
  },
  instructionContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  instructionIcon: {
    marginRight: 8,
  },
  instructionText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 20,
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
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    elevation: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    position: "relative",
    overflow: "hidden",
  },
  confirmButton: {
    backgroundColor: "#007AFF",
    borderWidth: 0,
  },
  confirmButtonActive: {
    backgroundColor: "#34C759",
    shadowColor: "#34C759",
    shadowOpacity: 0.4,
    elevation: 16,
  },
  cancelButton: {
    backgroundColor: "rgba(108, 117, 125, 0.9)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  disabledButton: {
    backgroundColor: "rgba(142, 142, 147, 0.6)",
    shadowOpacity: 0.1,
    elevation: 4,
  },
  cancelButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  confirmButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  readyIndicator: {
    position: "absolute",
    top: 8,
    right: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  readyDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#fff",
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
    width: 40,
    height: 40,
  },
  userLocationDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#007AFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  },
  userLocationRipple: {
    position: "absolute",
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0, 122, 255, 0.3)",
    borderWidth: 2,
    borderColor: "rgba(0, 122, 255, 0.5)",
  },
  userMarkerIcon: {
    width: 32,
    height: 32,
  },

  // Enhanced UI Styles
  clearButton: {
    padding: 4,
    borderRadius: 15,
    backgroundColor: "rgba(0, 0, 0, 0.05)",
  },
  searchResultIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0, 122, 255, 0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  destinationPin: {
    alignItems: "center",
    justifyContent: "flex-end", // Align to bottom for proper anchoring
    height: 50,
    width: 40,
  },
  pinContainer: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  customPinContainer: {
    alignItems: "center",
    justifyContent: "flex-end",
    height: 40,
    width: 40,
  },
  pinHead: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#FF4B4B",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  },
  pinPoint: {
    width: 0,
    height: 0,
    backgroundColor: "transparent",
    borderStyle: "solid",
    borderTopWidth: 8,
    borderRightWidth: 4,
    borderBottomWidth: 0,
    borderLeftWidth: 4,
    borderTopColor: "#FF4B4B",
    borderRightColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: "transparent",
    marginTop: -2,
  },
  targetCircle: {
    position: "absolute",
    bottom: -12,
    alignSelf: "center",
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(255, 75, 75, 0.3)",
    borderWidth: 2,
    borderColor: "rgba(255, 75, 75, 0.7)",
  },
  pinShadow: {
    position: "absolute",
    bottom: -5,
    width: 30,
    height: 8,
    backgroundColor: "rgba(0, 0, 0, 0.2)",
    borderRadius: 15,
    transform: [{ scaleX: 0.8 }],
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  loadingButtonContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },

  // Floating Reset Button
  resetViewButton: {
    position: "absolute",
    top: 250,
    right: 20,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(0, 122, 255, 0.9)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1001,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },


});
