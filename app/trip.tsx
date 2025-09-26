import { mapDarkStyle } from "@/constants/mapDarkStyle";
import { useAuth } from "@/contexts/AuthContext";
import { useAppTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Camera, LatLng, Marker, Polyline } from "react-native-maps";

type BusLocation = LatLng;

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLEMAPS_API;

const haversineMeters = (a: LatLng, b: LatLng) => {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const calculateBearing = (start: LatLng, end: LatLng) => {
  const toRadians = (deg: number) => deg * (Math.PI / 180);
  const toDegrees = (rad: number) => rad * (180 / Math.PI);
  const lat1 = toRadians(start.latitude);
  const lon1 = toRadians(start.longitude);
  const lat2 = toRadians(end.latitude);
  const lon2 = toRadians(end.longitude);
  const deltaLon = lon2 - lon1;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  let bearing = toDegrees(Math.atan2(y, x));
  bearing = (bearing + 360) % 360;
  return bearing;
};

export default function TripScreen() {
  const { theme } = useAppTheme();
  const { session } = useAuth();
  const params = useLocalSearchParams();
  const mapRef = useRef<MapView>(null);
  const previousLocationRef = useRef<BusLocation | null>(null);
  const tripFinalizedRef = useRef(false);

  const busId = params.busId as string;
  const busPlateNumber = params.busPlateNumber as string;
  const pickupCoords: LatLng = {
    latitude: parseFloat(params.pickupLat as string),
    longitude: parseFloat(params.pickupLng as string),
  };
  const destCoords: LatLng = {
    latitude: parseFloat(params.destLat as string),
    longitude: parseFloat(params.destLng as string),
  };
  const routePath: [number, number][] = JSON.parse(params.routePath as string);
  const polylineCoords = routePath.map(([lng, lat]) => ({
    latitude: lat,
    longitude: lng,
  }));

  const [busLocation, setBusLocation] = useState<BusLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [eta, setEta] = useState<string | null>("Calculating...");

  // NEW: Trip status flow: 'waiting' until conductor scans, then 'picked_up'

  const [tripStatus, setTripStatus] = useState<"waiting" | "picked_up">(
    "waiting"
  );
  const [saving, setSaving] = useState(false);

  // transient overlay after successful scan
  const [showScanSuccess, setShowScanSuccess] = useState(false);
  const prevStatusRef = useRef<"waiting" | "picked_up">("waiting");

  // added: resolved location names
  const [pickupName, setPickupName] = useState<string | null>(null);
  const [destinationName, setDestinationName] = useState<string | null>(null);

  // added: reverse geocoding with caching
  const geocodeCache = useRef<Map<string, string>>(new Map());

  const reverseGeocode = async (coords: LatLng) => {
    if (!GOOGLE_MAPS_API_KEY) return null;

    // Create cache key
    const cacheKey = `${coords.latitude.toFixed(4)},${coords.longitude.toFixed(
      4
    )}`;

    // Check cache first
    if (geocodeCache.current.has(cacheKey)) {
      return geocodeCache.current.get(cacheKey) || null;
    }

    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${coords.latitude},${coords.longitude}&key=${GOOGLE_MAPS_API_KEY}`;
      const res = await fetch(url);
      const json = await res.json();
      const address = json.results?.[0]?.formatted_address || null;

      // Cache the result
      if (address) {
        geocodeCache.current.set(cacheKey, address);
      }

      return address;
    } catch {
      return null;
    }
  };

  // added: resolve names once
  useEffect(() => {
    (async () => {
      const [start, end] = await Promise.all([
        reverseGeocode(pickupCoords),
        reverseGeocode(destCoords),
      ]);
      setPickupName(start);
      setDestinationName(end);
    })();
  }, []);

  // show green check for 0.5s when status becomes picked_up
  useEffect(() => {
    if (prevStatusRef.current === "waiting" && tripStatus === "picked_up") {
      setShowScanSuccess(true);
      setTimeout(() => setShowScanSuccess(false), 500);
    }
    prevStatusRef.current = tripStatus;
  }, [tripStatus]);

  // QR payload the conductor can scan (adjust fields as backend expects)
  const qrPayload = JSON.stringify({
    type: "pickup_request",
    busId,
    commuterId: session?.user?.id, // added
    tripId: params.tripId || "will-be-created", // Add tripId to QR payload
    pickup: pickupCoords,
    dest: destCoords,
    ts: Date.now(),
  });

  // Debug: Log the QR payload to see what's being generated (remove in production)
  console.log("Trip screen params:", params);
  console.log("QR Payload tripId:", params.tripId);
  const fetchETA = async (origin: LatLng, destination: LatLng) => {
    if (!GOOGLE_MAPS_API_KEY) {
      console.error("Google Maps API key is not configured.");
      setEta("Unavailable");
      return;
    }
    try {
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.latitude},${origin.longitude}&destination=${destination.latitude},${destination.longitude}&key=${GOOGLE_MAPS_API_KEY}`;
      const response = await fetch(url);
      const json = await response.json();

      if (json.routes.length > 0) {
        const durationText = json.routes[0].legs[0].duration.text;
        setEta(`${durationText}`);
      } else {
        setEta("ETA not found");
      }
    } catch (error) {
      console.error("Error fetching ETA:", error);
      setEta("Error calculating ETA");
    }
  };

  const finalizeTrip = async (
    reason: "driver_ended" | "arrived" | "cancelled"
  ) => {
    if (tripFinalizedRef.current) return;
    tripFinalizedRef.current = true;
    if (!session?.user?.id) {
      Alert.alert("Not signed in", "Please sign in to save your trip.");
      return;
    }

    try {
      setSaving(true);
      // changed: do not use coordinates; prefer resolved names, fallback labels
      const startName = pickupName || "Pickup location";
      const endName = destinationName || "Destination";
      const { error } = await supabase.from("travel_history_commuter").insert({
        user_id: session.user.id,
        start_location_name: startName,
        end_location_name: endName,
        travel_date: new Date().toISOString(),
        route_name: `Bus ${busPlateNumber}`, // if you don’t want this, remove and also adjust history screen
        status: reason === "cancelled" ? "cancelled" : "completed",
      });
      if (error) throw error;
      router.replace("/(commuter)/history");
    } catch (e) {
      console.error("Failed to save trip:", e);
      Alert.alert("Error", "Could not save your trip. Please try again.");
      tripFinalizedRef.current = false;
    } finally {
      setSaving(false);
    }
  };

  const [QRCodeComponent, setQRCodeComponent] = useState<any>(null);
  const [qrLoadError, setQrLoadError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const mod = await import("react-native-qrcode-svg");
        if (mounted) setQRCodeComponent(() => mod.default);
      } catch (e: any) {
        if (mounted) setQrLoadError("QR unavailable");
        console.warn("Failed to load QR component:", e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const fetchInitialLocation = async () => {
      if (!busId || !session?.user?.id) return;
      setLoading(true);
      try {
        // Check if passenger is already boarded or cancelled
        const { data: existingBoarding, error: boardingError } = await supabase
          .from("trip_passengers")
          .select("id, status")
          .eq("passenger_id", session.user.id)
          .eq("bus_id", busId)
          .maybeSingle();

        if (existingBoarding && !boardingError) {
          if (existingBoarding.status === "boarded") {
            console.log("Passenger already boarded:", existingBoarding);
            setTripStatus("picked_up");
          } else if (existingBoarding.status === "cancelled") {
            console.log("Passenger trip was cancelled:", existingBoarding);
            Alert.alert(
              "Trip Cancelled",
              "Your trip has been cancelled. You will be redirected to the home screen."
            );
            await finalizeTrip("cancelled");
            return;
          }
        } else {
          console.log("Passenger not yet boarded, checking trip status...");
        }

        // Location
        const { data, error } = await supabase.rpc("get_initial_bus_location", {
          p_bus_id: busId,
        });
        if (error) throw error;

        if (data?.coordinates) {
          const location = {
            latitude: data.coordinates[1],
            longitude: data.coordinates[0],
          };
          setBusLocation(location);
          previousLocationRef.current = location;
          // While waiting, ETA to pickup
          await fetchETA(
            location,
            tripStatus === "picked_up" ? destCoords : pickupCoords
          );
        } else {
          Alert.alert("Error", "Could not find the bus's initial location.");
        }

        // NEW: Fetch initial trip status (assumes trips.status reflects pickup)
        const { data: tripRow } = await supabase
          .from("trips")
          .select("status")
          .eq("bus_id", busId)
          .maybeSingle();

        if (
          tripRow?.status &&
          `${tripRow.status}`.toLowerCase().includes("picked")
        ) {
          setTripStatus("picked_up");
        } else if (!existingBoarding) {
          setTripStatus("waiting");
        }
      } catch (err) {
        console.error("Failed to fetch initial bus location:", err);
        Alert.alert(
          "Error",
          "An error occurred while fetching the bus location."
        );
      } finally {
        setLoading(false);
      }
    };
    fetchInitialLocation();
  }, [busId, session?.user?.id]);

  useEffect(() => {
    if (!busId || !session?.user?.id) return;

    // Listen for trip_passengers table changes to detect boarding and cancellation
    const passengerChannel = supabase
      .channel(`passenger-boarding-${session.user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "trip_passengers",
          filter: `passenger_id=eq.${session.user.id}`,
        },
        async (payload) => {
          console.log("Passenger boarding detected:", payload);
          setTripStatus("picked_up");
          setShowScanSuccess(true);
          setTimeout(() => setShowScanSuccess(false), 2000);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "trip_passengers",
          filter: `passenger_id=eq.${session.user.id}`,
        },
        async (payload) => {
          console.log("Passenger record updated:", payload);
          if (payload.new.status === "cancelled") {
            console.log("Trip cancelled by driver");
            Alert.alert(
              "Trip Cancelled",
              "The driver has ended the trip. You will be redirected to the home screen."
            );
            await finalizeTrip("cancelled");
          }
        }
      )
      .subscribe((status) => {
        console.log("Passenger channel subscription status:", status);
      });

    // Fallback: Poll for boarding status every 2 seconds
    const checkBoardingStatus = async () => {
      try {
        console.log("Polling for boarding status...", {
          passengerId: session.user.id,
          busId,
          currentTripStatus: tripStatus,
        });

        const { data: boardingRecord, error } = await supabase
          .from("trip_passengers")
          .select("id, status, boarded_at")
          .eq("passenger_id", session.user.id)
          .eq("bus_id", busId)
          .maybeSingle();

        console.log("Polling result:", { boardingRecord, error });

        if (boardingRecord && !error) {
          if (boardingRecord.status === "boarded" && tripStatus === "waiting") {
            console.log("Boarding status found via polling:", boardingRecord);
            setTripStatus("picked_up");
            setShowScanSuccess(true);
            setTimeout(() => setShowScanSuccess(false), 2000);
          } else if (boardingRecord.status === "cancelled") {
            console.log("Trip cancelled detected via polling");
            Alert.alert(
              "Trip Cancelled",
              "The driver has ended the trip. You will be redirected to the home screen."
            );
            await finalizeTrip("cancelled");
          }
        }
      } catch (err) {
        console.error("Error checking boarding status:", err);
      }
    };

    // Check immediately and then every 2 seconds
    checkBoardingStatus();
    const pollingInterval = setInterval(checkBoardingStatus, 2000);

    // Listen for trip updates (location and status)
    const tripChannel = supabase
      .channel(`realtime-trip-${busId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "trips",
          filter: `bus_id=eq.${busId}`,
        },
        async (payload) => {
          const updatedTrip = payload.new as any;

          // Location update
          if (updatedTrip.current_location?.coordinates) {
            const newLocation: LatLng = {
              latitude: updatedTrip.current_location.coordinates[1],
              longitude: updatedTrip.current_location.coordinates[0],
            };
            setBusLocation(newLocation);

            await fetchETA(
              newLocation,
              tripStatus === "picked_up" ? destCoords : pickupCoords
            );

            const prevLocation = previousLocationRef.current;
            let heading = 0;
            if (prevLocation) {
              heading = calculateBearing(prevLocation, newLocation);
            }
            const camera: Partial<Camera> = {
              center: newLocation,
              pitch: 75,
              heading: heading,
              zoom: 18,
            };
            mapRef.current?.animateCamera(camera, { duration: 1500 });
            previousLocationRef.current = newLocation;

            // Auto-finish near destination
            if (tripStatus === "picked_up") {
              try {
                const d = haversineMeters(newLocation, destCoords);
                if (d <= 60) {
                  await finalizeTrip("arrived");
                }
              } catch {}
            }
          }

          // React to terminal status changes
          if (updatedTrip?.status) {
            const statusText = `${updatedTrip.status}`.toLowerCase();

            if (
              statusText.includes("completed") ||
              statusText.includes("ended") ||
              statusText.includes("arrived")
            ) {
              await finalizeTrip("driver_ended");
            }
            if (statusText.includes("cancel")) {
              await finalizeTrip("cancelled");
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(passengerChannel);
      supabase.removeChannel(tripChannel);
      clearInterval(pollingInterval);
    };
  }, [busId, session?.user?.id, tripStatus]);

  // Loading state remains the same
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text>Finding your bus...</Text>
      </View>
    );
  }

  // NEW: Add an error state if the bus location could not be fetched
  if (!busLocation) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color="#dc3545" />
        <Text style={styles.errorText}>Could not load trip details.</Text>
        <Text style={styles.errorSubText}>
          The bus location is currently unavailable.
        </Text>
        <TouchableOpacity
          style={styles.goBackButton}
          onPress={() => router.back()}
        >
          <Text style={styles.goBackButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // The MapView and UI will now only render if loading is false AND busLocation is available
  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider="google"
        customMapStyle={theme === "dark" ? [...mapDarkStyle] : []}
        initialCamera={{
          center: busLocation,
          pitch: 75,
          heading: 0,
          zoom: 18,
        }}
        showsUserLocation
        showsMyLocationButton={false}
      >
        <Polyline
          coordinates={polylineCoords}
          strokeColor="#007AFF"
          strokeWidth={5}
        />
        <Marker
          coordinate={destCoords}
          title="Your Destination"
          pinColor="red"
        />
        <Marker
          coordinate={pickupCoords}
          title="Your Pickup Spot"
          pinColor="blue"
        />
        {busLocation && (
          <Marker
            coordinate={busLocation}
            title={busPlateNumber}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.busMarker}>
              <Image
                source={require("@/assets/images/bus-icon.png")}
                style={styles.busIcon}
              />
            </View>
          </Marker>
        )}
      </MapView>

      {showScanSuccess && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.15)",
          }}
        >
          <Ionicons name="checkmark-circle" size={120} color="#28a745" />
        </View>
      )}

      {/* REPLACED: Back button -> Cancel/Exit or End Trip */}
      <TouchableOpacity
        onPress={() => {
          if (tripStatus === "picked_up") {
            Alert.alert("End Trip", "Are you sure you want to end this trip?", [
              { text: "No", style: "cancel" },
              {
                text: "Yes, end trip",
                style: "destructive",
                onPress: () => finalizeTrip("arrived"),
              },
            ]);
          } else {
            Alert.alert("Cancel Trip", "Are you sure you want to cancel?", [
              { text: "No", style: "cancel" },
              {
                text: "Yes, cancel",
                style: "destructive",
                onPress: () => finalizeTrip("cancelled"),
              },
            ]);
          }
        }}
        style={[
          styles.cancelButtonTop,
          tripStatus === "picked_up" && styles.endTripButtonTop,
        ]}
      >
        <Text style={styles.cancelButtonTopText}>
          {tripStatus === "picked_up" ? "End Trip" : "Cancel"}
        </Text>
      </TouchableOpacity>

      <View style={styles.bottomPanel}>
        <View style={styles.etaContainer}>
          <Text style={styles.etaLabel}>
            {tripStatus === "waiting"
              ? "Bus arriving in"
              : "Arriving at destination in"}
          </Text>
          <Text style={styles.etaText}>{eta}</Text>
        </View>

        {/* QR section only while waiting */}
        {tripStatus === "waiting" && (
          <>
            <View style={styles.divider} />
            <View style={styles.qrContainer}>
              {QRCodeComponent ? (
                <>
                  <QRCodeComponent value={qrPayload} size={160} />
                  <Text style={styles.qrHelpText}>
                    Show this QR to the conductor to be picked up
                  </Text>
                </>
              ) : (
                <Text style={styles.qrHelpText}>
                  {qrLoadError ? "QR unavailable" : "Loading QR..."}
                </Text>
              )}
            </View>
          </>
        )}

        <View style={styles.tripInfoContainer}>
          <FontAwesome5 name="bus-alt" size={20} color="#333" />
          <Text style={styles.dots}>········</Text>
          <Ionicons name="location-sharp" size={20} color="#007AFF" />
          <Text style={styles.dots}>········</Text>
          <FontAwesome5 name="flag-checkered" size={20} color="#28a745" />
        </View>
        <Text style={styles.destinationText}>
          Bus {busPlateNumber}{" "}
          {tripStatus === "waiting" ? "to your pickup" : "to your destination"}
        </Text>
      </View>
    </View>
  );
}

