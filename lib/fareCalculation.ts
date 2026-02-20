/**
 * Fare Calculation Utility for Miniway Transit App
 * 
 * Fare Structure:
 * - First 4 km: ₱15.00 (base fare)
 * - Succeeding km: ₱1.80/km (regular) or ₱1.44/km (discounted)
 * - Student/Elderly/Disabled get 20% discount on succeeding km rate
 */

export type LatLng = {
    latitude: number;
    longitude: number;
};

// Fare constants
const BASE_FARE = 15.0;              // First 4 km
const BASE_DISTANCE_KM = 4;           // Distance covered by base fare
const RATE_PER_KM = 1.8;              // Regular rate per km after base
const DISCOUNTED_RATE_PER_KM = 1.44;  // 20% discounted rate (1.80 * 0.8)

/**
 * Calculate fare based on distance traveled
 * @param distanceKm - Distance in kilometers
 * @param isDiscounted - Whether to apply student/elderly/disabled discount
 * @returns Fare amount in Philippine Pesos
 */
export function calculateFare(distanceKm: number, isDiscounted: boolean = false): number {
    if (distanceKm <= 0) return 0;

    // Base fare covers first 4 km
    if (distanceKm <= BASE_DISTANCE_KM) {
        return BASE_FARE;
    }

    // Calculate additional distance beyond base
    const additionalDistance = distanceKm - BASE_DISTANCE_KM;
    const ratePerKm = isDiscounted ? DISCOUNTED_RATE_PER_KM : RATE_PER_KM;
    const additionalFare = additionalDistance * ratePerKm;

    // Round to 2 decimal places
    return Math.round((BASE_FARE + additionalFare) * 100) / 100;
}

/**
 * Format fare amount for display
 * @param amount - Fare amount in pesos
 * @returns Formatted string (e.g., "₱15.00")
 */
export function formatFare(amount: number): string {
    return `₱${amount.toFixed(2)}`;
}

/**
 * Calculate distance between two LatLng points using Haversine formula
 * @returns Distance in kilometers
 */
export function getDistanceKm(a: LatLng, b: LatLng): number {
    const R = 6371; // Earth's radius in kilometers
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

/**
 * Find the index of the closest point on a route to a given location
 * @param point - The point to find the closest route point to
 * @param routeCoordinates - Array of coordinates representing the route
 * @returns Index of the closest point in the route array
 */
export function findClosestRoutePointIndex(
    point: LatLng,
    routeCoordinates: LatLng[]
): number {
    if (!point || routeCoordinates.length === 0) return -1;

    let closestIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < routeCoordinates.length; i++) {
        const distance = getDistanceKm(point, routeCoordinates[i]);
        if (distance < minDistance) {
            minDistance = distance;
            closestIndex = i;
        }
    }

    return closestIndex;
}

/**
 * Calculate the distance along a route between two points
 * This traces the route path rather than using straight-line distance
 * @param pickup - Pickup location
 * @param dropoff - Drop-off location
 * @param routeCoordinates - Array of coordinates representing the route
 * @returns Distance in kilometers along the route
 */
export function calculateDistanceAlongRoute(
    pickup: LatLng,
    dropoff: LatLng,
    routeCoordinates: LatLng[]
): number {
    if (!pickup || !dropoff || routeCoordinates.length < 2) {
        // Fallback to straight-line distance if route not available
        return getDistanceKm(pickup, dropoff);
    }

    // Find closest route points to pickup and dropoff
    const pickupIndex = findClosestRoutePointIndex(pickup, routeCoordinates);
    const dropoffIndex = findClosestRoutePointIndex(dropoff, routeCoordinates);

    if (pickupIndex === -1 || dropoffIndex === -1) {
        return getDistanceKm(pickup, dropoff);
    }

    // Ensure we calculate distance in the correct direction along the route
    const startIndex = Math.min(pickupIndex, dropoffIndex);
    const endIndex = Math.max(pickupIndex, dropoffIndex);

    // Sum up distances between consecutive route points
    let totalDistance = 0;

    // Add distance from pickup to first route point
    totalDistance += getDistanceKm(pickup, routeCoordinates[pickupIndex]);

    // Add distances along route segments
    for (let i = startIndex; i < endIndex; i++) {
        totalDistance += getDistanceKm(routeCoordinates[i], routeCoordinates[i + 1]);
    }

    // Add distance from last route point to dropoff
    totalDistance += getDistanceKm(routeCoordinates[dropoffIndex], dropoff);

    return totalDistance;
}

/**
 * Calculate fare for a trip given pickup and dropoff locations
 * @param pickup - Pickup location
 * @param dropoff - Drop-off location  
 * @param routeCoordinates - Array of coordinates representing the route
 * @param isDiscounted - Whether to apply student/elderly/disabled discount
 * @returns Object containing distance and fare
 */
export function calculateTripFare(
    pickup: LatLng,
    dropoff: LatLng,
    routeCoordinates: LatLng[],
    isDiscounted: boolean = false
): { distanceKm: number; fare: number } {
    const distanceKm = calculateDistanceAlongRoute(pickup, dropoff, routeCoordinates);
    const fare = calculateFare(distanceKm, isDiscounted);

    return { distanceKm, fare };
}

/**
 * Format distance for display
 * @param distanceKm - Distance in kilometers
 * @returns Formatted string (e.g., "2.5 km" or "800 m")
 */
export function formatDistance(distanceKm: number): string {
    if (distanceKm < 1) {
        return `${Math.round(distanceKm * 1000)} m`;
    }
    return `${distanceKm.toFixed(1)} km`;
}
