import { supabase } from "@/lib/supabase";
import { RealtimeChannel } from "@supabase/supabase-js";
import React, {
    createContext,
    ReactNode,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useAuth } from "./AuthContext";

// =====================================================
// TYPE DEFINITIONS
// =====================================================

export interface LatLng {
    latitude: number;
    longitude: number;
}

type BroadcastBusLocationPayload = {
    routeId: string;
    busId: string;
    location: LatLng;
    heading?: number;
    timestamp?: number; // epoch ms
};

export interface BusOnRoute {
    id: string;
    plateNumber: string;
    location: LatLng | null;
    heading: number;
    status: "active" | "inactive" | "waiting";
    capacity: number | null;
    passengers: number | null;
    driverId: string | null;
    driverName: string | null;
    lastUpdated: Date;
}

export interface CommuterOnRoute {
    id: string;
    fullName: string | null;
    location: LatLng | null;
    pickupLocation: LatLng | null;
    destinationLocation: LatLng | null;
    status: "waiting" | "boarding" | "boarded" | "completed" | "cancelled";
    lastUpdated: Date;
}

export interface PickupRequest {
    id: string;
    commuterId: string;
    commuterName: string | null;
    busId: string;
    pickupLocation: LatLng;
    destinationLocation: LatLng;
    passengerCount: number;
    status: "pending" | "accepted" | "declined" | "cancelled" | "completed";
    createdAt: Date;
}

export interface RouteInfo {
    id: string;
    name: string;
    startAddress: string | null;
    endAddress: string | null;
    path: LatLng[];
}

export interface RouteContextState {
    // Current route information
    currentRouteId: string | null;
    currentRoute: RouteInfo | null;

    // Buses on the current route
    busesOnRoute: Map<string, BusOnRoute>;

    // Commuters on the current route (for drivers/conductors)
    commutersOnRoute: Map<string, CommuterOnRoute>;

    // Pickup requests for the current route
    pickupRequests: Map<string, PickupRequest>;

    // Loading/connection states
    isConnected: boolean;
    isLoading: boolean;
    error: string | null;

    // Actions
    setCurrentRoute: (routeId: string | null) => void;
    updateBusLocation: (busId: string, location: LatLng, heading?: number) => void;
    subscribeToBus: (busId: string) => void;
    unsubscribeFromBus: (busId: string) => void;
    unsubscribeFromAllBusesExcept: (keepBusId: string) => void;
    subscribeToRoute: (routeId: string) => void;
    unsubscribeFromRoute: () => void;
    refreshBusesOnRoute: () => Promise<void>;
    refreshPickupRequests: (busId: string) => Promise<void>;

    // Realtime Broadcast (optional: ephemeral updates)
    publishBusLocationBroadcast: (payload: BroadcastBusLocationPayload) => Promise<void>;

    // Getters
    getBus: (busId: string) => BusOnRoute | undefined;
    getCommuter: (commuterId: string) => CommuterOnRoute | undefined;
    getPickupRequest: (requestId: string) => PickupRequest | undefined;
    getActiveBusesCount: () => number;
    getActiveCommutersCount: () => number;
    getPendingPickupRequestsCount: () => number;
}

// =====================================================
// CONTEXT CREATION
// =====================================================

const RouteContext = createContext<RouteContextState | undefined>(undefined);

