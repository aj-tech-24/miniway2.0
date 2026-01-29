# Relevant Source Code Fragments

## Passenger Interface

```tsx
interface Passenger {
  id: string;
  passenger_id: string;
  trip_id?: string;
  status: "waiting" | "boarded" | "completed" | "cancelled";
  boarded_at: string;
  passenger_count: number;
  accepted_at?: string;
  declined_at?: string;
  users?: {
    fullName: string;
    contact_number: string;
  };
}
```

## Trip Interface

```tsx
interface Trip {
  id: string;
  status: "waiting" | "ongoing" | "completed" | "cancelled";
  buses: {
    id: string;
    plate_number: string;
    capacity: number;
    passengers: number;
    routes: {
      id: string;
      name: string;
      start_address: string;
      end_address: string;
    };
  };
  trip_passengers: Passenger[];
}
```

## calculateDistance Helper

```tsx
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // Radius of the Earth in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};
```

## formatDistance Helper

```tsx
const formatDistance = (distance: number): string => {
  if (distance < 1) {
    return `${Math.round(distance * 1000)}m`;
  }
  return `${distance.toFixed(1)} km`;
};
```

## calculateEstimatedTime (ETA) Helper

```tsx
const calculateEstimatedTime = (distance: number): string => {
  const averageSpeed = 25; // km/h
  const timeInHours = distance / averageSpeed;
  const timeInMinutes = Math.round(timeInHours * 60);

  if (timeInMinutes < 60) {
    return `${timeInMinutes} min`;
  } else {
    const hours = Math.floor(timeInMinutes / 60);
    const remainingMinutes = timeInMinutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
};
```

## getRouteEfficiencyColor Helper

```tsx
const getRouteEfficiencyColor = (distance: number): string => {
  if (distance <= 2) return "#34C759"; // Green - Very efficient
  if (distance <= 5) return "#007AFF"; // Blue - Good
  if (distance <= 10) return "#FF9500"; // Orange - Moderate
  return "#FF3B30"; // Red - Long distance
};
```

## GPS / Real‑time Bus Location Tracking

```tsx
useEffect(() => {
  let locationSubscription: Location.LocationSubscription | null = null;

  async function startLocationUpdates() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return;

    locationSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 5000, // every 5 seconds
        distanceInterval: 10, // every 10 meters
      },
      (location) => {
        const coords = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        };
        setBusLocation(coords);
        setMapRegion((prev) => ({
          ...prev,
          ...coords,
        }));
      }
    );
  }

  startLocationUpdates();

  return () => {
    locationSubscription?.remove();
  };
}, []);
```

## Row‑Level Database Updates – Accept Pickup

```tsx
const handleAcceptPickup = async (pickupId: string) => {
  try {
    const pickupRequest = _pendingPickups.find((p) => p.id === pickupId);
    if (!pickupRequest) {
      showAlert("Error", "Pickup request not found.", "error");
      return;
    }
    if (!currentTrip?.id || !currentTrip?.buses?.id) {
      showAlert("Error", "No active trip or bus found.", "error");
      return;
    }
    if (
      !pickupRequest.pickup_lat ||
      !pickupRequest.pickup_lng ||
      !pickupRequest.dest_lat ||
      !pickupRequest.dest_lng
    ) {
      showAlert("Error", "Pickup request is missing location data.", "error");
      return;
    }
    const { error: updateError } = await supabase
      .from("pickup_requests")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
      })
      .eq("id", pickupId);
    if (updateError) throw updateError;

    const { error: updateTripPassengerError } = await supabase
      .from("trip_passengers")
      .update({ accepted_at: new Date().toISOString() })
      .eq("trip_id", currentTrip.id)
      .eq("bus_id", currentTrip.buses.id)
      .eq("passenger_id", pickupRequest.commuter_id)
      .eq("status", "waiting");

    if (updateTripPassengerError) {
      const { error: insertError } = await supabase
        .from("trip_passengers")
        .insert({
          trip_id: currentTrip.id,
          bus_id: currentTrip.buses.id,
          passenger_id: pickupRequest.commuter_id,
          pickup_lat: pickupRequest.pickup_lat,
          pickup_lng: pickupRequest.pickup_lng,
          dest_lat: pickupRequest.dest_lat,
          dest_lng: pickupRequest.dest_lng,
          status: "waiting",
          passenger_count: pickupRequest.passenger_count || 1,
          accepted_at: new Date().toISOString(),
          boarded_at: null,
        });
      if (insertError) throw insertError;
    }

    setPendingPickups((prev) => prev.filter((p) => p.id !== pickupId));
    setSelectedRequest(null);
    showAlert("Pickup Accepted", "Passenger added to waiting list.", "success");
    fetchCurrentTrip();
  } catch (error) {
    console.error("Error accepting pickup request:", error);
    showAlert("Error", "Failed to accept the pickup request.", "error");
  }
};
```

