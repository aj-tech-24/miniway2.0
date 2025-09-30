import { useAuth } from "@/contexts/AuthContext";
import { useAppTheme } from "@/contexts/ThemeContext";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useThemeColor } from "@/hooks/useThemeColor";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  RefreshControl,
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
  const [refreshing, setRefreshing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const fadeAnim = useState(new Animated.Value(0))[0];

  // Custom Alert State
  const [showCustomAlert, setShowCustomAlert] = useState(false);
  const [alertConfig, setAlertConfig] = useState({
    title: "",
    message: "",
    type: "info" as "info" | "error" | "warning" | "success",
    onConfirm: () => {},
    confirmText: "OK",
    showCancel: false,
    onCancel: () => {},
    cancelText: "Cancel",
  });

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

  // Custom Alert Function
  const showAlert = (
    title: string,
    message: string,
    type: "info" | "error" | "warning" | "success" = "info",
    onConfirm: () => void = () => {},
    confirmText: string = "OK",
    showCancel: boolean = false,
    onCancel: () => void = () => {},
    cancelText: string = "Cancel"
  ) => {
    setAlertConfig({
      title,
      message,
      type,
      onConfirm,
      confirmText,
      showCancel,
      onCancel,
      cancelText,
    });
    setShowCustomAlert(true);
  };

  const hideAlert = () => {
    setShowCustomAlert(false);
  };

  // Helper functions for alert styling
  const getAlertColor = (type: string) => {
    switch (type) {
      case "error":
        return "#FF3B30";
      case "warning":
        return "#FF9500";
      case "success":
        return "#34C759";
      default:
        return "#007AFF";
    }
  };

  const getAlertIcon = (type: string) => {
    switch (type) {
      case "error":
        return "close-circle";
      case "warning":
        return "warning";
      case "success":
        return "checkmark-circle";
      default:
        return "information-circle";
    }
  };

  useEffect(() => {
    if (session) {
      getProfile();
    }
  }, [session]);

  // Animate success message
  useEffect(() => {
    if (showSuccessMessage) {
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.delay(2000),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => setShowSuccessMessage(false));
    }
  }, [showSuccessMessage, fadeAnim]);

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
        showAlert(
          "Profile Loading Failed",
          "Unable to load your profile information. Please check your internet connection and try again.",
          "error"
        );
    } finally {
      setLoading(false);
      setRefreshing(false);
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

      // Show success message with better UX
      showAlert(
        "Profile Updated Successfully! ✅",
        "Your profile information has been saved successfully. All changes are now active.",
        "success",
        () => {
          setIsEditing(false);
          getProfile(); // Refresh the profile data
        },
        "Great!"
      );
    } catch (error) {
      if (error instanceof Error)
        showAlert(
          "Profile Update Failed",
          "Unable to save your profile changes. Please check your internet connection and try again.",
          "error"
        );
    } finally {
      setLoading(false);
      setIsEditing(false);
    }
  }

  async function handleAvatarUpload() {
    // --- 1. Request permission and pick image (no changes here) ---
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      showAlert(
        "Camera Roll Permission Required",
        "We need access to your photo library to upload a profile picture. Please enable photo library access in your device settings.",
        "warning"
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

    setAvatarLoading(true);
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
      showAlert(
        "Avatar Upload Failed",
        "Unable to upload your profile picture. Please check your internet connection and try again.",
        "error"
      );
      setAvatarLoading(false);
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
      showAlert(
        "Profile Update Failed",
        "Your picture was uploaded but couldn't be saved to your profile. Please try again.",
        "error"
      );
      setAvatarLoading(false);
      return;
    }

    // --- 6. Update the local state to reflect the new avatar ---
    // **FIX:** Add a timestamp to the URL to bust the cache and force a re-render.
    const cacheBustedUrl = `${newAvatarUrl}?t=${new Date().getTime()}`;
    setAvatarUrl(cacheBustedUrl);
    setAvatarLoading(false);
    setShowSuccessMessage(true);
  }

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await getProfile();
    } catch (error) {
      // Error handling is done in getProfile
    }
  }, []);

  function handleSignOut() {
    showAlert(
      "Sign Out",
      "Are you sure you want to sign out? You'll need to sign in again to access your commuter account.",
      "warning",
      signOut,
      "Sign Out",
      true,
      () => {},
      "Cancel"
    );
  }

  const renderInputField = (
    label: string,
    value: string,
    onChangeText: (text: string) => void,
    placeholder: string,
    icon: string,
    errorKey: string,
    keyboardType: "default" | "phone-pad" | "numeric" = "default"
  ) => (
    <View style={styles.inputContainer}>
      <Text style={[styles.inputLabel, { color: textColor }]}>{label}</Text>
      <View
        style={[
          styles.inputRow,
          { backgroundColor: rowBg },
          errors[errorKey] && styles.inputError,
        ]}
      >
        <Ionicons name={icon as any} size={20} color="#007AFF" />
        <TextInput
          style={[styles.input, { backgroundColor: inputBg, color: inputText }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          editable={isEditing}
          keyboardType={keyboardType}
          placeholderTextColor="#8e8e93"
        />
      </View>
      {errors[errorKey] && (
        <Text style={styles.errorText}>{errors[errorKey]}</Text>
      )}
    </View>
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor }]}
      edges={["top", "left", "right"]}
    >
      <StatusBar style={theme === "dark" ? "light" : "dark"} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.headerIconContainer}>
            {refreshing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="person-circle" size={28} color="#007AFF" />
            )}
          </View>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Commuter Profile</Text>
            <Text style={styles.headerSubtitle}>
              {refreshing
                ? "Refreshing..."
                : "Manage your account & preferences"}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={["#007AFF"]}
            tintColor="#007AFF"
            title="Pull to refresh profile"
            titleColor="#8e8e93"
            progressBackgroundColor="#ffffff"
          />
        }
      >
        {/* Profile Header Card */}
        <View style={[styles.profileCard, { backgroundColor: cardBg }]}>
          <TouchableOpacity
            onPress={isEditing ? handleAvatarUpload : undefined}
            disabled={loading || avatarLoading}
            style={styles.avatarContainer}
          >
            <Image
              source={
                avatarUrl
                  ? { uri: avatarUrl }
                  : require("@/assets/images/default-avatar.png")
              }
              style={styles.avatar}
            />
            {(loading || avatarLoading) && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator color="#fff" size="small" />
              </View>
            )}
            {isEditing && !avatarLoading && (
              <View style={styles.editIcon}>
                <Ionicons name="camera" size={16} color="#fff" />
              </View>
            )}
          </TouchableOpacity>

          <View style={styles.profileInfo}>
            {isEditing ? (
              <TextInput
                style={[styles.nameInput, { color: cardText }]}
                value={fullName}
                onChangeText={setFullName}
                placeholder="Full Name"
                autoCapitalize="words"
                placeholderTextColor="#8e8e93"
              />
            ) : (
              <Text style={[styles.fullName, { color: cardText }]}>
                {fullName || session?.user?.email?.split("@")[0] || "Commuter"}
              </Text>
            )}
            <Text style={[styles.email, { color: cardText }]}>
              {session?.user?.email}
            </Text>
            <View style={styles.statusBadge}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>Active Commuter</Text>
            </View>
          </View>

          {!isEditing && (
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => setIsEditing(true)}
            >
              <Ionicons name="create-outline" size={18} color="#007AFF" />
              <Text style={styles.editButtonText}>
                {fullName ? "Edit Profile" : "Create Profile"}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Personal Information */}
        <View style={[styles.section, { backgroundColor: sectionBg }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="person" size={24} color="#007AFF" />
            <Text style={[styles.sectionTitle, { color: textColor }]}>
              Personal Information
            </Text>
          </View>

          {!fullName && !isEditing && (
            <View style={styles.emptyStateCard}>
              <Ionicons name="person-add" size={32} color="#8e8e93" />
              <Text style={[styles.emptyStateTitle, { color: textColor }]}>
                No Profile Found
              </Text>
              <Text
                style={[styles.emptyStateDescription, { color: textColor }]}
              >
                Create your commuter profile to get started
              </Text>
            </View>
          )}
          {renderInputField(
            "Full Name",
            fullName,
            setFullName,
            "Enter your full name",
            "person-outline",
            "fullName"
          )}

          {renderInputField(
            "Contact Number",
            contactNumber,
            setContactNumber,
            "Enter your phone number",
            "call-outline",
            "contactNumber",
            "phone-pad"
          )}

          {renderInputField(
            "Emergency Contact",
            emergencyContact,
            setEmergencyContact,
            "Emergency contact number",
            "call-outline",
            "emergencyContact",
            "phone-pad"
          )}
        </View>

        {/* Saved Locations */}
        <View style={[styles.section, { backgroundColor: sectionBg }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="location" size={24} color="#007AFF" />
            <Text style={[styles.sectionTitle, { color: textColor }]}>
              Saved Locations
            </Text>
          </View>

          {renderInputField(
            "Home Address",
            homeLocation,
            setHomeLocation,
            "Enter your home address",
            "home-outline",
            "homeLocation"
          )}

          {renderInputField(
            "Work Address",
            workLocation,
            setWorkLocation,
            "Enter your work address",
            "briefcase-outline",
            "workLocation"
          )}
        </View>

        {/* Settings */}
        <View style={[styles.section, { backgroundColor: sectionBg }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="settings" size={24} color="#007AFF" />
            <Text style={[styles.sectionTitle, { color: textColor }]}>
              Commuter Settings
            </Text>
          </View>

          <View style={[styles.settingRow, { backgroundColor: rowBg }]}>
            <View style={styles.settingLeft}>
              <Ionicons name="notifications" size={20} color="#007AFF" />
              <View style={styles.settingTextContainer}>
                <Text style={[styles.settingLabel, { color: textColor }]}>
                  Push Notifications
                </Text>
                <Text style={[styles.settingDescription, { color: textColor }]}>
                  Get notified about trip updates
                </Text>
              </View>
            </View>
            <Switch
              trackColor={{ false: "#767577", true: "#81b0ff" }}
              thumbColor={notificationsEnabled ? "#007AFF" : "#f4f3f4"}
              onValueChange={() => setNotificationsEnabled((prev) => !prev)}
              value={notificationsEnabled}
            />
          </View>

          <View style={[styles.settingRow, { backgroundColor: rowBg }]}>
            <View style={styles.settingLeft}>
              <Ionicons name="moon" size={20} color="#007AFF" />
              <View style={styles.settingTextContainer}>
                <Text style={[styles.settingLabel, { color: textColor }]}>
                  Dark Mode
                </Text>
                <Text style={[styles.settingDescription, { color: textColor }]}>
                  Switch to dark theme
                </Text>
              </View>
            </View>
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

        {/* Sign Out Button */}
        {!isEditing && (
          <View style={styles.signOutContainer}>
            <TouchableOpacity
              style={styles.signOutButton}
              onPress={handleSignOut}
            >
              <Ionicons name="log-out-outline" size={20} color="#FF3B30" />
              <Text style={styles.signOutText}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Action Buttons */}
      {isEditing && (
        <View style={[styles.actionButtons, { backgroundColor: cardBg }]}>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => {
              setIsEditing(false);
              getProfile();
              setErrors({});
            }}
            disabled={loading}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.saveButton}
            onPress={updateProfile}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark" size={16} color="#fff" />
                <Text style={styles.saveButtonText}>Save Changes</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Custom Alert Modal */}
      <Modal
        visible={showCustomAlert}
        transparent={true}
        animationType="fade"
        onRequestClose={hideAlert}
      >
        <View style={styles.alertOverlay}>
          <View style={styles.alertContainer}>
            <View style={styles.alertHeader}>
              <View
                style={[
                  styles.alertIconContainer,
                  { backgroundColor: getAlertColor(alertConfig.type) },
                ]}
              >
                <Ionicons
                  name={getAlertIcon(alertConfig.type)}
                  size={24}
                  color="#fff"
                />
              </View>
              <Text style={styles.alertTitle}>{alertConfig.title}</Text>
            </View>

            <Text style={styles.alertMessage}>{alertConfig.message}</Text>

            <View style={styles.alertButtons}>
              {alertConfig.showCancel && (
                <TouchableOpacity
                  style={[styles.alertButton, styles.alertCancelButton]}
                  onPress={() => {
                    alertConfig.onCancel();
                    hideAlert();
                  }}
                >
                  <Text style={styles.alertCancelButtonText}>
                    {alertConfig.cancelText}
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[
                  styles.alertButton,
                  styles.alertConfirmButton,
                  { backgroundColor: getAlertColor(alertConfig.type) },
                ]}
                onPress={() => {
                  alertConfig.onConfirm();
                  hideAlert();
                }}
              >
                <Text style={styles.alertConfirmButtonText}>
                  {alertConfig.confirmText}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  header: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgb(255, 255, 255)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#fff",
  },
  headerSubtitle: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.8)",
    marginTop: 2,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  profileCard: {
    margin: 20,
    padding: 24,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
    alignItems: "center",
  },
  avatarContainer: {
    position: "relative",
    marginBottom: 16,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: "#007AFF",
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    borderRadius: 50,
    justifyContent: "center",
    alignItems: "center",
  },
  editIcon: {
    position: "absolute",
    bottom: 0,
    right: 0,
    backgroundColor: "#007AFF",
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  profileInfo: {
    alignItems: "center",
    marginBottom: 20,
  },
  fullName: {
    fontSize: 24,
    fontWeight: "700",
    color: "#333",
    marginBottom: 4,
  },
  nameInput: {
    fontSize: 24,
    fontWeight: "700",
    color: "#333",
    borderBottomWidth: 1,
    borderColor: "#007AFF",
    textAlign: "center",
    paddingVertical: 8,
    minWidth: 200,
  },
  email: {
    fontSize: 16,
    color: "#8e8e93",
    marginBottom: 12,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E8F5E8",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#4CAF50",
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#4CAF50",
  },
  editButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F0F8FF",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#007AFF",
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#007AFF",
    marginLeft: 6,
  },
  section: {
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 20,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#333",
    marginLeft: 12,
    flex: 1,
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#E5E5E7",
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: "#333",
    paddingVertical: 12,
    marginLeft: 12,
  },
  inputError: {
    borderColor: "#FF3B30",
    borderWidth: 1,
  },
  errorText: {
    fontSize: 12,
    color: "#FF3B30",
    marginTop: 4,
    marginLeft: 4,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#E5E5E7",
  },
  settingLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  settingTextContainer: {
    marginLeft: 12,
    flex: 1,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: 12,
    color: "#8e8e93",
  },
  signOutContainer: {
    marginHorizontal: 20,
    marginBottom: 20,
  },
  signOutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FF3B30",
  },
  signOutText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FF3B30",
    marginLeft: 8,
  },
  actionButtons: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: "#E5E5E7",
    backgroundColor: "#fff",
  },
  cancelButton: {
    flex: 1,
    backgroundColor: "#F2F2F7",
    paddingVertical: 16,
    borderRadius: 12,
    marginRight: 8,
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#8e8e93",
  },
  saveButton: {
    flex: 1,
    backgroundColor: "#007AFF",
    paddingVertical: 16,
    borderRadius: 12,
    marginLeft: 8,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
    marginLeft: 6,
  },
  emptyStateCard: {
    backgroundColor: "#F8F9FA",
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#E5E5E7",
    borderStyle: "dashed",
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginTop: 12,
    marginBottom: 4,
  },
  emptyStateDescription: {
    fontSize: 14,
    color: "#8e8e93",
    textAlign: "center",
  },
  // Custom Alert Styles
  alertOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  alertContainer: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  alertHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  alertIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  alertTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1a1a1a",
    flex: 1,
  },
  alertMessage: {
    fontSize: 16,
    color: "#666",
    lineHeight: 22,
    marginBottom: 24,
  },
  alertButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  alertButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    minWidth: 80,
    alignItems: "center",
  },
  alertCancelButton: {
    backgroundColor: "#f2f2f7",
    borderWidth: 1,
    borderColor: "#e5e5e7",
  },
  alertCancelButtonText: {
    color: "#666",
    fontSize: 16,
    fontWeight: "600",
  },
  alertConfirmButton: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  alertConfirmButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});

export default ProfileScreen;
