import { useAuth } from "@/contexts/AuthContext";
import { useAppTheme } from "@/contexts/ThemeContext";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useThemeColor } from "@/hooks/useThemeColor";
import { supabase } from "@/lib/supabase";
import { FontAwesome, Ionicons, MaterialIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export function ProfileScreen() {
  const { signOut, session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  // --- State for all profile fields ---
  const [fullName, setFullName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [contactNumber, setContactNumber] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [homeLocation, setHomeLocation] = useState("");
  const [workLocation, setWorkLocation] = useState("");

  // --- State for settings ---
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const systemColorScheme = useColorScheme();

  const { theme, setTheme } = useAppTheme();
  const darkModeEnabled = theme === "dark";

  // Use darkModeEnabled for theme

  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");

  const cardBg = useThemeColor({}, "background");
  const cardText = useThemeColor({}, "text");
  const inputBg = useThemeColor({}, "background");
  const inputText = useThemeColor({}, "text");
  const sectionBg = useThemeColor({}, "background");
  const rowBg = useThemeColor({}, "background");

  useEffect(() => {
    if (session) {
      getProfile();
    }
  }, [session]);

  async function getProfile() {
    try {
      setLoading(true);
      if (!session?.user) throw new Error("No user on the session!");

      const { data, error, status } = await supabase
        .from("users")
        .select(
          `fullName, avatar_url, contact_number, emergency_contact, home_location, work_location`
        )
        .eq("id", session.user.id)
        .single();

      if (error && status !== 406) throw error;

      if (data) {
        setFullName(data.fullName || "");
        setAvatarUrl(data.avatar_url);
        setContactNumber(data.contact_number || "");
        setEmergencyContact(data.emergency_contact || "");
        setHomeLocation(data.home_location || "");
        setWorkLocation(data.work_location || "");
      }
    } catch (error) {
      if (error instanceof Error)
        Alert.alert("Error fetching profile", error.message);
    } finally {
      setLoading(false);
    }
  }

  function validateProfile() {
    const newErrors: { [key: string]: string } = {};

    if (!fullName.trim()) {
      newErrors.fullName = "Full name is required.";
    }
    if (!contactNumber.trim()) {
      newErrors.contactNumber = "Contact number is required.";
    } else if (!/^\d{10,}$/.test(contactNumber.trim())) {
      newErrors.contactNumber = "Enter a valid contact number.";
    }
    if (!emergencyContact.trim()) {
      newErrors.emergencyContact = "Emergency contact is required.";
    } else if (!/^\d{10,}$/.test(emergencyContact.trim())) {
      newErrors.emergencyContact = "Enter a valid emergency contact.";
    }
    if (!homeLocation.trim()) {
      newErrors.homeLocation = "Home address is required.";
    }
    if (!workLocation.trim()) {
      newErrors.workLocation = "Work address is required.";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function updateProfile() {
    if (!validateProfile()) return;

    try {
      setLoading(true);
      if (!session?.user) throw new Error("No user on the session!");

      const updates = {
        id: session.user.id,
        fullName,
        avatar_url: avatarUrl,
        contact_number: contactNumber,
        emergency_contact: emergencyContact,
        home_location: homeLocation,
        work_location: workLocation,
        updated_at: new Date(),
      };

      const { error } = await supabase.from("users").upsert(updates);
      if (error) throw error;
      Alert.alert("Success", "Profile updated successfully!");
    } catch (error) {
      if (error instanceof Error)
        Alert.alert("Error updating profile", error.message);
    } finally {
      setLoading(false);
      setIsEditing(false);
    }
  }

  async function handleAvatarUpload() {
    // --- 1. Request permission and pick image (no changes here) ---
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission Required",
        "Sorry, we need camera roll permissions to make this work!"
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return;
    }

    setLoading(true);
    const image = result.assets[0];
    const fileExt = image.uri.split(".").pop();
    const fileName = `${session!.user.id}.${fileExt}`;
    const filePath = fileName;

    // --- 2. Fetch the user's current avatar URL to find the old file path ---
    // We do this before uploading the new one.
    try {
      const { data: profileData, error: profileError } = await supabase
        .from("users") // This should be your actual user/profile table name
        .select("avatar_url")
        .eq("id", session!.user.id)
        .single();

      if (profileError) {
        // It's okay if the user doesn't have a profile yet, but we should log other errors.
        console.log(
          "Could not fetch user profile, maybe it's their first time:",
          profileError.message
        );
      }

      // --- 3. If a previous avatar exists, delete it from storage ---
      if (profileData?.avatar_url) {
        // Extract the file path from the full URL
        const oldFilePath = profileData.avatar_url
          .split("/")
          .pop()
          ?.split("?")[0];
        if (oldFilePath) {
          console.log(`Removing old avatar: ${oldFilePath}`);
          const { error: removeError } = await supabase.storage
            .from("avatars")
            .remove([oldFilePath]);

          if (removeError) {
            // Log the error but don't block the upload of the new avatar
            console.warn("Could not remove old avatar:", removeError.message);
          }
        }
      }
    } catch (error) {
      console.error(
        "An error occurred during the old avatar removal process:",
        error
      );
    }

    // --- 4. Upload the new avatar ---
    const formData = new FormData();
    formData.append("file", {
      uri: image.uri,
      name: fileName,
      type: `image/${fileExt}`,
    } as any);

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(filePath, formData, {
        upsert: true, // Upsert is true to overwrite if a file with the same name exists
      });

    if (uploadError) {
      Alert.alert("Upload Error", uploadError.message);
      setLoading(false);
      return;
    }

    // --- 5. Get the new public URL and update the user's profile table ---
    const { data: urlData } = supabase.storage
      .from("avatars")
      .getPublicUrl(filePath);

    const newAvatarUrl = urlData.publicUrl;

    const { error: updateError } = await supabase
      .from("users") // This should be your actual user/profile table name
      .update({ avatar_url: newAvatarUrl }) // Store the clean URL in the database
      .eq("id", session!.user.id);

    if (updateError) {
      Alert.alert(
        "Database Error",
        "Could not update your profile with the new avatar."
      );
      setLoading(false);
      return;
    }

    // --- 6. Update the local state to reflect the new avatar ---
    // **FIX:** Add a timestamp to the URL to bust the cache and force a re-render.
    const cacheBustedUrl = `${newAvatarUrl}?t=${new Date().getTime()}`;
    setAvatarUrl(cacheBustedUrl);
    setLoading(false);
  }

  // --- Confirm sign out ---
  function handleSignOut() {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: signOut },
    ]);
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor }]}
      edges={["top", "left", "right"]}
    >
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Header Card */}
        <View style={[styles.headerCard, { backgroundColor: cardBg }]}>
          <TouchableOpacity
            onPress={isEditing ? handleAvatarUpload : undefined}
            disabled={loading}
            style={styles.avatarWrapper}
          >
            <Image
              source={
                avatarUrl
                  ? { uri: avatarUrl }
                  : require("@/assets/images/default-avatar.png")
              }
              style={styles.avatar}
            />
            {loading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator color="#fff" />
              </View>
            )}
            {isEditing && (
              <View style={styles.editIcon}>
                <Ionicons name="camera-outline" size={20} color="#fff" />
              </View>
            )}
          </TouchableOpacity>
          {isEditing ? (
            <TextInput
              style={styles.nameInput}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Full Name"
              autoCapitalize="words"
            />
          ) : (
            <Text style={[styles.fullName, { color: cardText }]}>
              {fullName || "Commuter"}
            </Text>
          )}
          <Text style={[styles.email, { color: cardText }]}>
            {session?.user?.email}
          </Text>
          {/* Edit Profile button at the top */}
          {!isEditing && (
            <TouchableOpacity
              style={[
                styles.button,
                styles.editButton,
                { marginTop: 16, width: "60%" },
              ]}
              onPress={() => setIsEditing(true)}
            >
              <Text style={styles.buttonText}>Edit Profile</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.divider} />

        {/* Personal Info */}
        <View style={[styles.section, { backgroundColor: sectionBg }]}>
          <Text style={[styles.sectionTitle, { color: textColor }]}>
            Personal Information
          </Text>
          {/* Contact Number */}
          <Text style={[styles.inputLabel, { color: textColor }]}>
            Contact Number
          </Text>
          <View
            style={[
              styles.fieldRow,
              { backgroundColor: rowBg },
              errors.contactNumber && {
                borderColor: "#dc3545",
                borderWidth: 1,
              },
            ]}
          >
            <MaterialIcons name="phone" size={20} color="#007AFF" />
            <TextInput
              style={[
                styles.input,
                { backgroundColor: inputBg, color: inputText },
              ]}
              value={contactNumber}
              onChangeText={setContactNumber}
              placeholder="Contact Number"
              editable={isEditing}
              keyboardType="phone-pad"
              placeholderTextColor={inputText}
            />
          </View>
          {errors.contactNumber && (
            <Text style={{ color: "#dc3545", marginLeft: 10 }}>
              {errors.contactNumber}
            </Text>
          )}

          {/* Emergency Contact */}
          <Text style={[styles.inputLabel, { color: textColor }]}>
            Emergency Contact
          </Text>
          <View
            style={[
              styles.fieldRow,
              { backgroundColor: rowBg },
              errors.emergencyContact && {
                borderColor: "#dc3545",
                borderWidth: 1,
              },
            ]}
          >
            <FontAwesome name="user-plus" size={20} color="#007AFF" />
            <TextInput
              style={[
                styles.input,
                { backgroundColor: inputBg, color: inputText },
              ]}
              value={emergencyContact}
              onChangeText={setEmergencyContact}
              placeholder="Emergency Contact"
              editable={isEditing}
              keyboardType="phone-pad"
              placeholderTextColor={inputText}
            />
          </View>
          {errors.emergencyContact && (
            <Text style={{ color: "#dc3545", marginLeft: 10 }}>
              {errors.emergencyContact}
            </Text>
          )}
        </View>

        <View style={styles.divider} />

        {/* Saved Locations */}
        <View style={[styles.section, { backgroundColor: sectionBg }]}>
          <Text style={[styles.sectionTitle, { color: textColor }]}>
            Saved Locations
          </Text>
          {/* Home Address */}
          <Text style={[styles.inputLabel, { color: textColor }]}>
            Home Address
          </Text>
          <View
            style={[
              styles.fieldRow,
              { backgroundColor: rowBg },
              errors.homeLocation && {
                borderColor: "#dc3545",
                borderWidth: 1,
              },
            ]}
          >
            <MaterialIcons name="home" size={20} color="#007AFF" />
            <TextInput
              style={[
                styles.input,
                { backgroundColor: inputBg, color: inputText },
              ]}
              value={homeLocation}
              onChangeText={setHomeLocation}
              placeholder="Home Address"
              editable={isEditing}
              placeholderTextColor={inputText}
            />
          </View>
          {errors.homeLocation && (
            <Text style={{ color: "#dc3545", marginLeft: 10 }}>
              {errors.homeLocation}
            </Text>
          )}

          {/* Work Address */}
          <Text style={[styles.inputLabel, { color: textColor }]}>
            Work Address
          </Text>
          <View
            style={[
              styles.fieldRow,
              { backgroundColor: rowBg },
              errors.workLocation && {
                borderColor: "#dc3545",
                borderWidth: 1,
              },
            ]}
          >
            <MaterialIcons name="work" size={20} color="#007AFF" />
            <TextInput
              style={[
                styles.input,
                { backgroundColor: inputBg, color: inputText },
              ]}
              value={workLocation}
              onChangeText={setWorkLocation}
              placeholder="Work Address"
              editable={isEditing}
              placeholderTextColor={inputText}
            />
          </View>
          {errors.workLocation && (
            <Text style={{ color: "#dc3545", marginLeft: 10 }}>
              {errors.workLocation}
            </Text>
          )}
        </View>

        <View style={styles.divider} />

        {/* Settings */}
        <View style={[styles.section, { backgroundColor: sectionBg }]}>
          <Text style={[styles.sectionTitle, { color: textColor }]}>
            Settings
          </Text>
          <View style={[styles.settingRow, { backgroundColor: rowBg }]}>
            <MaterialIcons name="notifications" size={20} color="#007AFF" />
            <Text style={[styles.label, { color: textColor }]}>
              Push Notifications
            </Text>
            <Switch
              trackColor={{ false: "#767577", true: "#81b0ff" }}
              thumbColor={notificationsEnabled ? "#007AFF" : "#f4f3f4"}
              onValueChange={() => setNotificationsEnabled((prev) => !prev)}
              value={notificationsEnabled}
            />
          </View>
          <View style={[styles.settingRow, { backgroundColor: rowBg }]}>
            <MaterialIcons name="dark-mode" size={20} color="#007AFF" />
            <Text style={[styles.label, { color: textColor }]}>
              Enable Dark Mode
            </Text>
            <Switch
              trackColor={{ false: "#767577", true: "#81b0ff" }}
              thumbColor={darkModeEnabled ? "#007AFF" : "#f4f3f4"}
              onValueChange={() =>
                setTheme(theme === "dark" ? "light" : "dark")
              }
              value={darkModeEnabled}
            />
          </View>
        </View>

        {/* Sign Out button stays at the bottom when not editing */}
        {!isEditing && (
          <View style={[styles.stickyButtons, { backgroundColor: cardBg }]}>
            <TouchableOpacity
              style={[styles.button, styles.signOutButton]}
              onPress={handleSignOut}
            >
              <Text style={styles.buttonText}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Sticky Action Buttons */}
      {isEditing && (
        <View style={[styles.stickyButtons, { backgroundColor: cardBg }]}>
          <TouchableOpacity
            style={[styles.button, styles.saveButton]}
            onPress={updateProfile}
            disabled={loading}
          >
            <Text style={styles.buttonText}>Save Changes</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.cancelButton]}
            onPress={() => {
              setIsEditing(false);
              getProfile();
            }}
            disabled={loading}
          >
            <Text style={styles.buttonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f9fa" },
  headerCard: {
    alignItems: "center",
    paddingVertical: 30,
    backgroundColor: "#fff",
    margin: 16,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  avatarWrapper: { position: "relative" },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: "#007AFF",
    marginBottom: 15,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 60,
  },
  editIcon: {
    position: "absolute",
    bottom: 10,
    right: 0,
    backgroundColor: "#007AFF",
    padding: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: "#fff",
  },
  fullName: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#333",
    marginTop: 8,
  },
  nameInput: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#333",
    borderBottomWidth: 1,
    borderColor: "#ccc",
    textAlign: "center",
    padding: 5,
    width: "70%",
    marginTop: 8,
  },
  email: {
    fontSize: 16,
    color: "#6c757d",
    marginTop: 4,
  },
  section: {
    marginTop: 5, // Increased spacing between sections
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 22, // Larger font
    fontWeight: "700", // Bolder
    color: "#333",
    marginBottom: 18, // More space below title
    letterSpacing: 0.5,
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 10,
    marginBottom: 16, // More space below each field
    borderWidth: 1,
    borderColor: "#eee",
  },
  label: {
    fontSize: 16,
    color: "#666",
    marginLeft: 8,
    flex: 1,
  },
  input: {
    flex: 1,
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 10,
    fontSize: 16,
    borderWidth: 0,
    marginLeft: 8,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ddd",
    marginBottom: 8,
  },
  stickyButtons: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    marginHorizontal: 10,
    backgroundColor: "#fff",
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#eee",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  button: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 24,
    alignItems: "center",
    marginHorizontal: 4,
  },
  editButton: { backgroundColor: "#007AFF" },
  signOutButton: { backgroundColor: "#dc3545" },
  saveButton: { backgroundColor: "#28a745" },
  cancelButton: { backgroundColor: "#6c757d" },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  inputLabel: {
    fontSize: 15, // Smaller than section title
    fontWeight: "500",
    color: "#666",
    marginBottom: 4,
    marginLeft: 2,
    marginTop: 2, // Slight space above label
  },
  // Optional divider style
  divider: {
    height: 1,
    backgroundColor: "#eee",
    marginVertical: 16,
    marginHorizontal: 10,
    borderRadius: 1,
  },
});

export default ProfileScreen;
