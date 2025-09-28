import { mapDarkStyle } from "@/constants/mapDarkStyle";
import { useAuth } from "@/contexts/AuthContext";
import { useAppTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import QRCode from "react-native-qrcode-svg";

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
  const polylineCoords = useMemo(
    () =>
      routePath.map(([lng, lat]) => ({
        latitude: lat,
        longitude: lng,
      })),
    [routePath]
  );

  const [busLocation, setBusLocation] = useState<BusLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [eta, setEta] = useState<string | null>("Calculating...");

  // Trip status flow: 'waiting' until conductor scans QR, then 'picked_up'
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

  // Clear caches periodically to prevent memory buildup
  useEffect(() => {
    const cacheCleanupInterval = setInterval(() => {
      if (geocodeCache.current.size > 50) {
        geocodeCache.current.clear();
      }
      if (shownPickupAlerts.current.size > 20) {
        shownPickupAlerts.current.clear();
      }
    }, 60000); // Clear every minute if caches are too large

    return () => clearInterval(cacheCleanupInterval);
  }, []);

  // Track which pickup request alerts have been shown to prevent duplicates
  const shownPickupAlerts = useRef<Set<string>>(new Set());

  // Track if pickup request has been resolved (accepted/declined) to stop listening
  const pickupRequestResolved = useRef<boolean>(false);

  // Throttle ETA fetching to reduce memory usage
  const lastEtaFetch = useRef<number>(0);
  const ETA_FETCH_THROTTLE = 15000; // 15 seconds - increased to reduce API calls

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
  const qrPayload = useMemo(
    () =>
      JSON.stringify({
        type: "pickup_request",
        busId,
        commuterId: session?.user?.id, // added
        tripId: params.tripId || "will-be-created", // Add tripId to QR payload
        pickup: pickupCoords,
        dest: destCoords,
        ts: Date.now(),
      }),
    [busId, session?.user?.id, params.tripId, pickupCoords, destCoords]
  );

  const fetchETA = async (origin: LatLng, destination: LatLng) => {
    if (!GOOGLE_MAPS_API_KEY) {
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
      setEta("Error calculating ETA");
    }
  };

  const finalizeTrip = useCallback(
    async (reason: "driver_ended" | "arrived" | "cancelled") => {
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
        const { error } = await supabase
          .from("travel_history_commuter")
          .insert({
            user_id: session.user.id,
            start_location_name: startName,
            end_location_name: endName,
            travel_date: new Date().toISOString(),
            route_name: `Bus ${busPlateNumber}`, // if you don't want this, remove and also adjust history screen
            status: reason === "cancelled" ? "cancelled" : "completed",
          });
        if (error) throw error;
        router.replace("/(commuter)/history");
      } catch (e) {
        Alert.alert("Error", "Could not save your trip. Please try again.");
        tripFinalizedRef.current = false;
      } finally {
        setSaving(false);
      }
    },
    [session?.user?.id, pickupName, destinationName, busPlateNumber]
  );

  // QR code is now imported directly, no need for dynamic loading

  useEffect(() => {
    const fetchInitialLocation = async () => {
      if (!busId || !session?.user?.id) return;
      setLoading(true);
      try {
        // Check if passenger is already boarded or cancelled
        const { data: existingBoarding, error: boardingError } = await supabase
          .from("trip_passengers")
          .select("id, status, boarded_at")
          .eq("passenger_id", session.user.id)
          .eq("bus_id", busId)
          .maybeSingle();

        if (existingBoarding && !boardingError) {
          if (existingBoarding.status === "boarded") {
            setTripStatus("picked_up");
          } else if (existingBoarding.status === "cancelled") {
            Alert.alert(
              "Trip Cancelled",
              "Your trip has been cancelled. You will be redirected to the home screen."
            );
            await finalizeTrip("cancelled");
            return;
          } else if (existingBoarding.status === "waiting") {
            setTripStatus("waiting");
          }
        } else {
          // Create trip_passengers record if it doesn't exist
          const { data: newTripPassenger, error: createError } = await supabase
            .from("trip_passengers")
            .insert({
              bus_id: busId,
              trip_id: params.tripId as string,
              passenger_id: session.user.id,
              pickup_lat: pickupCoords.latitude,
              pickup_lng: pickupCoords.longitude,
              dest_lat: destCoords.latitude,
              dest_lng: destCoords.longitude,
              status: "waiting",
            })
            .select("id, status")
            .single();

          if (createError) {
            // If creation fails, still set status to waiting as the record might exist from route-details
            setTripStatus("waiting");
          } else {
            setTripStatus("waiting");
          }
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

        // Check if pickup request has already been resolved
        const { data: existingPickupRequest } = await supabase
          .from("pickup_requests")
          .select("id, status")
          .eq("commuter_id", session.user.id)
          .eq("bus_id", busId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (
          existingPickupRequest &&
          (existingPickupRequest.status === "accepted" ||
            existingPickupRequest.status === "declined")
        ) {
          pickupRequestResolved.current = true;
        }
      } catch (err) {
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

    // Only subscribe to real-time updates if passenger is still waiting for boarding
    if (tripStatus !== "waiting") {
      return;
    }

    // Listen for trip_passengers table changes to detect boarding and cancellation
    const passengerChannel = supabase
      .channel(`passenger-boarding-${session.user.id}-${busId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "trip_passengers",
          filter: `passenger_id=eq.${session.user.id} AND bus_id=eq.${busId}`,
        },
        async (payload) => {
          const newStatus = payload.new.status;

          if (newStatus === "boarded") {
            setTripStatus("picked_up");
            setShowScanSuccess(true);
            setTimeout(() => setShowScanSuccess(false), 2000);

            // Unsubscribe from passenger channel since we're now boarded
            supabase.removeChannel(passengerChannel);
          } else if (newStatus === "cancelled") {
            Alert.alert(
              "Trip Cancelled",
              "The driver has cancelled your trip. You will be redirected to the home screen."
            );
            await finalizeTrip("cancelled");
          } else {
          }
        }
      )
      .subscribe((status) => {});

    // Return cleanup function
    return () => {
      supabase.removeChannel(passengerChannel);
    };
  }, [busId, session?.user?.id, tripStatus]);

  useEffect(() => {
    if (!busId || !session?.user?.id) return;

    // Only listen for pickup request changes if we're still waiting and request not resolved
    if (tripStatus === "waiting" && !pickupRequestResolved.current) {
      const pickupRequestChannel = supabase
        .channel(`pickup-request-${session.user.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "pickup_requests",
            filter: `commuter_id=eq.${session.user.id}`,
          },
          async (payload) => {
            const newStatus = payload.new.status;
            const requestId = payload.new.id;
            const alertKey = `${requestId}-${newStatus}`;

            // Check if pickup request has already been resolved
            if (pickupRequestResolved.current) {
              return;
            }

            // Check if we've already shown this alert
            if (shownPickupAlerts.current.has(alertKey)) {
              return;
            }

            if (newStatus === "declined") {
              pickupRequestResolved.current = true; // Mark as resolved
              shownPickupAlerts.current.add(alertKey);
              Alert.alert(
                "Pickup Request Declined",
                "The driver has declined your pickup request. You will be redirected to find another bus.",
                [
                  {
                    text: "OK",
                    onPress: () => {
                      router.replace("/(commuter)");
                    },
                  },
                ]
              );
            } else if (newStatus === "accepted") {
              pickupRequestResolved.current = true; // Mark as resolved
              shownPickupAlerts.current.add(alertKey);
              Alert.alert(
                "Pickup Request Accepted! ✅",
                "The driver has accepted your pickup request. Please wait for the bus to arrive at your pickup location.",
                [{ text: "OK" }]
              );
            }
          }
        )
        .subscribe((status) => {});

      // Return cleanup function for pickup request channel
      return () => {
        supabase.removeChannel(pickupRequestChannel);
      };
    } else {
    }

    // Fallback: Poll for boarding status every 5 seconds
    const checkBoardingStatus = async () => {
      try {
        // Skip polling if trip is already completed
        if (tripFinalizedRef.current) {
          return;
        }

        const { data: boardingRecord, error } = await supabase
          .from("trip_passengers")
          .select("id, status, boarded_at")
          .eq("passenger_id", session.user.id)
          .eq("bus_id", busId)
          .maybeSingle();

        if (boardingRecord && !error) {
          if (boardingRecord.status === "boarded" && tripStatus === "waiting") {
            setTripStatus("picked_up");
            setShowScanSuccess(true);
            setTimeout(() => setShowScanSuccess(false), 2000);
          } else if (boardingRecord.status === "cancelled") {
            Alert.alert(
              "Trip Cancelled",
              "The driver has cancelled your trip. You will be redirected to the home screen."
            );
            await finalizeTrip("cancelled");
          } else if (boardingRecord.status === "completed") {
            await finalizeTrip("arrived");
          }
        }
      } catch (err) {}
    };

    // Fallback: Poll for pickup request status every 10 seconds
    const checkPickupRequestStatus = async () => {
      try {
        // Skip polling if pickup request has been resolved or trip is completed
        if (pickupRequestResolved.current || tripFinalizedRef.current) {
          return;
        }

        const { data: pickupRequest, error } = await supabase
          .from("pickup_requests")
          .select("id, status")
          .eq("commuter_id", session.user.id)
          .eq("bus_id", busId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (pickupRequest && !error) {
          const alertKey = `${pickupRequest.id}-${pickupRequest.status}`;

          // Check if we've already shown this alert
          if (shownPickupAlerts.current.has(alertKey)) {
            return;
          }

          if (pickupRequest.status === "declined") {
            pickupRequestResolved.current = true; // Mark as resolved
            shownPickupAlerts.current.add(alertKey);
            Alert.alert(
              "Pickup Request Declined",
              "The driver has declined your pickup request. You will be redirected to find another bus.",
              [
                {
                  text: "OK",
                  onPress: () => {
                    router.replace("/(commuter)");
                  },
                },
              ]
            );
          } else if (pickupRequest.status === "accepted") {
            pickupRequestResolved.current = true; // Mark as resolved
            shownPickupAlerts.current.add(alertKey);
            Alert.alert(
              "Pickup Request Accepted! ✅",
              "The driver has accepted your pickup request. Please wait for the bus to arrive at your pickup location.",
              [{ text: "OK" }]
            );
          }
        }
      } catch (err) {}
    };

    // Check immediately and then every 8 seconds for boarding, every 15 seconds for pickup requests
    checkBoardingStatus();
    checkPickupRequestStatus();
    const boardingPollingInterval = setInterval(checkBoardingStatus, 8000); // Reduced frequency
    const pickupPollingInterval = setInterval(checkPickupRequestStatus, 15000); // Reduced frequency

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

            // Throttle ETA fetching to reduce memory usage
            const now = Date.now();
            if (now - lastEtaFetch.current > ETA_FETCH_THROTTLE) {
              lastEtaFetch.current = now;
              await fetchETA(
                newLocation,
                tripStatus === "picked_up" ? destCoords : pickupCoords
              );
            }

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
            // Throttle camera animations to reduce memory usage
            mapRef.current?.animateCamera(camera, { duration: 1000 });
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
      .subscribe((status) => {});

    return () => {
      supabase.removeChannel(tripChannel);
      clearInterval(boardingPollingInterval);
      clearInterval(pickupPollingInterval);
    };
  }, [busId, session?.user?.id, tripStatus]);

  // Loading state remains the same
  if (loading) {
    return (
      <View style={styles.centered}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingTitle}>Loading Trip Details</Text>
          <Text style={styles.loadingSubtext}>
            Getting your bus location and trip information...
          </Text>
        </View>
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
          <View style={styles.statusIndicator}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    tripStatus === "waiting" ? "#FF9500" : "#28a745",
                },
              ]}
            />
            <Text style={styles.statusText}>
              {tripStatus === "waiting" ? "Waiting for Boarding" : "On Board"}
            </Text>
          </View>
          <Text style={styles.etaLabel}>
            {tripStatus === "waiting"
              ? "Bus arriving in"
              : "Arriving at destination in"}
          </Text>
          <Text style={styles.etaText}>{eta}</Text>
        </View>

        {/* QR section - show only while waiting for boarding */}
        {tripStatus === "waiting" && (
          <>
            <View style={styles.divider} />
            <View style={styles.qrContainer}>
              <Text style={styles.qrTitle}>Boarding QR Code</Text>
              <QRCode value={qrPayload} size={160} />
              <Text style={styles.qrHelpText}>
                Show this QR code to the conductor for boarding
              </Text>
              <Text style={styles.qrSubText}>
                The QR code will disappear once you're boarded
              </Text>
              {/* Fallback: Show payload as text if QR doesn't work
              <View style={styles.fallbackContainer}>
                <Text style={styles.fallbackText}>
                  If QR doesn't work, show this to conductor:
                </Text>
                <Text style={styles.fallbackPayload}>{qrPayload}</Text>
              </View> */}
            </View>
          </>
        )}

        {/* Show boarding confirmation when QR is scanned */}
        {tripStatus === "picked_up" && (
          <>
            <View style={styles.divider} />
            <View style={styles.boardingContainer}>
              <Ionicons name="checkmark-circle" size={48} color="#28a745" />
              <Text style={styles.boardingTitle}>Successfully Boarded! ✅</Text>
              <Text style={styles.boardingText}>
                You have been boarded on the bus. Enjoy your ride!
              </Text>
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
  loadingContainer: {
    alignItems: "center",
    backgroundColor: "white",
    borderRadius: 20,
    padding: 32,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  loadingTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
    marginTop: 16,
    marginBottom: 8,
    textAlign: "center",
  },
  loadingSubtext: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    lineHeight: 22,
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
    borderRadius: 24,
    padding: 24,
    elevation: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.05)",
  },
  etaContainer: {
    alignItems: "center",
    marginBottom: 8,
  },
  statusIndicator: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    backgroundColor: "#f8f9fa",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e9ecef",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  etaLabel: {
    fontSize: 16,
    color: "#666",
    marginBottom: 8,
    fontWeight: "500",
  },
  etaText: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#007AFF",
    textAlign: "center",
  },
  divider: {
    height: 1,
    backgroundColor: "#e9ecef",
    marginVertical: 16,
    borderRadius: 1,
  },
  qrContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    backgroundColor: "#f8f9fa",
    borderRadius: 20,
    padding: 20,
    borderWidth: 2,
    borderColor: "#e9ecef",
  },
  qrHelpText: {
    marginTop: 16,
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    fontWeight: "500",
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
  boardingContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    backgroundColor: "#f0f8f0",
    borderRadius: 20,
    padding: 20,
    borderWidth: 2,
    borderColor: "#28a745",
  },
  boardingTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginTop: 12,
    marginBottom: 8,
    color: "#28a745",
    textAlign: "center",
  },
  boardingText: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    lineHeight: 22,
  },
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
  fallbackContainer: {
    marginTop: 16,
    padding: 16,
    backgroundColor: "#f8f9fa",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#dee2e6",
  },
  fallbackText: {
    fontSize: 14,
    color: "#6c757d",
    marginBottom: 8,
    textAlign: "center",
    fontWeight: "500",
  },
  fallbackPayload: {
    fontSize: 12,
    color: "#495057",
    fontFamily: "monospace",
    textAlign: "center",
    lineHeight: 16,
    backgroundColor: "#fff",
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e9ecef",
  },
  qrTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#007AFF",
    textAlign: "center",
    marginBottom: 16,
  },
  qrSubText: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 12,
    fontStyle: "italic",
  },
});
