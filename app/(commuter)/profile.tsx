import { useAuth } from "@/contexts/AuthContext";
import { useAppTheme } from "@/contexts/ThemeContext";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useThemeColor } from "@/hooks/useThemeColor";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
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
    onConfirm: () => { },
    confirmText: "OK",
    showCancel: false,
    onCancel: () => { },
    cancelText: "Cancel",
  });

  // State for all profile fields
  const [fullName, setFullName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [contactNumber, setContactNumber] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [homeLocation, setHomeLocation] = useState("");
  const [workLocation, setWorkLocation] = useState("");

  // State for settings
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const systemColorScheme = useColorScheme();

  const { theme, setTheme } = useAppTheme();
  const darkModeEnabled = theme === "dark";
  const isDark = theme === "dark";

  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const cardBg = useThemeColor({}, "background");
  const cardText = useThemeColor({}, "text");
  const inputBg = useThemeColor({}, "background");
  const inputText = useThemeColor({}, "text");

  // Custom Alert Function
  const showAlert = (
    title: string,
    message: string,
    type: "info" | "error" | "warning" | "success" = "info",
    onConfirm: () => void = () => { },
    confirmText: string = "OK",
    showCancel: boolean = false,
    onCancel: () => void = () => { },
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

  const getAlertColors = (type: string): readonly [string, string] => {
    switch (type) {
      case "error":
        return ["#EF4444", "#DC2626"];
      case "warning":
        return ["#F59E0B", "#D97706"];
      case "success":
        return ["#10B981", "#059669"];
      default:
        return ["#3B82F6", "#2563EB"];
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

      showAlert(
        "Profile Updated Successfully! ✅",
        "Your profile information has been saved successfully. All changes are now active.",
        "success",
        () => {
          setIsEditing(false);
          getProfile();
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

    try {
      const { data: profileData, error: profileError } = await supabase
        .from("users")
        .select("avatar_url")
        .eq("id", session!.user.id)
        .single();

      if (profileError) {
        console.log(
          "Could not fetch user profile, maybe it's their first time:",
          profileError.message
        );
      }

      if (profileData?.avatar_url) {
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

    const formData = new FormData();
    formData.append("file", {
      uri: image.uri,
      name: fileName,
      type: `image/${fileExt}`,
    } as any);

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(filePath, formData, {
        upsert: true,
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

    const { data: urlData } = supabase.storage
      .from("avatars")
      .getPublicUrl(filePath);

    const newAvatarUrl = urlData.publicUrl;

    const { error: updateError } = await supabase
      .from("users")
      .update({ avatar_url: newAvatarUrl })
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
      () => { },
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
    gradientColors: readonly [string, string],
    keyboardType: "default" | "phone-pad" | "numeric" = "default"
  ) => (
    <View style={styles.inputContainer}>
      <View style={styles.inputLabelRow}>
        <LinearGradient colors={gradientColors} style={styles.inputIconGradient}>
          <Ionicons name={icon as any} size={14} color="#fff" />
        </LinearGradient>
        <Text style={[styles.inputLabel, { color: textColor }]}>{label}</Text>
      </View>
      <View
        style={[
          styles.inputRow,
          isDark && styles.inputRowDark,
          errors[errorKey] && styles.inputError,
        ]}
      >
        <TextInput
          style={[styles.input, { color: inputText }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          editable={isEditing}
          keyboardType={keyboardType}
          placeholderTextColor={isDark ? "#6B7280" : "#9CA3AF"}
        />
        {isEditing && value.length > 0 && (
          <Ionicons name="checkmark-circle" size={18} color="#10B981" />
        )}
      </View>
      {errors[errorKey] && (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={14} color="#EF4444" />
          <Text style={styles.errorText}>{errors[errorKey]}</Text>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor }]}
      edges={["top", "left", "right"]}
    >
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      {/* Premium Gradient Header */}
      <LinearGradient
        colors={isDark
          ? ["#1a365d", "#2563eb", "#3b82f6"]
          : ["#0052d4", "#4364f7", "#6fb1fc"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        {/* Decorative elements */}
        <View style={styles.headerDecorativeCircle1} />
        <View style={styles.headerDecorativeCircle2} />

        <View style={styles.headerContent}>
          <View style={styles.headerIconContainer}>
            <LinearGradient
              colors={["#ffffff", "#f0f9ff"]}
              style={styles.headerIconGradient}
            >
              {refreshing ? (
                <ActivityIndicator size="small" color="#3B82F6" />
              ) : (
                <Ionicons name="person" size={24} color="#3B82F6" />
              )}
            </LinearGradient>
          </View>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>My Profile</Text>
            <Text style={styles.headerSubtitle}>
              {refreshing
                ? "Refreshing..."
                : "Manage your account"}
            </Text>
          </View>
          {!isEditing && (
            <TouchableOpacity
              style={styles.headerEditButton}
              onPress={() => setIsEditing(true)}
            >
              <Ionicons name="create-outline" size={20} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={["#3B82F6"]}
            tintColor="#3B82F6"
            progressBackgroundColor={isDark ? "#1F2937" : "#ffffff"}
          />
        }
      >
        {/* Profile Header Card */}
        <View style={[styles.profileCard, isDark && styles.profileCardDark]}>
          <LinearGradient
            colors={isDark
              ? ["rgba(59, 130, 246, 0.1)", "rgba(37, 99, 235, 0.05)"]
              : ["rgba(59, 130, 246, 0.08)", "rgba(37, 99, 235, 0.02)"]}
            style={StyleSheet.absoluteFill}
          />

          <TouchableOpacity
            onPress={isEditing ? handleAvatarUpload : undefined}
            disabled={loading || avatarLoading}
            style={styles.avatarContainer}
          >
            <LinearGradient
              colors={["#3B82F6", "#2563EB"]}
              style={styles.avatarBorder}
            >
              <View style={styles.avatarInner}>
                <Image
                  source={
                    avatarUrl
                      ? { uri: avatarUrl }
                      : require("@/assets/images/default-avatar.png")
                  }
                  style={styles.avatar}
                />
              </View>
            </LinearGradient>
            {(loading || avatarLoading) && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator color="#fff" size="small" />
              </View>
            )}
            {isEditing && !avatarLoading && (
              <LinearGradient
                colors={["#3B82F6", "#2563EB"]}
                style={styles.editIcon}
              >
                <Ionicons name="camera" size={16} color="#fff" />
              </LinearGradient>
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
                placeholderTextColor={isDark ? "#6B7280" : "#9CA3AF"}
              />
            ) : (
              <Text style={[styles.fullName, { color: cardText }]}>
                {fullName || session?.user?.email?.split("@")[0] || "Commuter"}
              </Text>
            )}
            <Text style={[styles.email, { color: isDark ? "#9CA3AF" : "#6B7280" }]}>
              {session?.user?.email}
            </Text>
            <LinearGradient
              colors={["#10B981", "#059669"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.statusBadge}
            >
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>Active Commuter</Text>
            </LinearGradient>
          </View>
        </View>

        {/* Personal Information */}
        <View style={[styles.section, isDark && styles.sectionDark]}>
          <View style={styles.sectionHeader}>
            <LinearGradient
              colors={["#3B82F6", "#2563EB"]}
              style={styles.sectionIconGradient}
            >
              <Ionicons name="person" size={18} color="#fff" />
            </LinearGradient>
            <View>
              <Text style={[styles.sectionTitle, { color: textColor }]}>
                Personal Information
              </Text>
              <Text style={[styles.sectionSubtitle, { color: isDark ? "#9CA3AF" : "#6B7280" }]}>
                Your contact details
              </Text>
            </View>
          </View>

          {!fullName && !isEditing && (
            <View style={[styles.emptyStateCard, isDark && styles.emptyStateCardDark]}>
              <LinearGradient
                colors={["rgba(59, 130, 246, 0.1)", "rgba(37, 99, 235, 0.05)"]}
                style={styles.emptyStateIcon}
              >
                <Ionicons name="person-add" size={24} color={isDark ? "#60A5FA" : "#3B82F6"} />
              </LinearGradient>
              <Text style={[styles.emptyStateTitle, { color: textColor }]}>
                Complete Your Profile
              </Text>
              <Text style={[styles.emptyStateDescription, { color: isDark ? "#9CA3AF" : "#6B7280" }]}>
                Add your information to get started
              </Text>
            </View>
          )}

          {renderInputField(
            "Full Name",
            fullName,
            setFullName,
            "Enter your full name",
            "person-outline",
            "fullName",
            ["#3B82F6", "#2563EB"]
          )}

          {renderInputField(
            "Contact Number",
            contactNumber,
            setContactNumber,
            "Enter your phone number",
            "call-outline",
            "contactNumber",
            ["#10B981", "#059669"],
            "phone-pad"
          )}

          {renderInputField(
            "Emergency Contact",
            emergencyContact,
            setEmergencyContact,
            "Emergency contact number",
            "alert-circle-outline",
            "emergencyContact",
            ["#EF4444", "#DC2626"],
            "phone-pad"
          )}
        </View>

        {/* Saved Locations */}
        <View style={[styles.section, isDark && styles.sectionDark]}>
          <View style={styles.sectionHeader}>
            <LinearGradient
              colors={["#F59E0B", "#D97706"]}
              style={styles.sectionIconGradient}
            >
              <Ionicons name="location" size={18} color="#fff" />
            </LinearGradient>
            <View>
              <Text style={[styles.sectionTitle, { color: textColor }]}>
                Saved Locations
              </Text>
              <Text style={[styles.sectionSubtitle, { color: isDark ? "#9CA3AF" : "#6B7280" }]}>
                Quick access addresses
              </Text>
            </View>
          </View>

          {renderInputField(
            "Home Address",
            homeLocation,
            setHomeLocation,
            "Enter your home address",
            "home-outline",
            "homeLocation",
            ["#8B5CF6", "#7C3AED"]
          )}

          {renderInputField(
            "Work Address",
            workLocation,
            setWorkLocation,
            "Enter your work address",
            "briefcase-outline",
            "workLocation",
            ["#06B6D4", "#0891B2"]
          )}
        </View>

        {/* Settings */}
        <View style={[styles.section, isDark && styles.sectionDark]}>
          <View style={styles.sectionHeader}>
            <LinearGradient
              colors={["#6366F1", "#4F46E5"]}
              style={styles.sectionIconGradient}
            >
              <Ionicons name="settings" size={18} color="#fff" />
            </LinearGradient>
            <View>
              <Text style={[styles.sectionTitle, { color: textColor }]}>
                Preferences
              </Text>
              <Text style={[styles.sectionSubtitle, { color: isDark ? "#9CA3AF" : "#6B7280" }]}>
                App settings
              </Text>
            </View>
          </View>

          <View style={[styles.settingRow, isDark && styles.settingRowDark]}>
            <View style={styles.settingLeft}>
              <LinearGradient
                colors={["#F59E0B", "#D97706"]}
                style={styles.settingIconGradient}
              >
                <Ionicons name="notifications" size={16} color="#fff" />
              </LinearGradient>
              <View style={styles.settingTextContainer}>
                <Text style={[styles.settingLabel, { color: textColor }]}>
                  Push Notifications
                </Text>
                <Text style={[styles.settingDescription, { color: isDark ? "#9CA3AF" : "#6B7280" }]}>
                  Get trip updates & alerts
                </Text>
              </View>
            </View>
            <Switch
              trackColor={{ false: isDark ? "#374151" : "#D1D5DB", true: "#86EFAC" }}
              thumbColor={notificationsEnabled ? "#10B981" : isDark ? "#6B7280" : "#f4f3f4"}
              onValueChange={() => setNotificationsEnabled((prev) => !prev)}
              value={notificationsEnabled}
            />
          </View>

          <View style={[styles.settingRow, isDark && styles.settingRowDark]}>
            <View style={styles.settingLeft}>
              <LinearGradient
                colors={["#6366F1", "#4F46E5"]}
                style={styles.settingIconGradient}
              >
                <Ionicons name="moon" size={16} color="#fff" />
              </LinearGradient>
              <View style={styles.settingTextContainer}>
                <Text style={[styles.settingLabel, { color: textColor }]}>
                  Dark Mode
                </Text>
                <Text style={[styles.settingDescription, { color: isDark ? "#9CA3AF" : "#6B7280" }]}>
                  Switch to dark theme
                </Text>
              </View>
            </View>
            <Switch
              trackColor={{ false: isDark ? "#374151" : "#D1D5DB", true: "#C4B5FD" }}
              thumbColor={darkModeEnabled ? "#8B5CF6" : isDark ? "#6B7280" : "#f4f3f4"}
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
              style={[styles.signOutButton, isDark && styles.signOutButtonDark]}
              onPress={handleSignOut}
              activeOpacity={0.7}
            >
              <LinearGradient
                colors={["rgba(239, 68, 68, 0.1)", "rgba(220, 38, 38, 0.05)"]}
                style={StyleSheet.absoluteFill}
              />
              <Ionicons name="log-out-outline" size={20} color="#EF4444" />
              <Text style={styles.signOutText}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        )}
        {/* Action Buttons */}
        {isEditing && (
          <View style={[styles.actionButtons, isDark && styles.actionButtonsDark]}>
            <TouchableOpacity
              style={[styles.cancelButton, isDark && styles.cancelButtonDark]}
              onPress={() => {
                setIsEditing(false);
                getProfile();
                setErrors({});
              }}
              disabled={loading}
            >
              <Text style={[styles.cancelButtonText, { color: isDark ? "#9CA3AF" : "#6B7280" }]}>
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.saveButtonWrapper}
              onPress={updateProfile}
              disabled={loading}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={["#3B82F6", "#2563EB"]}
                style={styles.saveButton}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={18} color="#fff" />
                    <Text style={styles.saveButtonText}>Save Changes</Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Custom Alert Modal */}
      <Modal
        visible={showCustomAlert}
        transparent={true}
        animationType="fade"
        onRequestClose={hideAlert}
      >
        <View style={styles.alertOverlay}>
          <View style={[styles.alertContainer, isDark && styles.alertContainerDark]}>
            <View style={styles.alertHeader}>
              <LinearGradient
                colors={getAlertColors(alertConfig.type)}
                style={styles.alertIconContainer}
              >
                <Ionicons
                  name={getAlertIcon(alertConfig.type) as any}
                  size={24}
                  color="#fff"
                />
              </LinearGradient>
              <Text style={[styles.alertTitle, { color: isDark ? "#F9FAFB" : "#1a1a1a" }]}>
                {alertConfig.title}
              </Text>
            </View>

            <Text style={[styles.alertMessage, { color: isDark ? "#9CA3AF" : "#666" }]}>
              {alertConfig.message}
            </Text>

            <View style={styles.alertButtons}>
              {alertConfig.showCancel && (
                <TouchableOpacity
                  style={[styles.alertButton, styles.alertCancelButton, isDark && styles.alertCancelButtonDark]}
                  onPress={() => {
                    alertConfig.onCancel();
                    hideAlert();
                  }}
                >
                  <Text style={[styles.alertCancelButtonText, { color: isDark ? "#9CA3AF" : "#666" }]}>
                    {alertConfig.cancelText}
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.alertConfirmButtonWrapper}
                onPress={() => {
                  alertConfig.onConfirm();
                  hideAlert();
                }}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={getAlertColors(alertConfig.type)}
                  style={styles.alertConfirmButton}
                >
                  <Text style={styles.alertConfirmButtonText}>
                    {alertConfig.confirmText}
                  </Text>
                </LinearGradient>
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
  },

  // Premium Header Styles
  header: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    position: "relative",
    overflow: "hidden",
  },
  headerDecorativeCircle1: {
    position: "absolute",
    top: -30,
    right: -30,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  headerDecorativeCircle2: {
    position: "absolute",
    top: 50,
    right: 60,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerIconContainer: {
    marginRight: 14,
  },
  headerIconGradient: {
    width: 52,
    height: 52,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.8)",
    marginTop: 3,
    fontWeight: "500",
  },
  headerEditButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
  },

  scrollContent: {
    paddingBottom: 120,
  },

  // Profile Card
  profileCard: {
    margin: 20,
    padding: 24,
    borderRadius: 24,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    alignItems: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.04)",
  },
  profileCardDark: {
    backgroundColor: "#1F2937",
    borderColor: "rgba(59, 130, 246, 0.15)",
  },
  avatarContainer: {
    position: "relative",
    marginBottom: 18,
  },
  avatarBorder: {
    width: 110,
    height: 110,
    borderRadius: 55,
    padding: 4,
  },
  avatarInner: {
    flex: 1,
    borderRadius: 51,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  avatar: {
    width: "100%",
    height: "100%",
  },
  loadingOverlay: {
    position: "absolute",
    top: 4,
    left: 4,
    right: 4,
    bottom: 4,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    borderRadius: 51,
    justifyContent: "center",
    alignItems: "center",
  },
  editIcon: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: "#fff",
  },
  profileInfo: {
    alignItems: "center",
  },
  fullName: {
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 6,
    letterSpacing: -0.5,
  },
  nameInput: {
    fontSize: 24,
    fontWeight: "700",
    borderBottomWidth: 2,
    borderColor: "#3B82F6",
    textAlign: "center",
    paddingVertical: 8,
    minWidth: 200,
    marginBottom: 6,
  },
  email: {
    fontSize: 15,
    marginBottom: 16,
    fontWeight: "500",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#fff",
  },
  statusText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.3,
  },

  // Section Styles
  section: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 20,
    borderRadius: 20,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.04)",
  },
  sectionDark: {
    backgroundColor: "#1F2937",
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  sectionIconGradient: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  sectionSubtitle: {
    fontSize: 13,
    fontWeight: "400",
    marginTop: 2,
  },

  // Input Styles
  inputContainer: {
    marginBottom: 16,
  },
  inputLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    gap: 10,
  },
  inputIconGradient: {
    width: 26,
    height: 26,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
  },
  inputRowDark: {
    backgroundColor: "#111827",
    borderColor: "#374151",
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 14,
    fontWeight: "500",
  },
  inputError: {
    borderColor: "#EF4444",
    borderWidth: 1.5,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    gap: 6,
  },
  errorText: {
    fontSize: 12,
    color: "#EF4444",
    fontWeight: "500",
  },

  // Settings Styles
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F9FAFB",
    padding: 16,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  settingRowDark: {
    backgroundColor: "#111827",
    borderColor: "#374151",
  },
  settingLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  settingIconGradient: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  settingTextContainer: {
    marginLeft: 14,
    flex: 1,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: 12,
    fontWeight: "400",
  },

  // Sign Out
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
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#FECACA",
    overflow: "hidden",
    gap: 8,
  },
  signOutButtonDark: {
    backgroundColor: "#1F2937",
    borderColor: "rgba(239, 68, 68, 0.3)",
  },
  signOutText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#EF4444",
  },

  // Action Buttons
  actionButtons: {
    flexDirection: "row",
    paddingHorizontal: 20,
    marginBottom: 40,
    gap: 12,
  },
  actionButtonsDark: {
    backgroundColor: "#1F2937",
    borderTopColor: "#374151",
  },
  cancelButton: {
    flex: 1,
    backgroundColor: "#F3F4F6",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
  },
  cancelButtonDark: {
    backgroundColor: "#374151",
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  saveButtonWrapper: {
    flex: 1,
    borderRadius: 14,
    overflow: "hidden",
  },
  saveButton: {
    paddingVertical: 16,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },

  // Empty State
  emptyStateCard: {
    backgroundColor: "#F9FAFB",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    marginBottom: 20,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    borderStyle: "dashed",
  },
  emptyStateCardDark: {
    backgroundColor: "#111827",
    borderColor: "#374151",
  },
  emptyStateIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 4,
  },
  emptyStateDescription: {
    fontSize: 14,
    textAlign: "center",
  },

  // Alert Modal
  alertOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  alertContainer: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
  },
  alertContainerDark: {
    backgroundColor: "#1F2937",
  },
  alertHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  alertIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  alertTitle: {
    fontSize: 20,
    fontWeight: "700",
    flex: 1,
  },
  alertMessage: {
    fontSize: 15,
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
    borderRadius: 14,
    minWidth: 80,
    alignItems: "center",
  },
  alertCancelButton: {
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  alertCancelButtonDark: {
    backgroundColor: "#374151",
    borderColor: "#4B5563",
  },
  alertCancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  alertConfirmButtonWrapper: {
    borderRadius: 14,
    overflow: "hidden",
  },
  alertConfirmButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  alertConfirmButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});

export default ProfileScreen;
