# Route Details Bus Tracking Logic Review

## Requirements

The `route-details.tsx` should behave as follows:

### On Load
- Fetch buses + show them (static)
- Do NOT keep syncing contextBuses into local buses state continuously
- Get static latest location from the existing DB fetch (`get_active_trips_with_geojson`)

### On Bus Select
- `subscribeToBus(selectedBus.id)`
- `unsubscribeFromAllBusesExcept(selectedBus.id)`
- Optionally `unsubscribeFromRoute()` so route-wide updates stop

---

## Issues Found

### ❌ Issue 1: Continuous Bus State Sync (Lines 855-894)
**Problem**: There was a `useEffect` that continuously synced ALL buses from `contextBuses` to local `buses` state, overwriting the static snapshot from the database.

```typescript
useEffect(() => {
  if (contextBuses) {
    // This was updating ALL buses continuously from realtime context
    setBuses((prevBuses) => {
      // ... updating all buses
    });
  }
}, [contextBuses]);
```

**Impact**: Buses would continuously update their positions even before the user selected one, violating the requirement to keep them static.

**Fix**: Removed this entire effect. ✅

---

### ❌ Issue 2: Redundant Animation Update (Lines 838-852)
**Problem**: There was a redundant `useEffect` that only updated `animatedBusPositions` for the selected bus, but a more comprehensive effect below already handled this.

```typescript
useEffect(() => {
  if (!isLiveTrackingSelectedBus || !selectedBus?.id) return;
  // Only updating animatedBusPositions
  setAnimatedBusPositions((prev) => {
    // ...
  });
}, [contextBuses, isLiveTrackingSelectedBus, selectedBus?.id]);
```

**Impact**: Redundant code that was already handled by the effect at lines 860-899.

**Fix**: Removed this redundant effect. ✅

---

### ❌ Issue 3: No-op Effect (Lines 230-237)
**Problem**: A placeholder `useEffect` that did nothing but had dependencies.

```typescript
useEffect(() => {
  if (!isLiveTrackingSelectedBus) return;
  // Intentionally no-op here (legacy behavior removed).
}, [contextBuses, contextRouteId, routeIdParam, isLiveTrackingSelectedBus]);
```

**Impact**: Unnecessary re-renders on dependency changes.

**Fix**: Removed this no-op effect. ✅

---

## ✅ Correct Implementation

### 1. Initial Data Fetch (Lines 314-622)
The initial fetch correctly gets static bus locations from the database:

```typescript
const { data: tripsData } = await supabase.rpc(
  "get_active_trips_with_geojson",
  { bus_ids: busIds }
);

const formattedBuses: Bus[] = (busesData ?? []).map((bus: any) => {
  const trip = (tripsData ?? []).find(/* ... */);
  let location = null;
  if (trip?.current_location) {
    const geo = JSON.parse(trip.current_location);
    location = {
      latitude: geo.coordinates[1],
      longitude: geo.coordinates[0],
    };
  }
  return { /* ... */ location };
});
setBuses(formattedBuses); // Static snapshot
```

✅ **Correct**: Fetches static location from DB and sets it once.

---

### 2. Bus Selection Handler (Lines 1008-1066)
When a bus is selected:

```typescript
const handleBusSelect = (bus: Bus) => {
  setSelectedBus(bus);
  setShowPickupSelection(true);
  // ... camera animation
};
```

✅ **Correct**: Sets the selected bus, which triggers subscriptions.

---

### 3. Subscription Management (Lines 818-836)
When `selectedBus` changes:

```typescript
useEffect(() => {
  if (!selectedBus?.id) return;

  setIsLiveTrackingSelectedBus(true);

  subscribeToBus(selectedBus.id);
  unsubscribeFromAllBusesExcept(selectedBus.id);
  unsubscribeFromRoute();

  return () => {
    unsubscribeFromBus(selectedBus.id);
  };
}, [selectedBus?.id, subscribeToBus, unsubscribeFromBus, 
    unsubscribeFromAllBusesExcept, unsubscribeFromRoute]);
```

✅ **Correct**: Subscribes to only the selected bus and unsubscribes from route-wide updates.

---

### 4. Selected Bus Real-time Updates (Lines 846-885)
Only the selected bus gets real-time updates:

```typescript
useEffect(() => {
  if (!isLiveTrackingSelectedBus || !selectedBus?.id) return;
  if (!contextBuses) return;

  const selectedFromContext = contextBuses.find((b) => b.id === selectedBus.id);
  if (!selectedFromContext) return;

  // Update ONLY the selected bus
  setBuses((prev) =>
    prev.map((bus) => {
      if (bus.id !== selectedBus.id) return bus; // Keep others static
      return {
        ...bus,
        location: selectedFromContext.location ?? bus.location,
        // ... other updates
      };
    })
  );

  // Update animated position for smooth marker movement
  if (selectedFromContext.location) {
    setAnimatedBusPositions((prev) => {
      const next = new Map(prev);
      next.set(selectedBus.id, selectedFromContext.location!);
      return next;
    });
  }
}, [contextBuses, isLiveTrackingSelectedBus, selectedBus?.id]);
```

✅ **Correct**: Only updates the selected bus from real-time context, keeps all others static.

---

## Summary

The implementation now correctly follows the required logic:

1. ✅ **On Load**: Fetches buses with static locations from DB
2. ✅ **Static Display**: Does NOT continuously sync contextBuses to local state
3. ✅ **On Bus Select**: 
   - Subscribes to selected bus
   - Unsubscribes from all other buses
   - Unsubscribes from route-wide updates
4. ✅ **Real-time Updates**: Only the selected bus receives real-time location updates

All problematic effects that were causing continuous syncing have been removed.