## Row‑Level Database Updates – Decline Pickup

```tsx
const handleDeclinePickup = async (pickupId: string) => {
  try {
    const pickupRequest = _pendingPickups.find(
      (p: PendingPickupRequest) => p.id === pickupId
    );
    const { error } = await supabase
      .from("pickup_requests")
      .update({
        status: "declined",
        declined_at: new Date().toISOString(),
      })
      .eq("id", pickupId);
    if (error) throw error;

    if (pickupRequest && currentTrip) {
      await supabase
        .from("trip_passengers")
        .update({
          status: "cancelled",
          declined_at: new Date().toISOString(),
        })
        .eq("trip_id", currentTrip.id)
        .eq("bus_id", currentTrip.buses.id)
        .eq("passenger_id", pickupRequest.commuter_id)
        .eq("status", "waiting");
    }

    setPendingPickups((prev) => prev.filter((p) => p.id !== pickupId));
    setSelectedRequest(null);
    showAlert("Pickup Declined", "You have declined the pickup request.", "warning");
    fetchCurrentTrip();
  } catch (error) {
    console.error("Error declining pickup request:", error);
    showAlert("Error", "Failed to decline the pickup request.", "error");
  }
};
```

## Light‑Weight Passenger Refresh (Row‑Level)

```tsx
const refreshPassengersList = useCallback(async () => {
  if (!currentTrip?.id) return;
  setRefreshingPassengers(true);
  try {
    const { data: passengersData, error: passengersError } = await supabase
      .from("trip_passengers")
      .select(`
        id,
        passenger_id,
        trip_id,
        status,
        boarded_at,
        passenger_count
      `)
      .eq("trip_id", currentTrip.id)
      .neq("status", "cancelled");
    if (passengersError) throw passengersError;

    const passengerIds = (passengersData || [])
      .filter((p: any) => p.passenger_id)
      .map((p: any) => p.passenger_id);

    let usersMap: Record<string, { fullName: string; contact_number: string }> = {};
    if (passengerIds.length > 0) {
      const { data: usersData } = await supabase
        .from("users")
        .select("id, fullName, contact_number")
        .in("id", passengerIds);
      if (usersData) {
        usersMap = usersData.reduce((acc, user) => {
          acc[user.id] = { fullName: user.fullName, contact_number: user.contact_number };
          return acc;
        }, {} as typeof usersMap);
      }
    }

    const transformedPassengers: Passenger[] = [];
    const guestRecords: any[] = [];
    (passengersData || []).forEach((p: any) => {
      if (!p.passenger_id) {
        guestRecords.push(p);
      } else {
        transformedPassengers.push({
          id: p.id,
          passenger_id: p.passenger_id,
          trip_id: p.trip_id,
          status: p.status,
          boarded_at: p.boarded_at,
          passenger_count: p.passenger_count,
          users: usersMap[p.passenger_id],
        });
      }
    });

    if (guestRecords.length > 0) {
      const totalGuestCount = guestRecords.reduce(
        (sum, g) => sum + (g.passenger_count || 0),
        0
      );
      const primaryGuest = guestRecords[0];
      transformedPassengers.push({
        id: primaryGuest.id,
        passenger_id: GUEST_PASSENGER_ID,
        trip_id: primaryGuest.trip_id,
        status: "boarded",
        boarded_at: primaryGuest.boarded_at,
        passenger_count: totalGuestCount,
        users: undefined,
      });
    }

    setPassengers(transformedPassengers);
    const { data: busData, error: busError } = await supabase
      .from("buses")
      .select("passengers")
      .eq("id", currentTrip.buses.id)
      .single();
    if (busError) throw busError;
    setPassengerCount(busData.passengers || 0);
  } catch (error) {
    console.error("Error refreshing passengers list:", error);
  } finally {
    setRefreshingPassengers(false);
  }
}, [currentTrip, GUEST_PASSENGER_ID]);
```