function routeBroadcastChannelName(routeId: string) {
    return `route:${routeId}`;
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/**
 * Parse GeoJSON point to LatLng
 */
const parseGeoJSONPoint = (geoJson: any): LatLng | null => {
    if (!geoJson) return null;

    try {
        const parsed = typeof geoJson === "string" ? JSON.parse(geoJson) : geoJson;
        if (parsed?.coordinates && Array.isArray(parsed.coordinates)) {
            return {
                latitude: parsed.coordinates[1],
                longitude: parsed.coordinates[0],
            };
        }
    } catch (error) {
        // Try WKT for PostGIS points
        if (typeof geoJson === 'string') {
            const match = geoJson.match(/POINT\s*\((\S+)\s+(\S+)\)/i);
            if (match && match.length >= 3) {
                return {
                    longitude: parseFloat(match[1]),
                    latitude: parseFloat(match[2]),
                };
            }
        }
    }

    return null;
};

/**
 * Parse GeoJSON LineString to LatLng array
 */
const parseGeoJSONLineString = (geoJson: any): LatLng[] => {
    if (!geoJson) return [];

    try {
        const parsed = typeof geoJson === "string" ? JSON.parse(geoJson) : geoJson;
        if (parsed?.coordinates && Array.isArray(parsed.coordinates)) {
            return parsed.coordinates.map(([lng, lat]: [number, number]) => ({
                latitude: lat,
                longitude: lng,
            }));
        }
    } catch (error) {
        console.error("Failed to parse GeoJSON LineString:", error);
    }

    return [];
};

// =====================================================
// PROVIDER COMPONENT
// =====================================================

export function RouteProvider({ children }: { children: ReactNode }) {
    const { session } = useAuth();

    // State
    const [currentRouteId, setCurrentRouteId] = useState<string | null>(null);
    const [currentRoute, setCurrentRoute] = useState<RouteInfo | null>(null);
    const [busesOnRoute, setBusesOnRoute] = useState<Map<string, BusOnRoute>>(new Map());
    const [commutersOnRoute, setCommutersOnRoute] = useState<Map<string, CommuterOnRoute>>(new Map());
    const [pickupRequests, setPickupRequests] = useState<Map<string, PickupRequest>>(new Map());
    const [isConnected, setIsConnected] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Refs for channels
    const routeChannelRef = useRef<RealtimeChannel | null>(null);
    const busChannelsRef = useRef<Map<string, RealtimeChannel>>(new Map());
    const tripsChannelRef = useRef<RealtimeChannel | null>(null);
    const pickupChannelRef = useRef<RealtimeChannel | null>(null);
    const routeBroadcastChannelRef = useRef<RealtimeChannel | null>(null);
    const busesOnRouteRef = useRef<Map<string, BusOnRoute>>(new Map()); // Ref to track buses for callbacks

    // Add a flag to prevent multiple calls to unsubscribeFromRoute
    const isUnsubscribedRef = useRef(false);

    // Keep busesOnRouteRef in sync with state
    useEffect(() => {
        busesOnRouteRef.current = busesOnRoute;
    }, [busesOnRoute]);

    // =====================================================
    // ROUTE MANAGEMENT
    // =====================================================


    // =====================================================
    // BUS MANAGEMENT
    // =====================================================

    /**
     * Refresh all buses on the current route
     */
    const refreshBusesOnRoute = useCallback(async () => {
        if (!currentRouteId) return;

        try {
            // Fetch active buses for this route
            const { data: busesData, error: busesError } = await supabase
                .from("buses")
                .select(`
          id,
          plate_number,
          route_id,
          status,
          capacity,
          passengers,
          driver_id,
          driver:users!fk_driver (
            id,
            fullName
          )
        `)
                .eq("route_id", currentRouteId)
                .in("status", ["active", "waiting"]);

            if (busesError) throw busesError;

            // Get trip locations for these buses
            const busIds = busesData?.map((bus: any) => bus.id) || [];

            if (busIds.length > 0) {
                const { data: tripsData } = await supabase.rpc(
                    "get_active_trips_with_geojson",
                    { bus_ids: busIds }
                );

                const newBusesMap = new Map<string, BusOnRoute>();

                busesData?.forEach((bus: any) => {
                    const trip = tripsData?.find(
                        (t: any) =>
                            t.bus_id === bus.id &&
                            (t.status === "ongoing" || t.status === "waiting")
                    );

                    const location = trip?.current_location
                        ? parseGeoJSONPoint(trip.current_location)
                        : null;

                    newBusesMap.set(bus.id, {
                        id: bus.id,
                        plateNumber: bus.plate_number,
                        location,
                        heading: 0, // Will be updated from realtime
                        status: bus.status,
                        capacity: bus.capacity,
                        passengers: bus.passengers,
                        driverId: bus.driver_id,
                        driverName: bus.driver?.fullName || null,
                        lastUpdated: new Date(),
                    });
                });

                // IMPORTANT: Merge refresh results into the existing map instead of replacing it.
                // This prevents us from wiping out buses that were discovered via broadcast but not
                // yet returned by the DB, which caused `[UPDATE SKIP] ... size: 0`.
                setBusesOnRoute((prev) => {
                    const merged = new Map(prev);
                    for (const [id, bus] of newBusesMap.entries()) {
                        const existing = merged.get(id);
                        // Preserve the most recent location/heading if we already have one.
                        merged.set(id, {
                            ...bus,
                            location: existing?.location ?? bus.location,
                            heading: typeof existing?.heading === "number" ? existing.heading : bus.heading,
                            lastUpdated: existing?.lastUpdated ?? bus.lastUpdated,
                        });
                    }
                    return merged;
                });
            }
        } catch (err) {
            console.error("Error refreshing buses on route:", err);
        }
    }, [currentRouteId]);

    /**
     * Update a specific bus's location
     */
    const updateBusLocation = useCallback((
        busId: string,
        location: LatLng,
        heading: number = 0
    ) => {
        setBusesOnRoute((prev) => {
            const bus = prev.get(busId);
            if (!bus) {
                // If we receive a broadcast for a bus not yet in our map, upsert a minimal entry
                // so we can start rendering/animating immediately. Details will be filled in by
                // the next `refreshBusesOnRoute()`.
                const updated = new Map(prev);
                updated.set(busId, {
                    id: busId,
                    plateNumber: "(loading…)",
                    location,
                    heading,
                    status: "active",
                    capacity: null,
                    passengers: null,
                    driverId: null,
                    driverName: null,
                    lastUpdated: new Date(),
                });
                return updated;
            }

            const updated = new Map(prev);
            updated.set(busId, {
                ...bus,
                location,
                heading,
                lastUpdated: new Date(),
            });
            return updated;
        });
    }, []);

    /**
     * Subscribe to a specific bus's location updates
     */
    const subscribeToBus = useCallback((busId: string) => {
        if (busChannelsRef.current.has(busId)) return;

        const channel = supabase
            .channel(`bus-location-${busId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "trips",
                    filter: `bus_id=eq.${busId}`,
                },
                async (payload) => {
                    const updatedTrip = payload.new as any;

                    // Parse location from realtime payload (WKT or GeoJSON)
                    const location = parseGeoJSONPoint(updatedTrip.current_location);

                    if (location) {
                        updateBusLocation(busId, location);
                    }
                }
            )
            .on(
                "broadcast",
                { event: "driver_location" },
                ({ payload }) => {
                    const p = payload as Partial<BroadcastBusLocationPayload> | undefined;
                    if (!p?.busId || p.busId !== busId) return;
                    if (!p.location) return;
                    updateBusLocation(
                        busId,
                        p.location as LatLng,
                        typeof p.heading === "number" ? p.heading : 0
                    );
                }
            )
            .subscribe((status) => {
                if (status === "SUBSCRIBED") {
                    console.log(`📍 Subscribed to bus ${busId} location updates`);
                }
            });

        busChannelsRef.current.set(busId, channel);
    }, [updateBusLocation]);

    /**
     * Unsubscribe from a specific bus's location updates
     */
    const unsubscribeFromBus = useCallback((busId: string) => {
        const channel = busChannelsRef.current.get(busId);
        if (channel) {
            supabase.removeChannel(channel);
            busChannelsRef.current.delete(busId);
            console.log(`📍 Unsubscribed from bus ${busId} location updates`);
        }
    }, []);

    /**
     * Unsubscribe from all bus channels except a single bus.
     * Useful for commuters: keep the selected bus live, freeze others.
     */
    const unsubscribeFromAllBusesExcept = useCallback((keepBusId: string) => {
        busChannelsRef.current.forEach((channel, busId) => {
            if (busId === keepBusId) return;
            supabase.removeChannel(channel);
            busChannelsRef.current.delete(busId);
        });
    }, []);

    // =====================================================
    // ROUTE SUBSCRIPTION
    // =====================================================

    /**
     * Subscribe to real-time updates for a route
     */
    const subscribeToRoute = useCallback((routeId: string) => {
        // Clean up existing subscriptions
        if (routeChannelRef.current) {
            supabase.removeChannel(routeChannelRef.current);
        }
        if (tripsChannelRef.current) {
            supabase.removeChannel(tripsChannelRef.current);
        }
        if (routeBroadcastChannelRef.current) {
            supabase.removeChannel(routeBroadcastChannelRef.current);
            routeBroadcastChannelRef.current = null;
        }

        // Subscribe to trips on all buses for this route
        const busIds = Array.from(busesOnRoute.keys());

        if (busIds.length > 0) {
            const tripsChannel = supabase
                .channel(`route-trips-${routeId}`)
                .on(
                    "postgres_changes",
                    {
                        event: "*",
                        schema: "public",
                        table: "trips",
                        filter: `bus_id=in.(${busIds.join(",")})`,
                    },
                    async (payload) => {
                        const updatedTrip = payload.new as any;

                        // Parse location from realtime payload (WKT or GeoJSON)
                        const location = parseGeoJSONPoint(updatedTrip.current_location);

                        if (location) {
                            updateBusLocation(updatedTrip.bus_id, location);
                        }
                    }
                )
                .subscribe((status) => {
                    if (status === "SUBSCRIBED") {
                        setIsConnected(true);
                        console.log(`🚌 Connected to route ${routeId} real-time updates`);
                    }
                });

            tripsChannelRef.current = tripsChannel;
        }

        // Subscribe to broadcast bus location updates for this route (ephemeral)
        const routeBroadcastChannel = supabase.channel(routeBroadcastChannelName(routeId), {
            config: {
                broadcast: { self: false },
            },
        });

        routeBroadcastChannel.on("broadcast", { event: "driver_location" }, async ({ payload }) => {
            const p = payload as Partial<BroadcastBusLocationPayload> | undefined;
            if (!p?.routeId || p.routeId !== routeId) return;
            if (!p.busId || !p.location) return;

            // Check if we know this bus
            if (!busesOnRouteRef.current.has(p.busId)) {
                console.log(`🆕 [DISCOVERY] Bus ${p.busId} discovered via broadcast. Refreshing buses...`);
                // We found a new bus! It might have just come online or we missed it.
                // Trigger a refresh to get its full details (plate, driver, etc).
                await refreshBusesOnRoute();
            }

            const loc = p.location as LatLng;
            console.log(`📡 [BROADCAST RECEIVED] Driver location received for bus ${p.busId}: lat=${loc.latitude.toFixed(6)}, lng=${loc.longitude.toFixed(6)}, heading=${p.heading?.toFixed(1) ?? 'N/A'}°`);
            updateBusLocation(p.busId, loc, typeof p.heading === "number" ? p.heading : 0);
        });

        routeBroadcastChannel.subscribe((status) => {
            if (status === "SUBSCRIBED") {
                console.log(`📡 Connected to route ${routeId} broadcast updates`);
            }
        });

        routeBroadcastChannelRef.current = routeBroadcastChannel;

        // Subscribe to bus status changes on this route
        const routeChannel = supabase
            .channel(`route-buses-${routeId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "buses",
                    filter: `route_id=eq.${routeId}`,
                },
                (payload) => {
                    const updatedBus = payload.new as any;

                    setBusesOnRoute((prev) => {
                        const updated = new Map(prev);
                        const existingBus = prev.get(updatedBus.id);

                        if (payload.eventType === "DELETE") {
                            updated.delete(updatedBus.id);
                        } else {
                            updated.set(updatedBus.id, {
                                ...existingBus,
                                id: updatedBus.id,
                                plateNumber: updatedBus.plate_number,
                                status: updatedBus.status,
                                capacity: updatedBus.capacity,
                                passengers: updatedBus.passengers,
                                driverId: updatedBus.driver_id,
                                location: existingBus?.location || null,
                                heading: existingBus?.heading || 0,
                                driverName: existingBus?.driverName || null,
                                lastUpdated: new Date(),
                            });
                        }

                        return updated;
                    });
                }
            )
            .subscribe();

        routeChannelRef.current = routeChannel;
    }, [busesOnRoute, updateBusLocation]);

    /**
     * Unsubscribe from all route updates
     */
    const unsubscribeFromRoute = useCallback(() => {
        // Allow unsubscribe if there is actually something to clean up.
        const hasAnySubscription =
            !!routeChannelRef.current ||
            !!tripsChannelRef.current ||
            !!pickupChannelRef.current ||
            !!routeBroadcastChannelRef.current ||
            busChannelsRef.current.size > 0;

        if (!hasAnySubscription) {
            // No active subscriptions; don't spam logs.
            return;
        }

        if (isUnsubscribedRef.current) {
            // Already unsubscribed for the current route; avoid duplicate cleanup/logging.
            return;
        }

        // Clean up route channel
        if (routeChannelRef.current) {
            supabase.removeChannel(routeChannelRef.current);
            routeChannelRef.current = null;
        }

        // Clean up trips channel
        if (tripsChannelRef.current) {
            supabase.removeChannel(tripsChannelRef.current);
            tripsChannelRef.current = null;
        }

        // Clean up pickup channel
        if (pickupChannelRef.current) {
            supabase.removeChannel(pickupChannelRef.current);
            pickupChannelRef.current = null;
        }

        // Clean up route broadcast channel
        if (routeBroadcastChannelRef.current) {
            supabase.removeChannel(routeBroadcastChannelRef.current);
            routeBroadcastChannelRef.current = null;
        }

        // Clean up all bus channels
        busChannelsRef.current.forEach((channel) => {
            supabase.removeChannel(channel);
        });
        busChannelsRef.current.clear();

        setIsConnected(false);
        isUnsubscribedRef.current = true;
        console.log("📍 Unsubscribed from all route updates");

        // Important: allow future unsubscribes when we later resubscribe to a new route.
        // The subscribeToRoute flow should set this back to false when establishing new subscriptions.
    }, []);

    // =====================================================
    // ROUTE MANAGEMENT
    // =====================================================

    // Track currentRouteId in a ref for stable callback access
    const currentRouteIdRef = useRef(currentRouteId);
    useEffect(() => {
        currentRouteIdRef.current = currentRouteId;
    }, [currentRouteId]);

    /**
     * Set the current route and fetch its data
     */
    const setCurrentRouteHandler = useCallback(async (routeId: string | null) => {
        const currentId = currentRouteIdRef.current;
        if (routeId === currentId) return;

        // Clean up previous subscriptions - only if we are truly changing to a different route or null
        if (currentId && routeId !== currentId) {
            // We are switching routes: clear the guard so cleanup runs once.
            isUnsubscribedRef.current = false;
            unsubscribeFromRoute();
        }

        setCurrentRouteId(routeId);

        if (!routeId) {
            setCurrentRoute(null);
            setBusesOnRoute(new Map());
            setCommutersOnRoute(new Map());
            setPickupRequests(new Map());
            return;
        }

        // Reset the unsubscribe guard because we're about to (re)subscribe to a route.
        isUnsubscribedRef.current = false;

        setIsLoading(true);
        setError(null);

        try {
            // Fetch route details
            const { data: routeData, error: routeError } = await supabase.rpc(
                "get_route_geojson",
                { route_id: routeId }
            );

            if (routeError) throw routeError;

            if (routeData && routeData[0]) {
                const rawRoute = routeData[0];
                const routePath = rawRoute.geojson
                    ? parseGeoJSONLineString(rawRoute.geojson)
                    : [];

                setCurrentRoute({
                    id: rawRoute.id,
                    name: rawRoute.name,
                    startAddress: rawRoute.start_address,
                    endAddress: rawRoute.end_address,
                    path: routePath,
                });
            }

            // Fetch buses on this route
            await refreshBusesOnRoute();

            // Subscribe to real-time updates
            subscribeToRoute(routeId);

        } catch (err) {
            console.error("Error setting route:", err);
            setError("Failed to load route information");
        } finally {
            setIsLoading(false);
        }
    }, [refreshBusesOnRoute, subscribeToRoute, unsubscribeFromRoute]);

    // =====================================================
    // BROADCAST PUBLISH
    // =====================================================

    const publishBusLocationBroadcast = useCallback(async (payload: BroadcastBusLocationPayload) => {
        // Ensure we have a route broadcast channel before publishing.
        // DrivingModeScreen can start emitting location updates immediately, before `subscribeToRoute()`
        // has run and set `routeBroadcastChannelRef.current`, so we lazily create/reuse it here.
        const ensureRouteBroadcastChannel = (routeId: string) => {
            const existing = routeBroadcastChannelRef.current;

            // If we already have a channel for this route, reuse it.
            if (existing && (existing as any).topic === routeBroadcastChannelName(routeId)) {
                return existing;
            }

            // If a different route channel exists, remove it.
            if (existing) {
                supabase.removeChannel(existing);
                routeBroadcastChannelRef.current = null;
            }

            const ch = supabase.channel(routeBroadcastChannelName(routeId), {
                config: {
                    broadcast: { self: false },
                },
            });

            // We don't need to attach listeners here; this is only for publishing.
            ch.subscribe();
            routeBroadcastChannelRef.current = ch;
            return ch;
        };

        const ch = payload?.routeId ? ensureRouteBroadcastChannel(payload.routeId) : null;
        if (!ch) {
            console.warn("⚠️ DEBUG: Route broadcast channel not available for publishing!");
            return;
        }

        const res = await ch.send({
            type: "broadcast",
            event: "driver_location",
            payload: {
                ...payload,
                timestamp: payload.timestamp ?? Date.now(),
            },
        });

        // supabase-js returns string 'ok' | 'timed out' | 'error'
        if (res !== "ok") {
            console.warn("Ordered broadcast failed:", res);
        } else {
            // console.log("✅ DEBUG: Broadcast successfully sent!");
        }
    }, []);

    // =====================================================
    // PICKUP REQUESTS
    // =====================================================

    /**
     * Refresh pickup requests for a specific bus
     */
    const refreshPickupRequests = useCallback(async (busId: string) => {
        try {
            const { data, error } = await supabase
                .from("pickup_requests")
                .select(`
          id,
          commuter_id,
          bus_id,
          pickup_location,
          destination_location,
          passenger_count,
          status,
          created_at,
          commuter:users!pickup_requests_commuter_id_fkey (
            fullName
          )
        `)
                .eq("bus_id", busId)
                .in("status", ["pending", "accepted"]);

            if (error) throw error;

            const newRequestsMap = new Map<string, PickupRequest>();

            data?.forEach((request: any) => {
                newRequestsMap.set(request.id, {
                    id: request.id,
                    commuterId: request.commuter_id,
                    commuterName: request.commuter?.fullName || null,
                    busId: request.bus_id,
                    pickupLocation: parseGeoJSONPoint(request.pickup_location) || {
                        latitude: 0,
                        longitude: 0,
                    },
                    destinationLocation: parseGeoJSONPoint(request.destination_location) || {
                        latitude: 0,
                        longitude: 0,
                    },
                    passengerCount: request.passenger_count || 1,
                    status: request.status,
                    createdAt: new Date(request.created_at),
                });
            });

            setPickupRequests(newRequestsMap);
        } catch (err) {
            console.error("Error refreshing pickup requests:", err);
        }
    }, []);

    // =====================================================
    // GETTERS
    // =====================================================

    const getBus = useCallback((busId: string): BusOnRoute | undefined => {
        return busesOnRoute.get(busId);
    }, [busesOnRoute]);

    const getCommuter = useCallback((commuterId: string): CommuterOnRoute | undefined => {
        return commutersOnRoute.get(commuterId);
    }, [commutersOnRoute]);

    const getPickupRequest = useCallback((requestId: string): PickupRequest | undefined => {
        return pickupRequests.get(requestId);
    }, [pickupRequests]);

    const getActiveBusesCount = useCallback((): number => {
        return Array.from(busesOnRoute.values()).filter(
            (bus) => bus.status === "active"
        ).length;
    }, [busesOnRoute]);

    const getActiveCommutersCount = useCallback((): number => {
        return Array.from(commutersOnRoute.values()).filter(
            (commuter) => commuter.status === "waiting" || commuter.status === "boarded"
        ).length;
    }, [commutersOnRoute]);

    const getPendingPickupRequestsCount = useCallback((): number => {
        return Array.from(pickupRequests.values()).filter(
            (request) => request.status === "pending"
        ).length;
    }, [pickupRequests]);

    // =====================================================
    // CLEANUP
    // =====================================================

    // NOTE:
    // Do NOT automatically call `unsubscribeFromRoute()` from a provider-level unmount effect.
    // In React 18, effects can mount/unmount more than once during development, and navigation
    // can temporarily remount parts of the tree. That behavior produced seemingly "random"
    // `📍 Unsubscribed from all route updates` logs and dropped realtime subscriptions.
    //
    // We instead clean up subscriptions explicitly when switching routes inside
    // `setCurrentRouteHandler()` (and when calling `unsubscribeFromRoute()` directly).
    useEffect(() => {
        return () => {
            // Intentionally no-op.
        };
    }, []);

    // =====================================================
    // CONTEXT VALUE
    // =====================================================

    const contextValue: RouteContextState = {
        // State
        currentRouteId,
        currentRoute,
        busesOnRoute,
        commutersOnRoute,
        pickupRequests,
        isConnected,
        isLoading,
        error,

        // Actions
        setCurrentRoute: setCurrentRouteHandler,
        updateBusLocation,
        subscribeToBus,
        unsubscribeFromBus,
        unsubscribeFromAllBusesExcept,
        subscribeToRoute,
        unsubscribeFromRoute,
        refreshBusesOnRoute,
        refreshPickupRequests,
        publishBusLocationBroadcast,

        // Getters
        getBus,
        getCommuter,
        getPickupRequest,
        getActiveBusesCount,
        getActiveCommutersCount,
        getPendingPickupRequestsCount,
    };

    return (
        <RouteContext.Provider value={contextValue}>
            {children}
        </RouteContext.Provider>
    );
}

// =====================================================
// CUSTOM HOOKS
// =====================================================

/**
 * Main hook to access the route context
 */
export function useRoute() {
    const context = useContext(RouteContext);
    if (context === undefined) {
        throw new Error("useRoute must be used within a RouteProvider");
    }
    return context;
}

/**
 * Hook specifically for tracking a single bus's location
 * Useful for commuters following a specific bus
 */
export function useBusLocation(busId: string | null) {
    const { getBus, subscribeToBus, unsubscribeFromBus } = useRoute();

    useEffect(() => {
        if (busId) {
            subscribeToBus(busId);
            return () => unsubscribeFromBus(busId);
        }
    }, [busId, subscribeToBus, unsubscribeFromBus]);

    return busId ? getBus(busId) : undefined;
}

/**
 * Hook for drivers/conductors to get all commuters waiting for pickup on their route
 */
export function useCommutersOnRoute() {
    const { commutersOnRoute, pickupRequests, refreshPickupRequests } = useRoute();

    const commuters = useMemo(() => Array.from(commutersOnRoute.values()), [commutersOnRoute]);
    const requests = useMemo(() => Array.from(pickupRequests.values()), [pickupRequests]);

    return {
        commuters,
        pickupRequests: requests,
        refreshPickupRequests,
    };
}

/**
 * Hook for commuters to get all active buses on a route
 */
export function useBusesOnRoute() {
    const { busesOnRoute, refreshBusesOnRoute, getActiveBusesCount } = useRoute();

    const buses = useMemo(() => Array.from(busesOnRoute.values()), [busesOnRoute]);

    return {
        buses,
        activeBusesCount: getActiveBusesCount(),
        refreshBuses: refreshBusesOnRoute,
    };
}

/**
 * Hook to get the current route information
 */
export function useCurrentRoute() {
    const { currentRoute, currentRouteId, setCurrentRoute, isLoading, error } = useRoute();

    return {
        route: currentRoute,
        routeId: currentRouteId,
        setRoute: setCurrentRoute,
        isLoading,
        error,
    };
}
