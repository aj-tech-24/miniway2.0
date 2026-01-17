import { mapDarkStyle } from "@/constants/mapDarkStyle";
import { useAppTheme } from "@/contexts/ThemeContext";
import { useThemeColor } from "@/hooks/useThemeColor";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Keyboard,
  LayoutAnimation,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import Svg, { Path, Polygon } from "react-native-svg";

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLEMAPS_API;
const MARKER_ANIMATION_DURATION = 500; // ms - smooth marker transition duration

// --- Helper Functions ---
// Calculate bearing between two points (for camera rotation)
const calculateBearing = (
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number }
): number => {
  const toRadians = (deg: number) => deg * (Math.PI / 180);
  const toDegrees = (rad: number) => rad * (180 / Math.PI);

  const lat1 = toRadians(start.latitude);
  const lat2 = toRadians(end.latitude);
  const dLng = toRadians(end.longitude - start.longitude);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  let bearing = toDegrees(Math.atan2(y, x));
  return (bearing + 360) % 360; // Normalize to 0-360
};

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
  const isDark = theme === "dark";

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
  const [showPinDropInstructions, setShowPinDropInstructions] = useState(false);

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

  // Animated user location for smooth marker transitions
  const [animatedUserLocation, setAnimatedUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  // Reference to the user location marker for native animation
  const userMarkerRef = useRef<any>(null);
  // Animation frame reference for cleanup
  const markerAnimationFrameRef = useRef<number | null>(null);

  // Compass/Magnetometer state for direction indicator
  const [compassHeading, setCompassHeading] = useState(0);
  const [isMagnetometerAvailable, setIsMagnetometerAvailable] = useState(false);
  const [mapCameraHeading, setMapCameraHeading] = useState(0); // Track map rotation

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

        const lastKnownPosition = await Location.getLastKnownPositionAsync({
          maxAge: 30000,
          requiredAccuracy: 100,
        });

        if (lastKnownPosition) {
          updateLocationWithDebounce(lastKnownPosition);
          setLocationLoading(false);
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        updateLocationWithDebounce(location);
      } catch (error) {
        //console.error("Error getting location:", error);
        Alert.alert("Error", "Failed to get your current location.");
      } finally {
        setLocationLoading(false);
      }
    };

    getCurrentLocation();
  }, [routeData]);

  // Cleanup timeout and animations on unmount
  useEffect(() => {
    return () => {
      if (mapAnimationTimeoutRef.current) {
        clearTimeout(mapAnimationTimeoutRef.current);
      }
      if (markerAnimationFrameRef.current) {
        cancelAnimationFrame(markerAnimationFrameRef.current);
      }
      targetPulse.stopAnimation();
      pinBounce.stopAnimation();
      cancelButtonScale.stopAnimation();
      confirmButtonScale.stopAnimation();
      confirmButtonGlow.stopAnimation();
      userLocationPulse.stopAnimation();
    };
  }, []);

  // Animate user location marker smoothly when location changes
  useEffect(() => {
    if (!userLocation) return;

    const targetLocation = {
      latitude: userLocation.coords.latitude,
      longitude: userLocation.coords.longitude,
    };

    // Cancel any ongoing animation
    if (markerAnimationFrameRef.current) {
      cancelAnimationFrame(markerAnimationFrameRef.current);
    }

    // Initialize animated position if not set
    if (!animatedUserLocation) {
      setAnimatedUserLocation(targetLocation);
      return;
    }

    // For Android, use native animateMarkerToCoordinate method
    if (Platform.OS === 'android' && userMarkerRef.current) {
      userMarkerRef.current.animateMarkerToCoordinate(
        targetLocation,
        MARKER_ANIMATION_DURATION
      );
      // Also update state for tracking
      setAnimatedUserLocation(targetLocation);
    } else {
      // For iOS and web, use smooth interpolation
      const startPos = { ...animatedUserLocation };
      const endPos = targetLocation;
      const startTime = Date.now();
      const duration = MARKER_ANIMATION_DURATION;

      const animateStep = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Ease out cubic for smoother deceleration
        const easeProgress = 1 - Math.pow(1 - progress, 3);

        const newLat = startPos.latitude + (endPos.latitude - startPos.latitude) * easeProgress;
        const newLng = startPos.longitude + (endPos.longitude - startPos.longitude) * easeProgress;

        setAnimatedUserLocation({
          latitude: newLat,
          longitude: newLng,
        });

        if (progress < 1) {
          markerAnimationFrameRef.current = requestAnimationFrame(animateStep);
        }
      };

      markerAnimationFrameRef.current = requestAnimationFrame(animateStep);
    }
  }, [userLocation]);

  // Compass heading using expo-location for better accuracy
  useEffect(() => {
    let headingSub: Location.LocationSubscription | null = null;

    const subscribe = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setIsMagnetometerAvailable(false);
          return;
        }

        // Check if heading is available
        const available = await Location.hasServicesEnabledAsync();
        setIsMagnetometerAvailable(available);
        if (!available) return;

        headingSub = await Location.watchHeadingAsync((h) => {
          // Use trueHeading if available (more accurate), otherwise use magHeading
          const bearing = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          setCompassHeading(Math.round(bearing));
        });
      } catch (error) {
        //console.error('Error setting up heading watch:', error);
        setIsMagnetometerAvailable(false);
      }
    };

    subscribe();
    return () => {
      if (headingSub) {
        headingSub.remove();
      }
    };
  }, []);


  // Hide instruction after 5 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(instructionOpacity, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }).start(() => setShowInstruction(false));
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  // Fetch route data
  useEffect(() => {
    const fetchRouteData = async () => {
      if (!selectedRouteId) return;

      try {
        setRouteLoading(true);
        const { data: routeData, error: routeError } = await supabase.rpc(
          "get_route_geojson",
          { route_id: selectedRouteId }
        );

        if (routeError) {
          //console.error("Route fetch error:", routeError);
          throw routeError;
        }

        if (!routeData || routeData.length === 0) {
          //console.error("Route not found with ID:", selectedRouteId);
          setRouteData(null);
          return;
        }

        const rawRoute = routeData[0];
        let routePath;

        if (rawRoute && rawRoute.geojson) {
          routePath = rawRoute.geojson;
        } else {
          routePath = {
            type: "LineString",
            coordinates: [
              [125.356, 6.7536],
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
      } catch (error) {
        //console.error("Error fetching route data:", error);
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
      //console.error("Google Maps API Key is not configured.");
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
      //console.error("Failed to fetch predictions:", error);
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
      //console.error("Google Maps API Key is not configured.");
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
        setDroppedPinLocation({
          latitude: location.lat,
          longitude: location.lng,
        });

        Animated.timing(confirmButtonGlow, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }).start();

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

        smartZoom({
          latitude: location.lat,
          longitude: location.lng,
        });
      }
    } catch (error) {
      //console.error("Failed to fetch place details:", error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleMapPress = (e: any) => {
    const coordinate = e.nativeEvent.coordinate;
    setDroppedPinLocation(coordinate);
    setMapInteracted(true);
    setSearchQuery("Custom Pin Location");

    Animated.timing(confirmButtonGlow, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();

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
        if (selectedRouteId && userLocation) {
          const routeParams = {
            originLat: userLocation.coords.latitude.toString(),
            originLng: userLocation.coords.longitude.toString(),
            destLat: droppedPinLocation.latitude.toString(),
            destLng: droppedPinLocation.longitude.toString(),
            routeId: selectedRouteId,
          };

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
      //console.error("Failed to fetch address:", error);
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

  const autoFitMapToRoute = useCallback(() => {
    if (!mapRef.current || !routeData?.path?.coordinates || !userLocation) return;

    const coordinates = routeData.path.coordinates;
    if (coordinates.length === 0) return;

    const lats = coordinates.map(([lng, lat]) => lat);
    const lngs = coordinates.map(([lng, lat]) => lng);

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;

    const latDistance = maxLat - minLat;
    const lngDistance = maxLng - minLng;
    const totalDistance = Math.max(latDistance, lngDistance);

    const paddedLatDistance = latDistance * 1.5;
    const paddedLngDistance = lngDistance * 1.5;
    const paddedTotalDistance = Math.max(paddedLatDistance, paddedLngDistance);

    let zoomLevel = 20;
    if (paddedTotalDistance < 0.005) zoomLevel = 20;
    else if (paddedTotalDistance < 0.01) zoomLevel = 19;
    else if (paddedTotalDistance < 0.05) zoomLevel = 18;
    else if (paddedTotalDistance < 0.1) zoomLevel = 17;
    else if (paddedTotalDistance < 0.2) zoomLevel = 16;
    else zoomLevel = 16;

    // Calculate heading to view route from bottom (start) to top (end)
    const routeStart = {
      latitude: coordinates[0][1],
      longitude: coordinates[0][0],
    };
    const routeEnd = {
      latitude: coordinates[coordinates.length - 1][1],
      longitude: coordinates[coordinates.length - 1][0],
    };
    const heading = calculateBearing(routeStart, routeEnd);
    setMapCameraHeading(heading); // Store map rotation

    setTimeout(() => {
      if (mapRef.current) {
        mapRef.current.animateCamera(
          {
            center: { latitude: centerLat, longitude: centerLng },
            zoom: zoomLevel,
            pitch: 55,
            heading: heading, // Rotate camera so route goes from bottom to top
          },
          { duration: 1500 }
        );
      }
    }, 100);
  }, [routeData, userLocation]);

  const zoomToUserLocation = useCallback(() => {
    if (!mapRef.current || !userLocation) return;
    setMapCameraHeading(0); // Reset to North-up
    setTimeout(() => {
      if (mapRef.current) {
        mapRef.current.animateCamera(
          {
            center: {
              latitude: userLocation.coords.latitude,
              longitude: userLocation.coords.longitude,
            },
            zoom: 18,
            pitch: 65,
            heading: 0,
          },
          { duration: 800 }
        );
      }
    }, 100);
  }, [userLocation]);

  const fitUserAndDestination = useCallback(
    (destLat: number, destLng: number) => {
      if (!mapRef.current || !userLocation) return;

      const userLat = userLocation.coords.latitude;
      const userLng = userLocation.coords.longitude;

      const minLat = Math.min(userLat, destLat);
      const maxLat = Math.max(userLat, destLat);
      const minLng = Math.min(userLng, destLng);
      const maxLng = Math.max(userLng, destLng);

      const distance = Math.sqrt(
        Math.pow(destLat - userLat, 2) + Math.pow(destLng - userLng, 2)
      );

      let zoomLevel = 14, pitch = 40;

      if (distance < 0.001) { zoomLevel = 18; pitch = 60; }
      else if (distance < 0.005) { zoomLevel = 17; pitch = 55; }
      else if (distance < 0.01) { zoomLevel = 16; pitch = 50; }
      else if (distance < 0.05) { zoomLevel = 15; pitch = 45; }
      else if (distance < 0.1) { zoomLevel = 14; pitch = 40; }
      else { zoomLevel = 13; pitch = 35; }

      const centerLat = (minLat + maxLat) / 2;
      const centerLng = (minLng + maxLng) / 2;

      // Calculate heading from user to destination (bottom to top view)
      const heading = calculateBearing(
        { latitude: userLat, longitude: userLng },
        { latitude: destLat, longitude: destLng }
      );
      setMapCameraHeading(heading); // Store map rotation

      mapRef.current.animateCamera(
        {
          center: { latitude: centerLat, longitude: centerLng },
          zoom: zoomLevel,
          pitch: pitch,
          heading: heading, // Rotate so destination is at top
        },
        { duration: 1200 }
      );
    },
    [userLocation]
  );

  const smartZoom = useCallback(
    (destination?: { latitude: number; longitude: number }) => {
      if (!mapRef.current || !userLocation) return;

      if (destination) {
        fitUserAndDestination(destination.latitude, destination.longitude);
      } else if (droppedPinLocation) {
        fitUserAndDestination(
          droppedPinLocation.latitude,
          droppedPinLocation.longitude
        );
      } else {
        zoomToUserLocation();
      }
    },
    [
      userLocation,
      droppedPinLocation,
      fitUserAndDestination,
      zoomToUserLocation,
    ]
  );

  // Handler to quickly set the route's end location as destination
  const handleGoToEndRoute = useCallback(() => {
    if (!routeData?.path?.coordinates || routeData.path.coordinates.length === 0) return;

    const lastCoordIndex = routeData.path.coordinates.length - 1;
    const endLng = routeData.path.coordinates[lastCoordIndex][0];
    const endLat = routeData.path.coordinates[lastCoordIndex][1];

    const endLocation = {
      latitude: endLat,
      longitude: endLng,
    };

    setDroppedPinLocation(endLocation);
    setSearchQuery(routeData.end_address || "Route End");

    // Animate confirmation glow
    Animated.timing(confirmButtonGlow, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();

    // Pin bounce animation
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

    // Target pulse animation
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

    // Hide instruction if showing
    if (showInstruction) {
      Animated.timing(instructionOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => setShowInstruction(false));
    }

    // Zoom to the end location
    smartZoom(endLocation);
  }, [routeData, confirmButtonGlow, pinBounce, targetPulse, showInstruction, instructionOpacity, smartZoom]);

  const handleDestinationDragEnd = useCallback(
    (e: any) => {
      const newCoordinate = e.nativeEvent.coordinate;
      setDroppedPinLocation(newCoordinate);
      setTimeout(() => {
        smartZoom(newCoordinate);
      }, 300);
    },
    [smartZoom]
  );

  if (locationLoading || routeLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor }]}>
        <LinearGradient
          colors={["#06B6D4", "#0891B2"]}
          style={styles.loadingUrl}
        >
          <ActivityIndicator size="large" color="#ffffff" />
        </LinearGradient>
        <Text style={[styles.loadingText, { color: textColor }]}>
          {locationLoading ? "Getting your location..." : "Loading route..."}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />

      {/* Premium Pin Drop Header */}
      <View style={styles.pinDropHeaderContainer}>
        <LinearGradient
          colors={isDark
            ? ["#1a365d", "#2563eb", "#3b82f6"]
            : ["#0052d4", "#4364f7", "#6fb1fc"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.pinDropHeaderGradient}
        >
          {/* Decorative elements */}
          <View style={styles.pinDropDecorCircle1} />
          <View style={styles.pinDropDecorCircle2} />

          {/* Main Header Row */}
          <View style={styles.pinDropHeaderRow}>
            <View style={styles.headerIconContainer}>
              <LinearGradient
                colors={["#ffffff", "#f0f9ff"]}
                style={styles.headerIconGradient}
              >
                <Ionicons name="location" size={28} color="#0066FF" />
              </LinearGradient>
            </View>
            <View style={styles.headerTextContainer}>
              <Text style={styles.title}>
                {selectedRouteId
                  ? `Set Destination for ${selectedRouteName}`
                  : "Set Your Drop-off Point"}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.fullScreenCloseButton}
              onPress={handleCancel}
            >
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.pinDropInstructionsHeader}
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setShowPinDropInstructions(!showPinDropInstructions);
            }}
            activeOpacity={0.8}
          >
            <View style={styles.pinDropInstructionsHeaderLeft}>
              <Ionicons name="help-circle" size={18} color="#fff" />
              <Text style={styles.pinDropInstructionsHeaderText}>
                How to drop a pin
              </Text>
            </View>
            <View style={styles.pinDropInstructionsToggle}>
              <Ionicons
                name={showPinDropInstructions ? "chevron-up" : "chevron-down"}
                size={18}
                color="#fff"
              />
            </View>
          </TouchableOpacity>

          {showPinDropInstructions && (
            <View style={styles.pinDropInstructionsContainer}>
              {/* Step 1 */}
              <View style={styles.pinDropStep}>
                <View style={styles.pinDropStepNumber}>
                  <Text style={styles.pinDropStepNumberText}>1</Text>
                </View>
                <Text style={styles.pinDropStepText}>
                  Find a highway or national road on the map.
                </Text>
              </View>

              {/* Step 2 */}
              <View style={styles.pinDropStep}>
                <View style={styles.pinDropStepNumber}>
                  <Text style={styles.pinDropStepNumberText}>2</Text>
                </View>
                <Text style={styles.pinDropStepText}>
                  Tap to drop your pin where you want to drop off.
                </Text>
              </View>

              {/* Step 3 */}
              <View style={styles.pinDropStep}>
                <View style={styles.pinDropStepNumber}>
                  <Text style={styles.pinDropStepNumberText}>3</Text>
                </View>
                <Text style={styles.pinDropStepText}>
                  Tap "Confirm" to save your drop-off location.
                </Text>
              </View>

              {/* Important Notice */}
              <View style={styles.pinDropWarningBanner}>
                <View style={styles.pinDropWarningIcon}>
                  <Ionicons name="warning" size={16} color="#F59E0B" />
                </View>
                <Text style={styles.pinDropWarningText}>
                  Only drop a pin on <Text style={styles.pinDropWarningBold}>highways or national roads</Text> where the bus can safely stop.
                </Text>
              </View>
            </View>
          )}
        </LinearGradient>
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
        onMapReady={() => {
          if (routeData && userLocation) {
            setTimeout(() => {
              autoFitMapToRoute();
            }, 800);
          }
        }}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsBuildings={true}
        showsIndoors={true}
        pitchEnabled={true}
        rotateEnabled={true}
        zoomEnabled={true}
        scrollEnabled={true}
        mapPadding={{ top: 0, right: 0, bottom: 200, left: 0 }}
      >
        {routeData?.path?.coordinates && (
          <Polyline
            coordinates={routeData.path.coordinates.map(([lng, lat]) => ({
              latitude: lat,
              longitude: lng,
            }))}
            strokeColor={isDark ? "#22d3ee" : "#0891b2"}
            strokeWidth={4}
          />
        )}

        {/* Route Start and End Markers */}
        {routeData?.path?.coordinates && routeData.path.coordinates.length > 0 && (
          <>
            <Marker
              coordinate={{
                latitude: routeData.path.coordinates[0][1],
                longitude: routeData.path.coordinates[0][0],
              }}
              anchor={{ x: 0.5, y: 0.5 }}
              onPress={() => { }}
            >
              <View style={{ width: 32, height: 32 }}>
                <Image
                  source={require("../assets/images/start-route.png")}
                  style={{ width: 32, height: 32 }}
                  resizeMode="contain"
                />
              </View>
            </Marker>

            <Marker
              coordinate={{
                latitude: routeData.path.coordinates[routeData.path.coordinates.length - 1][1],
                longitude: routeData.path.coordinates[routeData.path.coordinates.length - 1][0],
              }}
              anchor={{ x: 0.5, y: 0.5 }}
              onPress={() => { }}
            >
              <View style={{ width: 32, height: 32 }}>
                <Image
                  source={require("../assets/images/end-route.png")}
                  style={{ width: 32, height: 32 }}
                  resizeMode="contain"
                />
              </View>
            </Marker>
          </>
        )}

        {/* User Location Marker with smooth animation */}
        {animatedUserLocation && (
          <Marker
            ref={userMarkerRef}
            coordinate={animatedUserLocation}
            anchor={{ x: 0.5, y: 0.5 }}
            onPress={() => { }}
          >
            <View style={{ width: 80, height: 80, alignItems: "center", justifyContent: "center" }}>
              {/* Compass Cone Direction Indicator */}
              {isMagnetometerAvailable && (
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    width: 80,
                    height: 80,
                    transform: [{ rotate: `${(compassHeading - mapCameraHeading + 360) % 360}deg` }],
                  }}
                >
                  <Svg width={80} height={80} viewBox="0 0 120 120">
                    <Path
                      d="M60,60 L60,8 A52,52 0 0,1 95,25 Z"
                      fill="rgba(59, 130, 246, 0.35)"
                    />
                    <Path
                      d="M60,60 L95,25 A52,52 0 0,1 100,40 Z"
                      fill="rgba(59, 130, 246, 0.25)"
                    />
                    <Path
                      d="M60,60 L25,25 A52,52 0 0,1 60,8 Z"
                      fill="rgba(59, 130, 246, 0.35)"
                    />
                    <Path
                      d="M60,60 L20,40 A52,52 0 0,1 25,25 Z"
                      fill="rgba(59, 130, 246, 0.25)"
                    />
                    <Polygon
                      points="60,10 55,30 60,25 65,30"
                      fill="rgba(59, 130, 246, 0.6)"
                    />
                  </Svg>
                </View>
              )}
              <Image
                source={require("../assets/images/user-pin.png")}
                style={{ width: 36, height: 36 }}
                resizeMode="contain"
              />
            </View>
          </Marker>
        )}

        {/* Destination Pin */}
        {droppedPinLocation && (
          <Marker
            coordinate={droppedPinLocation}
            draggable
            onDragEnd={handleDestinationDragEnd}
            anchor={{ x: 0.5, y: 1 }}
            onPress={() => { }}
          >
            <View style={{ width: 40, height: 40 }}>
              <Image
                source={require("../assets/images/destination-flag.png")}
                style={{ width: 40, height: 40 }}
                resizeMode="contain"
              />
            </View>
          </Marker>
        )}
      </MapView>

      {/* Search Bar - Floating
      
      <Animated.View
        style={[
          styles.searchContainer,
          {
            transform: [{ scale: searchBarScale }],
          },
        ]}
      >
        <View style={[styles.searchInputContainer, { backgroundColor: isDark ? "#1f2937" : "#fff" }]}>
          <Ionicons
            name="search"
            size={20}
            color={isDark ? "#9ca3af" : "#6b7280"}
          />
          <TextInput
            style={[styles.searchInput, { color: textColor }]}
            placeholder="Search destination..."
            placeholderTextColor={isDark ? "#6b7280" : "#9ca3af"}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onFocus={() => {
              setShowSearchResults(true);
              setSearchBarFocused(true);
            }}
            onBlur={() => {
              setSearchBarFocused(false);
            }}
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
                color={isDark ? "#6b7280" : "#9ca3af"}
              />
            </TouchableOpacity>
          )}
        </View>

        {/* Search Results */}
      {/* {showSearchResults && predictions.length > 0 && (
          <View style={[styles.searchResultsContainer, { backgroundColor: isDark ? "#1f2937" : "#fff" }]}>
            <FlatList
              data={predictions}
              keyExtractor={(item) => item.place_id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.searchResultItem, { borderBottomColor: separatorColor }]}
                  onPress={() => handlePredictionSelect(item.place_id)}
                >
                  <View style={styles.searchResultIcon}>
                    <Ionicons name="location" size={16} color={primaryColor} />
                  </View>
                  <Text style={[styles.searchResultText, { color: textColor }]}>
                    {item.description}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        )}
      </Animated.View> */}

      {/* Floating Map Controls */}
      {/* <View style={styles.floatingControls}>
        <TouchableOpacity
          style={styles.floatingButtonWrapper}
          onPress={zoomToUserLocation}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={isDark ? ["#0e7490", "#155e75"] : ["#06B6D4", "#0891B2"]}
            style={styles.floatingButton}
          >
            <Ionicons name="locate" size={20} color="#fff" />
          </LinearGradient>
        </TouchableOpacity>

        {routeData && (
          <TouchableOpacity
            style={styles.floatingButtonWrapper}
            onPress={autoFitMapToRoute}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={isDark ? ["#4b5563", "#374151"] : ["#9CA3AF", "#6B7280"]}
              style={styles.floatingButton}
            >
              <Ionicons name="map-outline" size={20} color="#fff" />
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View> */

      /* Instruction Banner - Floating Pill
      {showInstruction && (
        <Animated.View style={[styles.instructionPill, { opacity: instructionOpacity }]}>
          <LinearGradient
            colors={droppedPinLocation
              ? ["#10B981", "#059669"]
              : ["rgba(0,0,0,0.7)", "rgba(0,0,0,0.85)"]}
            style={styles.instructionGradient}
          >
            <Ionicons
              name={droppedPinLocation ? "checkmark-circle" : "information-circle"}
              size={16}
              color="#fff"
            />
            <Text style={styles.instructionText}>
              {droppedPinLocation
                ? "Destination set. Drag to adjust."
                : "Tap map or search to set destination"}
            </Text>
          </LinearGradient>
        </Animated.View>
      )} */}

      {/* Bottom Action Bar */}
      <View style={[styles.bottomBar, { backgroundColor: isDark ? "#111827" : "#fff" }]}>
        <Text style={[styles.bottomBarTitle, { color: isDark ? "#9CA3AF" : "#6B7280" }]}>
          {droppedPinLocation ? "Confirm your destination" : "Select a destination"}
        </Text>

        {/* Go to End Route Quick Button */}
        {routeData?.end_address && !droppedPinLocation && (
          <TouchableOpacity
            style={[styles.goToEndRouteButton, isDark && styles.goToEndRouteButtonDark]}
            onPress={handleGoToEndRoute}
            activeOpacity={0.7}
          >
            <Ionicons name="flag" size={18} color={isDark ? "#22d3ee" : "#0891b2"} />
            <Text style={[styles.goToEndRouteText, { color: isDark ? "#22d3ee" : "#0891b2" }]} numberOfLines={1}>
              Go to {routeData.end_address}
            </Text>
            <Ionicons name="arrow-forward" size={16} color={isDark ? "#22d3ee" : "#0891b2"} />
          </TouchableOpacity>
        )}

        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.cancelButton, isDark && styles.cancelButtonDark]}
            onPress={handleCancel}
          >
            <Text style={[styles.cancelButtonText, { color: isDark ? "#9CA3AF" : "#6B7280" }]}>Cancel</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.confirmButtonWrapper, !droppedPinLocation && styles.disabledButton]}
            onPress={handleConfirmDestination}
            disabled={!droppedPinLocation || isGeocoding}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={droppedPinLocation
                ? (isDark ? ["#0e7490", "#155e75"] : ["#06B6D4", "#0891B2"])
                : (isDark ? ["#374151", "#1f2937"] : ["#E5E7EB", "#D1D5DB"])}
              style={styles.confirmButton}
            >
              {isGeocoding ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Text style={styles.confirmButtonText}>
                    {droppedPinLocation ? "Confirm" : "Select on Map"}
                  </Text>
                  {droppedPinLocation && <Ionicons name="arrow-forward" size={18} color="#fff" />}
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingUrl: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  loadingText: {
    fontSize: 16,
    fontWeight: "600",
  },

  // Header
  header: {
    paddingTop: 50,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    zIndex: 10,
    position: "relative",
    overflow: "hidden",
  },
  headerDecorativeCircle1: {
    position: "absolute",
    top: -20,
    right: -20,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  headerDecorativeCircle2: {
    position: "absolute",
    bottom: -10,
    left: -10,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  headerTextContainer: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fff",
  },
  subtitle: {
    fontSize: 14,
    color: "rgba(255,255,255,0.8)",
    marginTop: 2,
  },

  // Map
  map: {
    flex: 1,
  },
  userMarkerContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  userLocationRipple: {
    position: "absolute",
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(6, 182, 212, 0.3)",
    borderWidth: 1,
    borderColor: "rgba(6, 182, 212, 0.5)",
  },
  userMarkerIcon: {
    width: 32,
    height: 32,
  },
  destinationPin: {
    alignItems: "center",
    width: 48,
    height: 48,
    justifyContent: "flex-end",
  },
  destinationIcon: {
    width: 44,
    height: 44,
    marginBottom: 4,
  },
  targetCircle: {
    position: "absolute",
    bottom: -4,
    width: 16,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(0,0,0,0.3)",
  },

  // Search Bar
  searchContainer: {
    position: "absolute",
    top: 180, // Below new header
    left: 20,
    right: 20,
    zIndex: 20,
  },
  searchInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    marginLeft: 8,
    marginRight: 8,
  },
  searchResultsContainer: {
    marginTop: 8,
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  searchResultItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
  },
  searchResultIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(6, 182, 212, 0.1)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  searchResultText: {
    fontSize: 14,
  },

  // Controls
  floatingControls: {
    position: "absolute",
    right: 20,
    bottom: 250,
    gap: 12,
  },
  floatingButtonWrapper: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  floatingButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
  },

  // Instruction Pill
  instructionPill: {
    position: "absolute",
    top: 250, // Below search
    alignSelf: "center",
    zIndex: 15,
  },
  instructionGradient: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  instructionText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },

  // Bottom Action Bar
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 24,
    paddingBottom: 40,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 20,
    zIndex: 30,
  },
  bottomBarTitle: {
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
    marginBottom: 16,
  },
  goToEndRouteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8, 145, 178, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(8, 145, 178, 0.3)",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
    gap: 8,
  },
  goToEndRouteButtonDark: {
    backgroundColor: "rgba(34, 211, 238, 0.1)",
    borderColor: "rgba(34, 211, 238, 0.3)",
  },
  goToEndRouteText: {
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  actionButtons: {
    flexDirection: "row",
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButtonDark: {
    backgroundColor: "#374151",
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  confirmButtonWrapper: {
    flex: 1.5,
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#06B6D4",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  disabledButton: {
    shadowOpacity: 0,
    elevation: 0,
  },
  confirmButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    gap: 8,
  },
  confirmButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },

  // Premium Pin Drop Header Styles
  pinDropHeaderContainer: {
    zIndex: 10,
  },
  pinDropHeaderGradient: {
    paddingTop: 50,
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    position: "relative",
    overflow: "hidden",
  },
  pinDropDecorCircle1: {
    position: "absolute",
    top: -30,
    right: -30,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  pinDropDecorCircle2: {
    position: "absolute",
    top: 50,
    right: 60,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  pinDropHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  headerIconContainer: {
    marginRight: 14,
  },
  headerIconGradient: {
    width: 50,
    height: 50,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  fullScreenCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  pinDropInstructionsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
  },
  pinDropInstructionsHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pinDropInstructionsHeaderText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  pinDropInstructionsToggle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  pinDropInstructionsContainer: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    gap: 12,
  },
  pinDropStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  pinDropStepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.25)",
    justifyContent: "center",
    alignItems: "center",
  },
  pinDropStepNumberText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
  pinDropStepText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
    color: "rgba(255, 255, 255, 0.95)",
    lineHeight: 20,
  },
  pinDropWarningBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.3)",
  },
  pinDropWarningIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(245, 158, 11, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  pinDropWarningText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
    color: "rgba(255, 255, 255, 0.9)",
    lineHeight: 19,
  },
  pinDropWarningBold: {
    fontWeight: "700",
    color: "#fff",
  },
});
