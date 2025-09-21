import { mapDarkStyle } from "@/constants/mapDarkStyle";
import { useAppTheme } from "@/contexts/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";

const { width, height } = Dimensions.get('window');

// Route type definition
type Route = {
  id: string;
  name: string;
  start_address: string | null;
  end_address: string | null;
};

// Location type
type LocationData = {
  latitude: number;
  longitude: number;
  timestamp: number;
};

const GPSTrackingScreen = () => {
  const { theme } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const mapRef = useRef<MapView>(null);
  
  // State management
  const [currentLocation, setCurrentLocation] = useState<LocationData | null>(null);
  const [passengerCount, setPassengerCount] = useState(10);
  const [tripDuration, setTripDuration] = useState(0);
  const [expectedDuration, setExpectedDuration] = useState(45);
  const [isTracking, setIsTracking] = useState(true);
  const [route, setRoute] = useState<Route | null>(null);
  const [locationPermission, setLocationPermission] = useState<boolean | null>(null);
  const [locationHistory, setLocationHistory] = useState<LocationData[]>([]);
  
  // Timer for trip duration
  const [startTime, setStartTime] = useState<number>(Date.now());

  // Initialize route from parameters
  useEffect(() => {
    if (params.routeId) {
      setRoute({
        id: params.routeId as string,
        name: params.routeName as string,
        start_address: params.startAddress as string,
        end_address: params.endAddress as string,
      });
    } else {
      // Default route for demo
      setRoute({
        id: "1",
        name: "Business Center Digos to Kapatagan Bu...",
        start_address: "Business Center Digos",
        end_address: "Kapatagan Bu...",
      });
    }
  }, [params]);

  // Request location permissions and start tracking
  useEffect(() => {
    requestLocationPermission();
    setStartTime(Date.now());
  }, []);

  // Update trip duration every second
  useEffect(() => {
    const interval = setInterval(() => {
      if (isTracking) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setTripDuration(elapsed);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isTracking, startTime]);

  // Start location tracking
  useEffect(() => {
    if (locationPermission) {
      startLocationTracking();
    }
  }, [locationPermission]);

  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Denied',
          'Location permission is required for GPS tracking. Please enable it in settings.',
          [{ text: 'OK', onPress: () => router.back() }]
        );
        return;
      }
      setLocationPermission(true);
    } catch (error) {
      console.error('Error requesting location permission:', error);
      Alert.alert('Error', 'Failed to request location permission');
    }
  };

  const startLocationTracking = () => {
    const locationSubscription = Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,
        distanceInterval: 10,
      },
      (location) => {
        const newLocation: LocationData = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          timestamp: Date.now(),
        };
        
        setCurrentLocation(newLocation);
        setLocationHistory(prev => [...prev, newLocation]);
        
        // Center map on current location
        if (mapRef.current) {
          mapRef.current.animateToRegion({
            latitude: newLocation.latitude,
            longitude: newLocation.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }, 1000);
        }
      }
    );

    return () => {
      locationSubscription.then(subscription => subscription.remove());
    };
  };

  const handlePassengerIncrement = () => {
    setPassengerCount(prev => prev + 1);
  };

  const handlePassengerDecrement = () => {
    setPassengerCount(prev => Math.max(0, prev - 1));
  };

  const handleEndTrip = () => {
    Alert.alert(
      'End Trip',
      'Are you sure you want to end this trip?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'End Trip',
          style: 'destructive',
          onPress: () => {
            setIsTracking(false);
            router.back();
          },
        },
      ]
    );
  };

  // Sample route coordinates for demonstration
  const routeCoordinates = [
    { latitude: 6.7536, longitude: 125.356 },
    { latitude: 6.7520, longitude: 125.355 },
    { latitude: 6.7500, longitude: 125.354 },
    { latitude: 6.7480, longitude: 125.353 },
    { latitude: 6.7460, longitude: 125.352 },
    { latitude: 6.7440, longitude: 125.351 },
    { latitude: 6.7420, longitude: 125.350 },
  ];

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar style="light" />
      
      {/* Map Container */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          provider="google"
          customMapStyle={theme === "dark" ? [...mapDarkStyle] : []}
          initialRegion={{
            latitude: 6.7536,
            longitude: 125.356,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass={false}
          showsScale={true}
        >
          {/* Route Polyline */}
          <Polyline
            coordinates={routeCoordinates}
            strokeColor="#007AFF"
            strokeWidth={6}
            lineDashPattern={[10, 5]}
          />

          {/* Current Location Marker */}
          {currentLocation && (
            <Marker
              coordinate={{
                latitude: currentLocation.latitude,
                longitude: currentLocation.longitude,
              }}
              title="Current Location"
            >
              <View style={styles.busMarker}>
                <Ionicons name="bus" size={20} color="#FFFFFF" />
              </View>
            </Marker>
          )}

          {/* Points of Interest */}
          <Marker
            coordinate={{ latitude: 6.7600, longitude: 125.3600 }}
            title="Dominican Hospital"
          >
            <View style={styles.hospitalMarker}>
              <Ionicons name="medical" size={16} color="#FF3B30" />
            </View>
          </Marker>

          <Marker
            coordinate={{ latitude: 6.7550, longitude: 125.3580 }}
            title="Gaisano Center"
          >
            <View style={styles.shoppingMarker}>
              <Ionicons name="cart" size={16} color="#007AFF" />
            </View>
          </Marker>

          <Marker
            coordinate={{ latitude: 6.7500, longitude: 125.3550 }}
            title="Cor Jesu College"
          >
            <View style={styles.schoolMarker}>
              <Ionicons name="school" size={16} color="#34C759" />
            </View>
          </Marker>

          <Marker
            coordinate={{ latitude: 6.7480, longitude: 125.3530 }}
            title="Kingstar Plaza Inn"
          >
            <View style={styles.hotelMarker}>
              <Ionicons name="bed" size={16} color="#AF52DE" />
            </View>
          </Marker>

          <Marker
            coordinate={{ latitude: 6.7450, longitude: 125.3510 }}
            title="Mang Inasal"
          >
            <View style={styles.restaurantMarker}>
              <Ionicons name="restaurant" size={16} color="#FF9500" />
            </View>
          </Marker>

          <Marker
            coordinate={{ latitude: 6.7420, longitude: 125.3490 }}
            title="Acoustics Bar & Grill"
          >
            <View style={styles.barMarker}>
              <Ionicons name="wine" size={16} color="#8E44AD" />
            </View>
          </Marker>
        </MapView>

        {/* Header with Back Button and Route */}
        <View style={styles.headerContainer}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          
          <View style={styles.routeBanner}>
            <Text style={styles.routeTitle} numberOfLines={1}>
              {route?.name || "Bansalan Terminal -> Digos Terminal"}
            </Text>
          </View>
        </View>
      </View>

      {/* Bottom Controls */}
      <View style={styles.bottomControls}>
        {/* Passenger Count Card */}
        <View style={styles.passengerCard}>
          <TouchableOpacity 
            style={styles.passengerButton}
            onPress={handlePassengerDecrement}
          >
            <Ionicons name="remove" size={24} color="#FF3B30" />
          </TouchableOpacity>
          
          <View style={styles.passengerCount}>
            <Text style={styles.passengerNumber}>{passengerCount}</Text>
            <Text style={styles.passengerLabel}>Passengers</Text>
          </View>
          
          <TouchableOpacity 
            style={styles.passengerButton}
            onPress={handlePassengerIncrement}
          >
            <Ionicons name="add" size={24} color="#34C759" />
          </TouchableOpacity>
        </View>

        {/* End Trip Button */}
        <TouchableOpacity 
          style={styles.endTripButton}
          onPress={handleEndTrip}
        >
          <Ionicons name="stop" size={24} color="#FFFFFF" />
          <Text style={styles.endTripButtonText}>End Trip</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  
  // Map Container
  mapContainer: {
    flex: 1,
    position: "relative",
  },
  map: {
    flex: 1,
  },

  // Header Container
  headerContainer: {
    position: "absolute",
    top: 45,
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    zIndex: 10,
    maxWidth: width - 24,
  },

  // Back Button
  backButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },

  // Route Banner
  routeBanner: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    maxWidth: width * 0.65, // Limit banner width to 65% of screen
  },
  routeTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1c1c1e",
    textAlign: "left",
  },

  // Markers
  busMarker: {
    backgroundColor: "#007AFF",
    padding: 8,
    borderRadius: 20,
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  hospitalMarker: {
    backgroundColor: "#FFFFFF",
    padding: 6,
    borderRadius: 15,
    shadowColor: "#FF3B30",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  shoppingMarker: {
    backgroundColor: "#FFFFFF",
    padding: 6,
    borderRadius: 15,
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  schoolMarker: {
    backgroundColor: "#FFFFFF",
    padding: 6,
    borderRadius: 15,
    shadowColor: "#34C759",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  hotelMarker: {
    backgroundColor: "#FFFFFF",
    padding: 6,
    borderRadius: 15,
    shadowColor: "#AF52DE",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  restaurantMarker: {
    backgroundColor: "#FFFFFF",
    padding: 6,
    borderRadius: 15,
    shadowColor: "#FF9500",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  barMarker: {
    backgroundColor: "#FFFFFF",
    padding: 6,
    borderRadius: 15,
    shadowColor: "#8E44AD",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },

  // Bottom Controls
  bottomControls: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "transparent",
    paddingHorizontal: 20,
    paddingBottom: 20,
  },

  // Passenger Card
  passengerCard: {
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  passengerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F2F2F7",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  passengerCount: {
    alignItems: "center",
    marginHorizontal: 32,
  },
  passengerNumber: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#007AFF",
  },
  passengerLabel: {
    fontSize: 14,
    color: "#8e8e93",
    marginTop: 4,
  },

  // End Trip Button
  endTripButton: {
    backgroundColor: "#FF3B30",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: 12,
    shadowColor: "#FF3B30",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  endTripButtonText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#FFFFFF",
    marginLeft: 8,
  },
});

export default GPSTrackingScreen;