// MODIFIED: Added styles for the new error screen
const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 30,
  },
  // REMOVED: backButton
  cancelButtonTop: {
    position: "absolute",
    top: 60,
    left: 20,
    backgroundColor: "rgba(220,53,69,0.95)",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    elevation: 5,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  endTripButtonTop: {
    backgroundColor: "rgba(40,167,69,0.95)", // Green color for end trip
  },
  cancelButtonTopText: {
    color: "white",
    fontWeight: "600",
  },
  bottomPanel: {
    position: "absolute",
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: "white",
    borderRadius: 16,
    padding: 16,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  etaContainer: {
    alignItems: "center",
  },
  etaLabel: {
    fontSize: 14,
    color: "#6c757d",
  },
  etaText: {
    fontSize: 36,
    fontWeight: "bold",
    color: "#007AFF",
  },
  divider: {
    height: 1,
    backgroundColor: "#e9ecef",
    marginVertical: 12,
  },
  qrContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  qrHelpText: {
    marginTop: 8,
    fontSize: 12,
    color: "#6c757d",
  },
  tripInfoContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  dots: {
    fontSize: 20,
    color: "#ced4da",
    marginHorizontal: 8,
    lineHeight: 20,
  },
  destinationText: {
    textAlign: "center",
    marginTop: 12,
    fontSize: 14,
    color: "#495057",
  },
  busMarker: {
    padding: 5,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: "white",
    backgroundColor: "#ffc107",
    elevation: 5,
  },
  busIcon: { width: 20, height: 20 },
  errorText: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  errorSubText: {
    marginTop: 8,
    fontSize: 14,
    color: "#6c757d",
    textAlign: "center",
  },
  goBackButton: {
    marginTop: 24,
    backgroundColor: "#007AFF",
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 100,
  },
  goBackButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
});
