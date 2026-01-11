# Miniway: Real-Time Mini Bus Tracker 🚌

Miniway is a mobile application designed to modernize the public transport experience for commuters in **Digos City, Philippines**. It provides real-time tracking of mini-buses, helping passengers reduce wait times, find the most convenient routes, and navigate the city with ease.

This repository contains the source code for the Miniway mobile app, built with React Native (Expo) and powered by Supabase.

## ✨ Features

Miniway offers a streamlined experience with features tailored for both commuters and administrators.

| Commuter Features | Admin Features |
| :--- | :--- |
| 🗺️ **Live Map View**: See buses moving in real-time. | ✍️ **Route Creation**: Add new routes with ease. |
| 📍 **Nearest Route Finder**: Find the closest bus route to your destination. | 🛣️ **Dynamic Path Generation**: Use Google Directions to draw accurate, traffic-aware paths. |
|  routes **Route Browsing**: View all available mini-bus routes. | 💾 **Direct Database Integration**: Save new routes directly to the Supabase database. |
| 👤 **User Profiles**: Manage personal information and saved locations. | |

-----

## 📱 App Preview

Here’s a glimpse of the Miniway app in action.

| Home Screen | Nearest Route | Add Route |
| :---: | :---: | :---: |
| \<img src="[https://storage.googleapis.com/maker-studio-project-images-prod/generated\_ac8b005e-f002-4613-810a-e325081f9b3e.jpeg](https://www.google.com/search?q=https://storage.googleapis.com/maker-studio-project-images-prod/generated_ac8b005e-f002-4613-810a-e325081f9b3e.jpeg)" width="250"\> | \<img src="[https://i.imgur.com/your-nearest-route-image.png](https://www.google.com/search?q=https://i.imgur.com/your-nearest-route-image.png)" width="250"\> | \<img src="[https://i.imgur.com/your-add-route-image.png](https://www.google.com/search?q=https://i.imgur.com/your-add-route-image.png)" width="250"\> |

*(**Note:** You can replace the placeholder image links with actual screenshots from your app.)*

-----

