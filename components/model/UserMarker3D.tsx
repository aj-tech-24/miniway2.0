import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ImageBackground,
  StyleSheet,
  View,
} from "react-native";

export function UserMarker3D() {
  const { session } = useAuth();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch the avatar when the component mounts or the session changes
    if (session?.user?.id) {
      getProfileAvatar();
    } else {
      // If there's no session, stop loading and use the default image
      setLoading(false);
    }
  }, [session]);

  /**
   * Fetches the user's avatar URL from the 'users' table in Supabase.
   */
  async function getProfileAvatar() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("users") // Your table name
        .select("avatar_url")
        .eq("id", session!.user.id)
        .single();

      if (error && error.code !== "PGRST116") {
        throw error;
      }

      if (data?.avatar_url) {
        // Use a cache-busting parameter to ensure the latest image is always shown
        const cacheBustedUrl = `${data.avatar_url}?t=${new Date().getTime()}`;
        setAvatarUrl(cacheBustedUrl);
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error("Error fetching user avatar for marker:", error.message);
      }
    } finally {
      setLoading(false);
    }
  }

  // Determine which image source to use: the fetched avatar or a local fallback
  const imageSource = avatarUrl
    ? { uri: avatarUrl }
    : require("../../assets/images/default-avatar.png"); // Using a default avatar

  return (
    <View style={styles.markerContainer}>
      {/* Show a loading indicator while fetching the image */}
      {loading ? (
        <ActivityIndicator size="large" color="#007AFF" />
      ) : (
        <ImageBackground
          source={imageSource}
          style={styles.imageBackground}
          imageStyle={styles.avatar} // Apply borderRadius to the image itself
          resizeMode="cover"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  markerContainer: {
    width: 30,
    height: 30,
    borderRadius: 30,
    backgroundColor: "#007AFF", // Changed to blue
    justifyContent: "center",
    alignItems: "center",
    // Add a shadow to lift the marker off the map
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.27,
    shadowRadius: 4.65,
    elevation: 6,
    padding: 3, // Create the border effect by padding the container
  },
  imageBackground: {
    width: "100%",
    height: "100%",
  },
  avatar: {
    // This style is now applied to the image within ImageBackground
    borderRadius: 27, // Make the image circular
  },
});