## Realtime Data Sync

The conductor screen relies on several Supabase realtime subscriptions to keep the UI in sync with backend changes.

### 1. New boarded passengers (INSERT on `trip_passengers`)

```tsx
useEffect(() => {
  if (!currentTrip?.id) return;

  const subscription = supabase
    .channel(`trip_passengers_${currentTrip.id}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "trip_passengers",
        filter: `trip_id=eq.${currentTrip.id}`,
      },
      async (payload) => {
        // Fetch passenger details for the new row
        const { data: passengerData } = await supabase
          .from("trip_passengers")
          .select("passenger_id, passenger_count, users(fullName)")
          .eq("id", payload.new.id)
          .single();
        if (passengerData) {
          const name = passengerData.users?.[0]?.fullName || "Guest Passenger";
          const count = passengerData.passenger_count || 1;
          // Haptic feedback & UI notification
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setNotificationData({ name, count });
          setShowNotification(true);
          Animated.sequence([
            Animated.timing(notificationAnimation, { toValue: 1, duration: 300, useNativeDriver: true }),
            Animated.delay(3000),
            Animated.timing(notificationAnimation, { toValue: 0, duration: 300, useNativeDriver: true }),
          ]).start(() => setShowNotification(false));
        }
        // Refresh the whole trip to reflect the new passenger
        fetchCurrentTrip();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "trip_passengers",
        filter: `trip_id=eq.${currentTrip.id}`,
      },
      async (payload) => {
        // Only react when a passenger status changes to "boarded"
        if (payload.new.status === "boarded" && payload.old?.status !== "boarded") {
          const { data: passengerData } = await supabase
            .from("trip_passengers")
            .select("passenger_id, passenger_count, users(fullName)")
            .eq("id", payload.new.id)
            .single();
          if (passengerData) {
            const name = passengerData.users?.[0]?.fullName || "Guest Passenger";
            const count = passengerData.passenger_count || 1;
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setNotificationData({ name, count });
            setShowNotification(true);
            Animated.sequence([
              Animated.timing(notificationAnimation, { toValue: 1, duration: 300, useNativeDriver: true }),
              Animated.delay(3000),
              Animated.timing(notificationAnimation, { toValue: 0, duration: 300, useNativeDriver: true }),
            ]).start(() => setShowNotification(false));
          }
        }
        fetchCurrentTrip();
      }
    )
    .subscribe();

  return () => subscription.unsubscribe();
}, [currentTrip?.id, fetchCurrentTrip, notificationAnimation]);
```

### 2. Pickup request changes (INSERT / UPDATE on `pickup_requests`)

```tsx
useEffect(() => {
  const busId = currentTrip?.buses?.id || assignedBus?.id;
  if (!busId) return;

  const pickupSubscription = supabase
    .channel(`pickup_requests_${busId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "pickup_requests", filter: `bus_id=eq.${busId}` },
      (payload) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        const newPickup = {
          id: payload.new.id,
          commuter_id: payload.new.commuter_id,
          commuter_name: payload.new.commuter_name,
          passenger_count: payload.new.passenger_count,
          status: payload.new.status,
          created_at: payload.new.created_at,
          pickup_lat: payload.new.pickup_lat,
          pickup_lng: payload.new.pickup_lng,
          dest_lat: payload.new.dest_lat,
          dest_lng: payload.new.dest_lng,
          notes: payload.new.notes,
        };
        setPendingPickups((prev) => [...prev, newPickup]);
      }
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "pickup_requests", filter: `bus_id=eq.${busId}` },
      (payload) => {
        if (payload.new.status === "accepted" || payload.new.status === "declined") {
          setPendingPickups((prev) => prev.filter((p) => p.id !== payload.new.id));
        } else {
          setPendingPickups((prev) =>
            prev.map((p) => (p.id === payload.new.id ? { ...p, ...payload.new } : p))
          );
        }
      }
    )
    .subscribe();

  return () => pickupSubscription.unsubscribe();
}, [currentTrip?.buses?.id, assignedBus?.id]);
```

### 3. Trip lifecycle (INSERT / UPDATE on `trips` for the assigned bus)

```tsx
useEffect(() => {
  const busId = assignedBus?.id;
  if (!busId) return;

  const tripSubscription = supabase
    .channel(`trips_bus_${busId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "trips", filter: `bus_id=eq.${busId}` },
      (payload) => {
        if (currentTripRef.current) return; // ignore if already have a trip
        InteractionManager.runAfterInteractions(() => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setNotificationData({ name: "Driver Started Trip", count: 0 });
          setShowNotification(true);
          Animated.sequence([
            Animated.timing(notificationAnimation, { toValue: 1, duration: 300, useNativeDriver: true }),
            Animated.delay(3000),
            Animated.timing(notificationAnimation, { toValue: 0, duration: 300, useNativeDriver: true }),
          ]).start(() => setShowNotification(false));
          fetchCurrentTrip();
        });
      }
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "trips", filter: `bus_id=eq.${busId}` },
      (payload) => {
        const newStatus = payload.new.status;
        const oldStatus = payload.old?.status;
        if (newStatus === oldStatus) return;
        const isNewTripStarting =
          !currentTripRef.current &&
          ["ongoing", "waiting", "Ongoing", "Waiting"].includes(newStatus);
        const isCurrentTripEnding =
          currentTripRef.current?.id === payload.new.id &&
          ["completed", "cancelled", "Completed", "Cancelled"].includes(newStatus);
        if (!isNewTripStarting && !isCurrentTripEnding) return;
        InteractionManager.runAfterInteractions(() => {
          if (isNewTripStarting) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setNotificationData({ name: "Driver Started Trip", count: 0 });
            setShowNotification(true);
            Animated.sequence([
              Animated.timing(notificationAnimation, { toValue: 1, duration: 300, useNativeDriver: true }),
              Animated.delay(2000),
              Animated.timing(notificationAnimation, { toValue: 0, duration: 300, useNativeDriver: true }),
            ]).start(() => setShowNotification(false));
          }
          fetchCurrentTrip();
        });
      }
    )
    .subscribe();

  return () => tripSubscription.unsubscribe();
}, [assignedBus?.id]);
```

These realtime listeners ensure the conductor UI instantly reflects:
- New passengers boarding the bus
- Updates to passenger status (e.g., boarded, cancelled)
- Incoming pickup requests and their acceptance/decline
- Trip start, status changes, and completion

## ConductorScreen Component (start)

```tsx
export function ConductorScreen() {
  const { theme } = useAppTheme();
  const [loading, setLoading] = useState(true);
  const [refreshingPassengers, setRefreshingPassengers] = useState(false);
  const [currentTrip, setCurrentTrip] = useState<Trip | null>(null);
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [passengerCount, setPassengerCount] = useState(0);
  // ... (rest of the component implementation)
}
```

*These snippets capture the core GPS tracking, ETA calculation, and row‑level database operations that power the conductor screen.*
