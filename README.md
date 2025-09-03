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
  * **Geolocation**: `expo-location`
  * **Map Rendering**: `react-native-maps`

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