## 🛠️ Tech Stack & Tools

  * **Frontend**: [React Native](https://reactnative.dev/) with [Expo](https://expo.dev/)
  * **Backend & Database**: [Supabase](https://supabase.io/) (PostgreSQL with PostGIS)
  * **Mapping**: [Google Maps Platform](https://maps.googleapis.com/) (Directions API, Geocoding API)
  * **Geolocation**: `expo-location`  * **Map Rendering**: `react-native-maps`

-----

## 🏗️ System Architecture

Miniway follows a modern client-server architecture with real-time capabilities, leveraging cloud services for scalability and reliability.

### **High-Level Architecture Diagram**

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                            MINIWAY SYSTEM ARCHITECTURE                                       │
│                        (Real-Time Mini Bus Tracking System)                                  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────── EXTERNAL SERVICES ──────────────────────────────────────────┐
│                                                                                                          │
│   ┌─────────────────────────────┐        ┌──────────────────────────────┐                              │
│   │   Google Maps Platform      │        │  Push Notification Services  │                              │
│   │  ┌────────────────────────┐ │        │  ┌────────────────────────┐  │                              │
│   │  │ • Directions API       │ │        │  │ Expo Push Notifications│  │                              │
│   │  │ • Geocoding API        │ │        │  │   (projectId: 0d76c..) │  │                              │
│   │  │ • Places Autocomplete  │ │        │  │                        │  │                              │
│   │  │ • Polyline Encoding    │ │        │  │ NativeNotify Service   │  │
│   │  └────────────────────────┘ │        │  │   (appId: 32035)       │  │                              │
│   └──────────────┬──────────────┘        │  └────────────────────────┘  │                              │
│                  │ HTTP/REST             └──────────────┬───────────────┘                               │
│                  │                                      │ Push Messages                                 │
└──────────────────┼──────────────────────────────────────┼───────────────────────────────────────────────┘
                   │                                      │
                   │                                      │
┌──────────────────┼──────────────────────────────────────┼─────── MOBILE FRONTEND ──────────────────────┐
│                  │                                      │                                               │
│                  ▼                                      ▼                                               │
│  ┌───────────────────────────┐   ┌───────────────────────────┐   ┌───────────────────────────┐        │
│  │    COMMUTER APP           │   │      DRIVER APP           │   │    CONDUCTOR APP          │        │
│  │  (React Native + Expo)    │   │  (React Native + Expo)    │   │  (React Native + Expo)    │        │
│  │ ┌───────────────────────┐ │   │ ┌───────────────────────┐ │   │ ┌───────────────────────┐ │        │
│  │ │ • Live Bus Tracking   │ │   │ │ • Driving Mode Screen │ │   │ │ • QR Code Scanner     │ │        │
│  │ │ • Route Finder        │ │   │ │ • GPS Broadcasting    │ │   │ │ • Passenger Manager   │ │        │
│  │ │ • Pickup Requests     │ │   │ │ • Pickup Handler      │ │   │ │ • Boarding Verification│ │       │
│  │ │ • Trip History        │ │   │ │ • Trip Management     │ │   │ │ • Guest Addition      │ │        │
│  │ │ • Places Autocomplete │ │   │ │ • Route Selection     │ │   │ │ • Trip Monitoring     │ │        │
│  │ │ • 3D Bus Markers      │ │   │ │ • Off-Route Warning   │ │   │ │ • Realtime Updates    │ │        │
│  │ │ • Dark/Light Theme    │ │   │ │ • QR Scanner          │ │   │ │ • Passenger Stats     │ │        │
│  │ └───────────────────────┘ │   │ └───────────────────────┘ │   │ └───────────────────────┘ │        │
│  └─────────────┬─────────────┘   └─────────────┬─────────────┘   └─────────────┬─────────────┘        │
│                │                               │                               │                        │
│                │    Components & Contexts:     │                               │                        │
│                │    • AuthContext (Session, Role, Push Registration)           │                        │
│                │    • ThemeContext (Light/Dark/System with AsyncStorage)       │                        │
│                │    • react-native-maps + Custom 3D Markers (Three.js)         │                        │
│                │    • expo-location (GPS), expo-camera (QR), expo-haptics      │                        │
│                │                                                                │                        │
│                └────────────────────────────────┬───────────────────────────────┘                        │
│                                                 │                                                        │
│                                     REST API / WebSocket                                                │
│                                                 │                                                        │
└─────────────────────────────────────────────────┼──────────────────────────────────────────────────────┘
                                                  │
                                                  ▼
┌────────────────────────────────────────── SUPABASE BACKEND ─────────────────────────────────────────────┐
│                                    (Cloud-Hosted BaaS Platform)                                          │
│                                                                                                          │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                          PostgreSQL 15+ DATABASE with PostGIS Extension                           │  │
│  │                                                                                                    │  │
│  │  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │  │
│  │  │  TABLES:                                                                                     │  │  │
│  │  │  • routes (id, name, path[LineString], start_address, end_address)                          │  │  │
│  │  │  • users (id, email, role[commuter|driver|conductor|admin], fullName, contact_number)       │  │  │
│  │  │  • trips (id, bus_id, status[waiting|ongoing|completed], current_location[Point])           │  │  │
│  │  │  • buses (id, plate_number, capacity, passengers, route_id)                                 │  │  │
│  │  │  • trip_passengers (id, trip_id, passenger_id, status[waiting|boarded|completed])           │  │  │
│  │  │  • pickup_requests (id, commuter_id, bus_id, status, pickup_lat/lng, dest_lat/lng)          │  │  │
│  │  │                                                                                              │  │  │
│  │  │  VIEWS:                                                                                      │  │  │
│  │  │  • trips_with_geojson (converts PostGIS geography → GeoJSON for mobile consumption)         │  │  │
│  │  │                                                                                              │  │  │
│  │  │  INDEXES:                                                                                    │  │  │
│  │  │  • GIST spatial index on routes.path (for fast ST_Distance queries)                         │  │  │
│  │  └────────────────────────────────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                                                    │  │
│  │  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │  │
│  │  │  SQL FUNCTIONS (RPC):                                                                        │  │  │
│  │  │  • find_route_near_destination(lat, lon) → Uses ST_Distance for spatial search             │  │  │
│  │  │  • add_new_route(name, geojson) → Converts GeoJSON to PostGIS geometry                     │  │  │
│  │  │  • get_active_trips_with_geojson() → Fetches active trips with formatted locations         │  │  │
│  │  └────────────────────────────────────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                                          │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                            REALTIME ENGINE (WebSocket Pub/Sub)                                    │  │
│  │                                                                                                    │  │
│  │  Active Channels:                                                                                 │  │
│  │  • public:trips ──────────────────────────── Broadcasts all trip updates to commuters            │  │
│  │  • realtime-trips ────────────────────────── Trip status & location changes                       │  │
│  │  • pickup_requests_{busId} ───────────────── Driver/conductor pickup notifications               │  │
│  │  • passenger-boarding-{userId}-{busId} ────── Boarding confirmation updates                       │  │
│  │  • pickup-request-{userId} ───────────────── Commuter request status updates                      │  │
│  │  • trip_passengers_{tripId} ──────────────── Passenger list updates for conductors               │  │
│  │  • realtime-trip-{busId} ─────────────────── Individual bus location tracking                     │  │
│  │  • trip-passenger-{passengerId}-{busId} ──── Passenger-specific trip updates                      │  │
│  └──────────────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                                          │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                         AUTHENTICATION & AUTHORIZATION                                            │  │
│  │                                                                                                    │  │
│  │  • Email/Password Authentication                                                                  │  │
│  │  • JWT Tokens with Auto-Refresh                                                                   │  │
│  │  • Row Level Security (RLS) Policies per Role                                                     │  │
│  │  • Session Management via AsyncStorage                                                            │  │
│  │  • Role-based Access Control (commuter, driver, conductor, admin)                                │  │
│  └──────────────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                                          │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                              STORAGE SERVICE                                                      │  │
│  │                                                                                                    │  │
│  │  • User Profile Avatars (JPEG/PNG)                                                                │  │
│  │  • Route Documentation Images                                                                     │  │
│  │  • Uploaded Files via FileUpload Component                                                        │  │
│  │  • CDN-backed for Fast Global Delivery                                                            │  │
│  └──────────────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                                          │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘


┌───────────────────────────────────────── DATA FLOW EXAMPLES ────────────────────────────────────────────┐
│                                                                                                          │
│  [1] REAL-TIME BUS TRACKING:                                                                            │
│      Driver App (GPS every 2s) → Update trips.current_location (PostGIS Point)                         │
│      → Supabase Realtime broadcasts to "public:trips" WebSocket channel                                │
│      → All subscribed Commuter Apps receive update → Map markers refresh position                       │
│                                                                                                          │
│  [2] PICKUP REQUEST FLOW:                                                                               │
│      Commuter requests pickup → Insert pickup_requests table                                            │
│      → Realtime broadcasts to "pickup_requests_{busId}" channel                                         │
│      → Driver/Conductor receives notification → Accept/Decline                                          │
│      → Status update broadcasts back to "pickup-request-{userId}" channel                               │
│      → Conductor scans QR code → Update trip_passengers.status to "boarded"                             │
│      → Realtime updates "trip_passengers_{tripId}" channel                                              │
│                                                                                                          │
│  [3] ROUTE DISCOVERY:                                                                                   │
│      Commuter searches destination → Google Places Autocomplete → Get coordinates                       │
│      → Call Supabase RPC: find_route_near_destination(lat, lon)                                        │
│      → PostGIS executes ST_Distance on all routes with GIST index                                       │
│      → Returns nearest route with GeoJSON path → Render polyline on map                                 │
│                                                                                                          │
│  [4] ADMIN ROUTE CREATION:                                                                              │
│      Admin enters origin/destination → Google Geocoding API (addresses → coordinates)                   │
│      → Google Directions API (waypoints → optimized polyline with alternatives)                         │
│      → Admin selects route → Call add_new_route(name, geojson)                                         │
│      → PostGIS stores as geography LineString → Route available to all users                            │
│                                                                                                          │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────── TECHNOLOGY STACK ────────────────────────────────────────────────┐
│                                                                                                          │
│  FRONTEND:           React Native 0.79.6 • Expo SDK 53 • TypeScript 5.x                                │
│  NAVIGATION:         Expo Router 5.1 (file-based) • React Navigation 7.1                               │
│  STATE MANAGEMENT:   React Context API • AsyncStorage 2.1.2                                             │
│  MAPPING:            react-native-maps 1.20.1 • Google Maps Platform                                   │
│  3D GRAPHICS:        Three.js via @react-three/fiber 9.3 • expo-gl 15.1                                │
│  BACKEND:            Supabase (PostgreSQL 15+ with PostGIS extension)                                   │
│  REALTIME:           Supabase Realtime (WebSocket channels)                                             │
│  AUTHENTICATION:     Supabase Auth (JWT with refresh tokens)                                            │
│  PUSH NOTIFICATIONS: Expo Notifications 0.31.4 • NativeNotify 4.0.9                                     │
│  LOCATION:           expo-location 18.1.6 (GPS tracking)                                                │
│  CAMERA:             expo-camera 16.1.11 (QR code scanning)                                             │
│  UTILITIES:          @mapbox/polyline 1.2.1 • expo-haptics 14.1.4                                       │
│                                                                                                          │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────── SECURITY & PERFORMANCE ─────────────────────────────────────────────┐
│                                                                                                          │
│  SECURITY:                                       PERFORMANCE:                                           │
│  ✓ Environment variables (.env)                 ✓ PostGIS GIST spatial indexing                        │
│  ✓ Row Level Security (RLS) policies            ✓ Location updates throttled (2-5s)                    │
│  ✓ JWT token validation                         ✓ AsyncStorage caching (routes, theme)                 │
│  ✓ HTTPS-only API communication                 ✓ Database view: trips_with_geojson                    │
│  ✓ Google API key restrictions                  ✓ Selective Realtime subscriptions                     │
│  ✓ Camera/location permission handling          ✓ 3D GLB models (optimized format)                     │
│  ✓ AsyncStorage encryption                      ✓ Lazy loading of routes                               │
│                                                  ✓ Connection pooling (Supabase managed)               │
│                                                                                                          │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### **Component Breakdown**

#### **1. Mobile Applications (Frontend)**
The system supports three distinct user roles, each with a tailored interface:

- **Commuter App**
  - View real-time bus locations on map
  - Search for nearest routes to destination
  - Browse all available routes
  - Track trip history
  - Manage user profile and saved locations
  
- **Driver/Conductor App**
  - Start/end trips and update bus status
  - Share real-time location with commuters
  - View assigned routes
  - Manage trip logs
  
- **Admin Interface**
  - Create and manage bus routes
  - Generate route paths using Google Directions API
  - Monitor system usage and analytics
  - Manage user roles and permissions

**Technologies:**
- React Native with Expo for cross-platform development
- `react-native-maps` for map rendering
- `expo-location` for GPS tracking
- Supabase client for backend communication

#### **2. Supabase Backend**

**Database (PostgreSQL + PostGIS)**
- **PostGIS Extension**: Enables spatial queries and geographic calculations
- **Key Tables:**
  - `routes`: Stores route information with geographic LineString paths
  - `users`: User accounts with role-based permissions
  - `trips`: Active and historical trip records
  - `bus_locations`: Real-time position data for buses

**SQL Functions:**
```sql
-- Spatial query to find nearest route to destination
find_route_near_destination(dest_lat, dest_lon)

-- Insert new route with GeoJSON geometry
add_new_route(route_name, route_path)
```

**Realtime Channels:**
- Broadcasts live bus position updates to connected commuters
- Uses WebSocket connections for low-latency updates
- Subscribers receive updates when buses move

**Authentication & Authorization:**
- Email/password authentication
- Row Level Security (RLS) policies for data access control
- Role-based permissions (commuter, driver, conductor, admin)

**Storage:**
- User profile images
- Route documentation and photos

#### **3. External Services**

**Google Maps Platform:**
- **Directions API**: Generates accurate route polylines between waypoints
- **Geocoding API**: Converts addresses to coordinates and vice versa
- Provides traffic-aware routing for optimal paths

### **Data Flow Scenarios**

#### **Scenario 1: Commuter Finding Nearest Route**
```
1. User enters destination → App geocodes address
2. App calls Supabase RPC: find_route_near_destination(lat, lon)
3. PostGIS calculates ST_Distance for all routes
4. Returns nearest route with GeoJSON path
5. App renders polyline on map
```

#### **Scenario 2: Admin Creating New Route**
```
1. Admin selects waypoints on map
2. App calls Google Directions API
3. Receives optimized route polyline
4. App calls Supabase: add_new_route(name, geojson)
5. PostGIS stores as geography LineString
6. Route becomes available to all users
```

#### **Scenario 3: Real-Time Bus Tracking**
```
1. Driver starts trip → App begins location tracking
2. Device location updates (every 5-10 seconds)
3. App inserts/updates bus_locations table
4. Supabase Realtime broadcasts change
5. Subscribed commuters receive update via WebSocket
6. Maps update bus marker positions
```

### **Security Architecture**

- **API Key Management**: Environment variables for sensitive keys
- **Row Level Security**: Database-level access control
- **Google API Restrictions**: HTTP referrer and app bundle restrictions
- **Authentication Tokens**: JWT-based session management
- **HTTPS Only**: All API communications encrypted

### **Performance Optimizations**

- **Spatial Indexing**: GIST index on `routes.path` for fast spatial queries
- **Realtime Throttling**: Location updates limited to prevent flooding
- **Caching**: Route data cached locally on mobile apps
- **Database Connection Pooling**: Managed by Supabase
- **Lazy Loading**: Routes loaded on-demand as user pans map

### **Scalability Considerations**

- **Horizontal Scaling**: Supabase automatically scales with demand
- **Realtime Channels**: Can handle thousands of concurrent connections
- **CDN for Assets**: Static resources served via edge network
- **Database Partitioning**: Future consideration for high-volume trip logs
- **Microservices Ready**: Architecture allows service extraction if needed

-----

## 🚀 Getting Started

Follow these instructions to set up the project for local development.

### **Prerequisites**

  * Node.js (LTS version) and npm/yarn
  * Expo Go app on your mobile device or an Android/iOS simulator
  * A Supabase account (free tier is sufficient)
  * A Google Maps Platform account with an API key

### **1. Backend Setup (Supabase)**

1.  **Create a Supabase Project**:

      * Go to [supabase.com](https://supabase.com) and create a new project.
      * Save your **Project URL** and **`anon` (public) key**.

2.  **Enable PostGIS Extension**:

      * In your Supabase project, navigate to **Database** \> **Extensions**.
      * Search for `postgis` and enable it. This is crucial for geospatial queries.

3.  **Create the `routes` Table**:

      * Go to the **SQL Editor** and run the following script to create the main table for storing routes.

    <!-- end list -->

    ```sql
    CREATE TABLE public.routes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      path geography(LineString, 4326) NOT NULL, -- Stores the route path
      created_at timestamp with time zone DEFAULT now()
    );

    -- Optional but recommended: Add a spatial index for faster queries
    CREATE INDEX routes_path_idx ON public.routes USING GIST (path);
    ```

4.  **Create SQL Functions**:

      * Run the following queries in the **SQL Editor** to create the necessary database functions for finding and adding routes.

    <!-- end list -->

    ```sql
    -- Function to find the nearest route to a given destination
    CREATE OR REPLACE FUNCTION find_route_near_destination(
      dest_lat FLOAT,
      dest_lon FLOAT
    )
    RETURNS TABLE(id UUID, name TEXT, path JSON) AS $$
    BEGIN
      RETURN QUERY
      SELECT
        r.id,
        r.name,
        ST_AsGeoJSON(r.path)::JSON AS path
      FROM
        routes r
      ORDER BY
        ST_Distance(r.path, ST_SetSRID(ST_MakePoint(dest_lon, dest_lat), 4326)::GEOGRAPHY)
      LIMIT 1;
    END;
    $$ LANGUAGE plpgsql;

    -- Function to safely add a new route from a GeoJSON object
    CREATE OR REPLACE FUNCTION add_new_route(
        route_name text,
        route_path jsonb
    )
    RETURNS void AS $$
    BEGIN
      INSERT INTO public.routes (name, path)
      VALUES (
        route_name,
        ST_GeomFromGeoJSON(route_path)
      );
    END;
    $$ LANGUAGE plpgsql;
    ```

### **2. Frontend Setup (Local)**

1.  **Clone the Repository**:

    ```bash
    git clone https://github.com/your-username/miniway-bus-tracker.git
    cd miniway-bus-tracker
    ```

2.  **Install Dependencies**:

    ```bash
    npm install
    # or
    yarn install
    ```

3.  **Set Up Environment Variables**:

      * Create a file named `.env` in the root of the project.
      * Add your credentials to this file. **Do not commit this file to GitHub\!**

    <!-- end list -->

    ```env
    EXPO_PUBLIC_SUPABASE_URL="YOUR_SUPABASE_PROJECT_URL"
    EXPO_PUBLIC_SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_KEY"
    EXPO_PUBLIC_GOOGLEMAPS_API_KEY="YOUR_GOOGLE_MAPS_API_KEY"
    ```

      * **Important**: Make sure your Google Maps API key has the **Directions API** and **Geocoding API** enabled in the Google Cloud Console.

4.  **Run the Application**:

    ```bash
    npm start
    # or
    yarn start
    ```

      * Scan the QR code with the Expo Go app on your phone, or press `a` or `i` to run on a simulator.

-----

## 🤝 Contributing

Contributions are welcome\! If you have suggestions or want to improve the app, please feel free to:

1.  **Fork** the repository.
2.  Create a new **branch** (`git checkout -b feature/AmazingFeature`).
3.  **Commit** your changes (`git commit -m 'Add some AmazingFeature'`).
4.  **Push** to the branch (`git push origin feature/AmazingFeature`).
5.  Open a **Pull Request**.

-----

## 📜 License

This project is licensed under the MIT License. See the `LICENSE` file for more details.
