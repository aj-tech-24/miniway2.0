import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { Camera, CameraView } from "expo-camera";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Marker, Polyline, Region } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";

type LatLng = { latitude: number; longitude: number };

const LOCATION_UPDATE_INTERVAL = 2000; // ms

// Helper: Calculate distance between two LatLng points (Haversine formula)
function getDistance(a: LatLng, b: LatLng) {
  const R = 6371000; // meters
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;

  const x = dLat / 2;
  const y = dLon / 2;
  const aVal =
    Math.sin(x) * Math.sin(x) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(y) * Math.sin(y);
  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
  return R * c;
}

// Helper: Find minimum distance from driver to polyline
function getMinDistanceToRoute(driver: LatLng, route: LatLng[]) {
  if (!driver || !route.length) return Infinity;
  return Math.min(...route.map((pt) => getDistance(driver, pt)));
}

const DrivingModeScreen = () => {
  // All hooks here!
  const {
    path,
    capacity,
    passengers,
    routeName,
    departureTime,
    tripId,
    busId,
  } = useLocalSearchParams<{
    path: string;
    capacity: string;
    passengers: string;
    routeName: string;
    departureTime: string;
    tripId?: string;
    busId?: string;
  }>();

  const router = useRouter();

  let polylineCoords: LatLng[] = [];
  try {
    polylineCoords = path
      ? JSON.parse(path).map(([lng, lat]: [number, number]) => ({
          latitude: lat,
          longitude: lng,
        }))
      : [];
  } catch (e) {
    polylineCoords = [];
  }

  const parsedCapacity = capacity ? parseInt(capacity, 10) : 0;
  const [passengerCount, setPassengerCount] = useState(
    passengers ? parseInt(passengers, 10) : 0
  );
  const [pickupRequest, setPickupRequest] = useState<string | null>(null);
  const [offRouteWarning, setOffRouteWarning] = useState(false);

  // Driver's current location
  const [driverLocation, setDriverLocation] = useState<LatLng | null>(
    polylineCoords[0] || null
  );
  const mapRef = useRef<MapView>(null);

  // End Trip Handler
  const [endingTrip, setEndingTrip] = useState(false);
  // NEW: QR Code scanner state
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const scanLineAnimation = useRef(new Animated.Value(0)).current;

  // All useEffect hooks here!
  useEffect(() => {
    let locationSubscription: Location.LocationSubscription | null = null;

    async function startLocationUpdates() {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      locationSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: LOCATION_UPDATE_INTERVAL,
          distanceInterval: 5,
        },
        (location) => {
          const coords = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          };
          setDriverLocation(coords);

          // Animate camera to follow driver with 3D effect
          mapRef.current?.animateCamera(
            {
              center: coords,
              pitch: 80, // Increase pitch for 3D
              zoom: 17, // Higher zoom for closer view
              heading: location.coords.heading || 0, // Use device heading if available
            },
            { duration: 800 }
          );
        }
      );
    }

    startLocationUpdates();

    return () => {
      locationSubscription?.remove();
    };
  }, []);

  useEffect(() => {
    if (!driverLocation || !polylineCoords.length) return;
    const minDist = getMinDistanceToRoute(driverLocation, polylineCoords);
    setOffRouteWarning(minDist > 100); // 100 meters threshold
  }, [driverLocation, polylineCoords]);

  // NEW: Request camera permissions for QR scanner
  useEffect(() => {
    (async () => {
      // Changed to Camera.requestCameraPermissionsAsync()
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === "granted");
    })();
  }, []);

  // Animation for scanning line
  useEffect(() => {
    if (scanning && !scanned) {
      const startAnimation = () => {
        scanLineAnimation.setValue(0);
        Animated.timing(scanLineAnimation, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }).start(() => {
          if (scanning && !scanned) {
            startAnimation();
          }
        });
      };
      startAnimation();
    } else {
      scanLineAnimation.stopAnimation();
    }
  }, [scanning, scanned, scanLineAnimation]);

  // NEW: Handle scanned QR code
  const handleBarCodeScanned = async ({
    type,
    data,
  }: {
    type: string;
    data: string;
  }) => {
    setScanned(true);
    setScanning(false);
    try {
      const payload = JSON.parse(data);
      if (
        payload.type === "pickup_request" &&
        payload.commuterId &&
        payload.busId === busId
      ) {
        console.log("QR Scan Payload:", payload);

        // Handle tripId - create one if missing
        let tripId = payload.tripId;

        if (!tripId || tripId === "will-be-created") {
          console.log("No tripId in QR, creating new trip for bus:", busId);
          const { data: newTrip, error: createError } = await supabase
            .from("trips")
            .insert({
              bus_id: busId,
              status: "waiting",
            })
            .select("id")
            .single();

          if (createError) {
            console.error("Error creating trip:", createError);
            Alert.alert("Error", "Failed to create trip. Please try again.");
            return;
          }
          tripId = newTrip.id;
          console.log("Created new trip:", tripId);
        }

        // Insert boarding record into trip_passengers table
        const boardingData = {
          bus_id: busId,
          passenger_id: payload.commuterId,
          trip_id: tripId,
          pickup_lat: payload.pickup.latitude,
          pickup_lng: payload.pickup.longitude,
          dest_lat: payload.dest.latitude,
          dest_lng: payload.dest.longitude,
          status: "boarded",
          boarded_at: new Date().toISOString(),
        };

        console.log("Inserting boarding record:", boardingData);

        const { data: insertedRecord, error: boardingError } = await supabase
          .from("trip_passengers")
          .insert(boardingData)
          .select()
          .single();

        if (boardingError) {
          console.error("Error inserting boarding record:", boardingError);
          Alert.alert("Error", "Failed to record passenger boarding.");
          return;
        }

        console.log("Successfully inserted boarding record:", insertedRecord);

        // Check current trip status and update to 'ongoing' if 'waiting'
        const { data: currentTrip, error: fetchError } = await supabase
          .from("trips")
          .select("status")
          .eq("id", tripId)
          .single();

        if (fetchError) {
          console.error("Error fetching trip status:", fetchError);
          Alert.alert("Error", "Failed to fetch trip status.");
          return;
        }

        if (currentTrip.status === "waiting") {
          const { error: updateError } = await supabase
            .from("trips")
            .update({ status: "ongoing" })
            .eq("id", tripId)
            .eq("bus_id", busId);

          if (updateError) {
            console.error(
              "Error updating trip status to ongoing:",
              updateError
            );
            Alert.alert("Error", "Failed to update trip status to ongoing.");
          }
        }

        // Increment passenger count and show success
        setPassengerCount((p) => Math.min(p + 1, parsedCapacity));
        Alert.alert(
          "Passenger Picked Up",
          `Commuter ${payload.commuterId} has been boarded successfully!`
        );
      } else {
        Alert.alert(
          "Invalid QR Code",
          "This QR code is not a valid pickup request for this bus."
        );
      }
    } catch (e) {
      console.error("Error processing QR code:", e);
      Alert.alert("Invalid QR Code", "Could not parse QR code data.");
    }
    // Reset scanned state after a short delay to allow scanning again
    setTimeout(() => setScanned(false), 2000);
  };

  // MODIFIED: Dummy QR scan handler -> Actual QR scan trigger
  const handleQRScan = () => {
    if (hasPermission === null) {
      Alert.alert(
        "Requesting Camera Permission",
        "Please grant camera permission to scan QR codes."
      );
    } else if (hasPermission === false) {
      Alert.alert(
        "Camera Permission Denied",
        "Cannot scan QR codes without camera access."
      );
    } else {
      setScanning(true);
    }
  };

  const handleEndTrip = async () => {
    if (!tripId || !busId) return;
    Alert.alert(
      "End Trip",
      "Are you sure you want to end this trip? This will remove all boarded passengers.",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "End Trip",
          style: "destructive",
          onPress: async () => {
            setEndingTrip(true);
            try {
              // 1. Cancel/remove all passengers that boarded for this trip
              const { error: passengersError } = await supabase
                .from("trip_passengers")
                .update({ status: "cancelled" })
                .eq("trip_id", tripId)
                .eq("bus_id", busId);

              if (passengersError) {
                console.error("Error cancelling passengers:", passengersError);
                Alert.alert("Error", "Failed to cancel passenger bookings.");
                setEndingTrip(false);
                return;
              }

              console.log("Successfully cancelled all passenger bookings");

              // 2. Update trip status to completed
              const { error: tripError } = await supabase
                .from("trips")
                .update({ status: "completed" })
                .eq("id", tripId);

              if (tripError) {
                console.error("Error updating trip status:", tripError);
                Alert.alert("Error", "Failed to update trip status.");
                setEndingTrip(false);
                return;
              }

              // 3. Reset bus passenger count to 0 and set status to inactive
              const { error: busError } = await supabase
                .from("buses")
                .update({
                  status: "inactive",
                  passengers: 0,
                })
                .eq("id", busId);

              if (busError) {
                console.error("Error updating bus status:", busError);
                Alert.alert("Error", "Failed to update bus status.");
                setEndingTrip(false);
                return;
              }

              console.log("Successfully ended trip and reset bus");
              Alert.alert(
                "Success",
                "Trip ended successfully! All passengers have been removed."
              );
              router.replace("/(driver)");
            } catch (error) {
              console.error("Unexpected error ending trip:", error);
              Alert.alert(
                "Error",
                "An unexpected error occurred while ending the trip."
              );
            } finally {
              setEndingTrip(false);
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  // Only return UI after all hooks
  if (!driverLocation || !polylineCoords.length) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#f2f2f7" }}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
          <Text>No route or location data available.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const initialRegion: Region = {
    ...driverLocation,
    latitudeDelta: 0.005, // smaller value = more zoom
    longitudeDelta: 0.005,
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#f2f2f7" }}>
      {/* Top Gradient Bar for status and info */}
      <LinearGradient
        colors={["#007AFF", "#00c6ff"]}
        start={[0, 0]}
        end={[1, 1]}
        style={styles.topBar}
      >
        <Text style={styles.routeName}>{routeName}</Text>
        <Text style={styles.infoText}>Departure: {departureTime}</Text>
        <Text style={styles.infoText}>
          Capacity: {parsedCapacity} | Passengers: {passengerCount}
        </Text>
        <Text style={styles.infoText}>
          Location: {driverLocation.latitude.toFixed(5)},{" "}
          {driverLocation.longitude.toFixed(5)}
        </Text>
        {offRouteWarning && (
          <View style={styles.warningPanel}>
            <Ionicons name="warning" size={20} color="#fff" />
            <Text style={styles.warningText}>You are off the route!</Text>
          </View>
        )}
      </LinearGradient>

      <View style={styles.container}>
        {/* Map */}
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={initialRegion}
          showsUserLocation
          showsMyLocationButton
          showsBuildings={true}
        >
          {polylineCoords.length > 0 && (
            <Polyline
              coordinates={polylineCoords}
              strokeColor="#007AFF"
              strokeWidth={6}
            />
          )}
          {driverLocation && (
            <Marker coordinate={driverLocation} title="You (Driver)">
              <Ionicons name="bus" size={32} color="#007AFF" />
            </Marker>
          )}
        </MapView>

        {/* Action Buttons */}
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.actionButton} onPress={handleQRScan}>
            <Ionicons name="qr-code" size={24} color="#fff" />
            <Text style={styles.actionButtonText}>Scan QR</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: "#ff4d4f" }]}
            onPress={handleEndTrip}
            disabled={endingTrip}
          >
            <Ionicons name="stop" size={24} color="#fff" />
            <Text style={styles.actionButtonText}>
              {endingTrip ? "Ending..." : "End Trip"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Improved QR Code Scanner Modal */}
      <Modal
        animationType="slide"
        transparent={false}
        visible={scanning}
        onRequestClose={() => setScanning(false)}
      >
        <View style={styles.qrScannerContainer}>
          <CameraView
            onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            barcodeScannerSettings={{
              barcodeTypes: ["qr"],
            }}
            style={StyleSheet.absoluteFillObject}
          />

          {/* Top Header */}
          <View style={styles.qrHeader}>
            <TouchableOpacity
              style={styles.qrBackButton}
              onPress={() => setScanning(false)}
            >
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.qrHeaderTitle}>Scan Passenger QR</Text>
            <View style={styles.qrHeaderSpacer} />
          </View>

          {/* Scanning Frame Overlay */}
          <View style={styles.qrOverlay}>
            {/* Middle Section - Scanning Frame */}
            <View style={styles.qrMiddleSection}>
              <View style={styles.qrScanningFrame}>
                {/* Corner indicators */}
                <View style={[styles.qrCorner, styles.qrTopLeft]} />
                <View style={[styles.qrCorner, styles.qrTopRight]} />
                <View style={[styles.qrCorner, styles.qrBottomLeft]} />
                <View style={[styles.qrCorner, styles.qrBottomRight]} />

                {/* Scanning line animation */}
                {!scanned && (
                  <Animated.View
                    style={[
                      styles.qrScanningLine,
                      {
                        transform: [
                          {
                            translateY: scanLineAnimation.interpolate({
                              inputRange: [0, 1],
                              outputRange: [-100, 100],
                            }),
                          },
                        ],
                      },
                    ]}
                  />
                )}
              </View>
            </View>

            {/* Bottom Section */}
            <View style={styles.qrBottomSection}>
              <View style={styles.qrStatusContainer}>
                {scanned ? (
                  <View style={styles.qrSuccessContainer}>
                    <Ionicons
                      name="checkmark-circle"
                      size={48}
                      color="#4CAF50"
                    />
                    <Text style={styles.qrSuccessText}>QR Code Scanned!</Text>
                    <Text style={styles.qrSuccessSubtext}>
                      Processing passenger data...
                    </Text>
                  </View>
                ) : (
                  <View style={styles.qrWaitingContainer}>
                    <Ionicons name="scan-outline" size={48} color="#fff" />
                    <Text style={styles.qrWaitingText}>
                      Waiting for QR Code
                    </Text>
                    <Text style={styles.qrWaitingSubtext}>
                      Make sure the QR code is clearly visible
                    </Text>
                  </View>
                )}
              </View>

              <TouchableOpacity
                style={styles.qrCancelButton}
                onPress={() => setScanning(false)}
              >
                <Ionicons name="close" size={20} color="#fff" />
                <Text style={styles.qrCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f2f2f7",
  },
  map: { flex: 1 },
  topBar: {
    paddingTop: 18,
    paddingBottom: 12,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    elevation: 4,
    shadowColor: "#007AFF",
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  routeName: { fontSize: 20, fontWeight: "bold", color: "#fff" },
  infoText: { fontSize: 15, color: "#e6f0fa", marginTop: 2 },
  warningPanel: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ff4d4f",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 8,
    alignSelf: "flex-start",
  },
  warningText: { color: "#fff", marginLeft: 6, fontWeight: "bold" },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 18,
    backgroundColor: "#fff",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    elevation: 8,
    shadowColor: "#007AFF",
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#007AFF",
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 24,
    elevation: 2,
  },
  actionButtonText: {
    color: "#fff",
    fontSize: 16,
    marginLeft: 8,
    fontWeight: "bold",
  },
  // Improved QR Scanner Modal Styles
  qrScannerContainer: {
    flex: 1,
    backgroundColor: "black",
  },
  qrHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: "rgba(0,0,0,0.7)",
    zIndex: 10,
  },
  qrBackButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  qrHeaderTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  qrHeaderSpacer: {
    width: 40,
  },
  qrOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "space-between",
    paddingTop: 120,
    paddingBottom: 50,
    paddingHorizontal: 20,
  },
  qrMiddleSection: {
    flex: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  qrScanningFrame: {
    width: 250,
    height: 250,
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
  },
  qrCorner: {
    position: "absolute",
    width: 30,
    height: 30,
    borderColor: "#007AFF",
    borderWidth: 4,
  },
  qrTopLeft: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  qrTopRight: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
  },
  qrBottomLeft: {
    bottom: 0,
    left: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
  },
  qrBottomRight: {
    bottom: 0,
    right: 0,
    borderLeftWidth: 0,
    borderTopWidth: 0,
  },
  qrScanningLine: {
    position: "absolute",
    width: 200,
    height: 2,
    backgroundColor: "#007AFF",
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 5,
  },
  qrBottomSection: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  qrStatusContainer: {
    alignItems: "center",
    marginBottom: 30,
  },
  qrSuccessContainer: {
    alignItems: "center",
    backgroundColor: "rgba(76,175,80,0.1)",
    paddingHorizontal: 30,
    paddingVertical: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(76,175,80,0.3)",
  },
  qrSuccessText: {
    color: "#4CAF50",
    fontSize: 18,
    fontWeight: "bold",
    marginTop: 12,
    marginBottom: 4,
  },
  qrSuccessSubtext: {
    color: "#e0e0e0",
    fontSize: 14,
    textAlign: "center",
  },
  qrWaitingContainer: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 30,
    paddingVertical: 20,
    borderRadius: 16,
  },
  qrWaitingText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    marginTop: 12,
    marginBottom: 4,
  },
  qrWaitingSubtext: {
    color: "#e0e0e0",
    fontSize: 14,
    textAlign: "center",
  },
  qrCancelButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  qrCancelButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "500",
    marginLeft: 8,
  },
});

export default DrivingModeScreen;
