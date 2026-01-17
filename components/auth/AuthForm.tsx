import { useAppTheme } from "@/contexts/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import ErrorModal from "./ErrorModal";
import SuccessModal from "./SuccessModal";

interface AuthFormProps {
  title: string;
  subtitle: string;
  fields: {
    name: string;
    label: string;
    placeholder: string;
    value: string;
    onChangeText: (text: string) => void;
    secureTextEntry?: boolean;
    keyboardType?: "default" | "email-address" | "number-pad" | "phone-pad";
    autoCapitalize?: "none" | "words" | "sentences" | "characters";
    error?: string;
    note?: string;
    isPasswordField?: boolean;
    isSelectField?: boolean;
    isTextArea?: boolean;
    options?: { label: string; value: string }[];
    icon?: keyof typeof Ionicons.glyphMap;
  }[];
  buttonText: string;
  onButtonPress: () => void;
  isLoading: boolean;
  message?: {
    type: "success" | "error";
    text: string;
  } | null;
  footerText: string;
  footerLinkText: string;
  onFooterLinkPress: () => void;
  textColor: string;
  additionalFooterText?: string;
  additionalFooterLinkText?: string;
  onAdditionalFooterLinkPress?: () => void;
  customContent?: React.ReactNode;
}

export default function AuthForm({
  title,
  subtitle,
  fields,
  buttonText,
  onButtonPress,
  isLoading,
  message,
  footerText,
  footerLinkText,
  onFooterLinkPress,
  textColor,
  additionalFooterText,
  additionalFooterLinkText,
  onAdditionalFooterLinkPress,
  customContent,
}: AuthFormProps) {
  const { theme } = useAppTheme();
  const isDark = theme === "dark";

  const [showErrorModal, setShowErrorModal] = React.useState(false);
  const [showSuccessModal, setShowSuccessModal] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [showSelectModal, setShowSelectModal] = React.useState(false);
  const [currentSelectField, setCurrentSelectField] = React.useState<any>(null);
  const [focusedField, setFocusedField] = React.useState<string | null>(null);


  // Animations
  const buttonScale = useRef(new Animated.Value(1)).current;
  const formSlide = useRef(new Animated.Value(30)).current;
  const formOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(formSlide, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(formOpacity, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  React.useEffect(() => {
    if (message) {
      if (message.type === "error") {
        setShowErrorModal(true);
      } else if (message.type === "success") {
        setShowSuccessModal(true);
      }
    }
  }, [message]);

  const handlePressIn = () => {
    Animated.spring(buttonScale, {
      toValue: 0.96,
      friction: 5,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(buttonScale, {
      toValue: 1,
      friction: 5,
      useNativeDriver: true,
    }).start();
  };

  const getFieldIcon = (fieldName: string): keyof typeof Ionicons.glyphMap => {
    switch (fieldName.toLowerCase()) {
      case "email":
        return "mail-outline";
      case "password":
        return "lock-closed-outline";
      case "name":
      case "fullname":
        return "person-outline";
      case "phone":
        return "call-outline";
      default:
        return "document-text-outline";
    }
  };

  return (
    <ScrollView
      style={styles.scrollContainer}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      <Animated.View
        style={[
          styles.formContainer,
          {
            transform: [{ translateY: formSlide }],
            opacity: formOpacity,
          },
        ]}
      >
        {/* Glass Card Container */}
        <View style={[styles.glassCard, isDark && styles.glassCardDark]}>
          {/* Header Section */}
          <View style={styles.headerSection}>
            <Text style={[styles.title, isDark && styles.titleDark]}>{title}</Text>
            <Text style={[styles.subtitle, isDark && styles.subtitleDark]}>{subtitle}</Text>
          </View>

          {/* Form Fields */}
          <View style={styles.fieldsContainer}>
            {fields.map((field, index) => (
              <Animated.View
                key={field.name}
                style={[
                  styles.inputContainer,
                  {
                    transform: [{
                      translateY: formSlide.interpolate({
                        inputRange: [0, 30],
                        outputRange: [0, 30 + index * 10],
                      })
                    }]
                  }
                ]}
              >
                <Text style={[styles.label, isDark && styles.labelDark]}>
                  {field.label}
                </Text>

                {field.isSelectField ? (
                  <TouchableOpacity
                    style={[
                      styles.inputWrapper,
                      isDark && styles.inputWrapperDark,
                      focusedField === field.name && (isDark ? styles.inputWrapperFocusedDark : styles.inputWrapperFocused),
                      field.error && styles.inputWrapperError,
                    ]}
                    onPress={() => {
                      setCurrentSelectField(field);
                      setShowSelectModal(true);
                    }}
                  >
                    <View style={styles.iconContainer}>
                      <Ionicons
                        name={field.icon || getFieldIcon(field.name)}
                        size={20}
                        color={isDark ? "#22D3EE" : "#0891B2"}
                      />
                    </View>
                    <Text
                      style={[
                        styles.selectText,
                        isDark && styles.selectTextDark,
                        !field.value && styles.placeholderText,
                      ]}
                    >
                      {field.value
                        ? field.options?.find((opt) => opt.value === field.value)?.label || field.value
                        : field.placeholder}
                    </Text>
                    <Ionicons name="chevron-down" size={20} color={isDark ? "#6B7280" : "#9CA3AF"} />
                  </TouchableOpacity>
                ) : field.isTextArea ? (
                  <View
                    style={[
                      styles.inputWrapper,
                      styles.textAreaWrapper,
                      isDark && styles.inputWrapperDark,
                      focusedField === field.name && (isDark ? styles.inputWrapperFocusedDark : styles.inputWrapperFocused),
                      field.error && styles.inputWrapperError,
                    ]}
                  >
                    <TextInput
                      style={[styles.textAreaInput, isDark && styles.inputDark]}
                      placeholder={field.placeholder}
                      placeholderTextColor={isDark ? "#6B7280" : "#9CA3AF"}
                      value={field.value}
                      onChangeText={field.onChangeText}
                      keyboardType={field.keyboardType}
                      autoCapitalize={field.autoCapitalize}
                      multiline={true}
                      numberOfLines={4}
                      textAlignVertical="top"
                      onFocus={() => setFocusedField(field.name)}
                      onBlur={() => setFocusedField(null)}
                    />
                  </View>
                ) : field.isPasswordField ? (
                  <View
                    style={[
                      styles.inputWrapper,
                      isDark && styles.inputWrapperDark,
                      focusedField === field.name && (isDark ? styles.inputWrapperFocusedDark : styles.inputWrapperFocused),
                      field.error && styles.inputWrapperError,
                    ]}
                  >
                    <View style={styles.iconContainer}>
                      <Ionicons
                        name="lock-closed-outline"
                        size={20}
                        color={isDark ? "#22D3EE" : "#0891B2"}
                      />
                    </View>
                    <TextInput
                      style={[styles.input, styles.passwordInput, isDark && styles.inputDark]}
                      placeholder={field.placeholder}
                      placeholderTextColor={isDark ? "#6B7280" : "#9CA3AF"}
                      value={field.value}
                      onChangeText={field.onChangeText}
                      secureTextEntry={!showPassword}
                      keyboardType={field.keyboardType}
                      autoCapitalize={field.autoCapitalize}
                      onFocus={() => setFocusedField(field.name)}
                      onBlur={() => setFocusedField(null)}
                    />
                    <TouchableOpacity
                      style={styles.passwordToggle}
                      onPress={() => setShowPassword(!showPassword)}
                    >
                      <Ionicons
                        name={showPassword ? "eye-off-outline" : "eye-outline"}
                        size={22}
                        color={isDark ? "#6B7280" : "#9CA3AF"}
                      />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View
                    style={[
                      styles.inputWrapper,
                      isDark && styles.inputWrapperDark,
                      focusedField === field.name && (isDark ? styles.inputWrapperFocusedDark : styles.inputWrapperFocused),
                      field.error && styles.inputWrapperError,
                    ]}
                  >
                    <View style={styles.iconContainer}>
                      <Ionicons
                        name={field.icon || getFieldIcon(field.name)}
                        size={20}
                        color={isDark ? "#22D3EE" : "#0891B2"}
                      />
                    </View>
                    <TextInput
                      style={[styles.input, isDark && styles.inputDark]}
                      placeholder={field.placeholder}
                      placeholderTextColor={isDark ? "#6B7280" : "#9CA3AF"}
                      value={field.value}
                      onChangeText={field.onChangeText}
                      secureTextEntry={field.secureTextEntry}
                      keyboardType={field.keyboardType}
                      autoCapitalize={field.autoCapitalize}
                      onFocus={() => setFocusedField(field.name)}
                      onBlur={() => setFocusedField(null)}
                    />
                  </View>
                )}

                {field.note && (
                  <View style={styles.noteContainer}>
                    <Ionicons name="information-circle-outline" size={14} color="#0891B2" />
                    <Text style={styles.note}>{field.note}</Text>
                  </View>
                )}
                {field.error && (
                  <View style={styles.errorContainer}>
                    <Ionicons name="alert-circle" size={14} color="#EF4444" />
                    <Text style={styles.errorText}>{field.error}</Text>
                  </View>
                )}
              </Animated.View>
            ))}
          </View>

          {customContent && (
            <View style={styles.customContentContainer}>{customContent}</View>
          )}

          {/* Premium Submit Button - Cyan Theme */}
          <Animated.View style={{ transform: [{ scale: buttonScale }] }}>
            <TouchableOpacity
              style={styles.buttonWrapper}
              onPress={onButtonPress}
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              disabled={isLoading}
              activeOpacity={0.9}
            >
              <LinearGradient
                colors={isLoading
                  ? ["#9CA3AF", "#6B7280"]
                  : ["#06B6D4", "#0891B2", "#0E7490"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.button}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Text style={styles.buttonText}>{buttonText}</Text>
                    <View style={styles.buttonIconContainer}>
                      <Ionicons name="arrow-forward" size={18} color="#fff" />
                    </View>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>
        </View>

        {/* Footer Links */}
        <View style={styles.footer}>
          <Text style={[styles.footerText, isDark && styles.footerTextDark]}>
            {footerText}{" "}
          </Text>
          <TouchableOpacity onPress={onFooterLinkPress} disabled={isLoading}>
            <Text style={styles.link}>{footerLinkText}</Text>
          </TouchableOpacity>
        </View>

        {additionalFooterText && additionalFooterLinkText && onAdditionalFooterLinkPress && (
          <View style={styles.additionalFooter}>
            <View style={styles.dividerContainer}>
              <View style={[styles.divider, isDark && styles.dividerDark]} />
              <Text style={[styles.dividerText, isDark && styles.dividerTextDark]}>or</Text>
              <View style={[styles.divider, isDark && styles.dividerDark]} />
            </View>
            <TouchableOpacity
              style={[styles.secondaryButton, isDark && styles.secondaryButtonDark]}
              onPress={onAdditionalFooterLinkPress}
              disabled={isLoading}
            >
              <Ionicons name="briefcase-outline" size={18} color={isDark ? "#22D3EE" : "#0891B2"} />
              <Text style={[styles.secondaryButtonText, isDark && styles.secondaryButtonTextDark]}>
                {additionalFooterLinkText}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>

      {/* Error Modal */}
      <ErrorModal
        visible={showErrorModal}
        title="Error"
        message={message?.text || "An error occurred"}
        onClose={() => setShowErrorModal(false)}
        icon="close-circle"
        iconColor="#EF4444"
      />

      {/* Success Modal */}
      <SuccessModal
        visible={showSuccessModal}
        title="Success"
        message={message?.text || "Operation completed successfully"}
        onClose={() => setShowSuccessModal(false)}
        icon="checkmark-circle"
        iconColor="#10B981"
      />

      {/* Select Options Modal */}
      <Modal
        visible={showSelectModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSelectModal(false)}
      >
        <BlurView intensity={isDark ? 80 : 40} style={styles.modalOverlay}>
          <View style={[styles.modalContent, isDark && styles.modalContentDark]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, isDark && styles.modalTitleDark]}>
                Select {currentSelectField?.label}
              </Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setShowSelectModal(false)}
              >
                <Ionicons name="close" size={24} color={isDark ? "#9CA3AF" : "#6B7280"} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.optionsContainer} showsVerticalScrollIndicator={false}>
              {currentSelectField?.options?.map((option: any) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.optionItem,
                    isDark && styles.optionItemDark,
                    currentSelectField?.value === option.value && styles.selectedOption,
                    currentSelectField?.value === option.value && isDark && styles.selectedOptionDark,
                  ]}
                  onPress={() => {
                    currentSelectField?.onChangeText(option.value);
                    setShowSelectModal(false);
                  }}
                >
                  <Text
                    style={[
                      styles.optionText,
                      isDark && styles.optionTextDark,
                      currentSelectField?.value === option.value && styles.selectedOptionText,
                    ]}
                  >
                    {option.label}
                  </Text>
                  {currentSelectField?.value === option.value && (
                    <Ionicons name="checkmark-circle" size={22} color="#0891B2" />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </BlurView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContainer: {
    flex: 1,
  },
  container: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  formContainer: {
    width: "100%",
  },
  glassCard: {
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    borderRadius: 28,
    padding: 28,
    shadowColor: "#06B6D4",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
    borderWidth: 1,
    borderColor: "rgba(6, 182, 212, 0.1)",
  },
  glassCardDark: {
    backgroundColor: "rgba(30, 41, 59, 0.95)",
    borderColor: "rgba(6, 182, 212, 0.2)",
  },
  headerSection: {
    alignItems: "center",
    marginBottom: 28,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#1F2937",
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  titleDark: {
    color: "#F9FAFB",
  },
  subtitle: {
    fontSize: 15,
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 22,
  },
  subtitleDark: {
    color: "#9CA3AF",
  },
  fieldsContainer: {
    marginBottom: 8,
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    color: "#374151",
    marginBottom: 8,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  labelDark: {
    color: "#D1D5DB",
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    paddingHorizontal: 16,
    minHeight: 54,
  },
  inputWrapperDark: {
    backgroundColor: "#1F2937",
    borderColor: "#374151",
  },
  inputWrapperFocused: {
    borderColor: "#06B6D4",
    borderWidth: 2,
    backgroundColor: "#fff",
  },
  inputWrapperFocusedDark: {
    borderColor: "#06B6D4",
    borderWidth: 2,
    backgroundColor: "#111827",
  },
  inputWrapperError: {
    borderColor: "#EF4444",
    borderWidth: 2,
  },
  textAreaWrapper: {
    alignItems: "flex-start",
    minHeight: 120,
    paddingVertical: 14,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(6, 182, 212, 0.1)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: "#1F2937",
    paddingVertical: 0,
  },
  inputDark: {
    color: "#F9FAFB",
  },
  passwordInput: {
    paddingRight: 10,
  },
  textAreaInput: {
    flex: 1,
    fontSize: 16,
    color: "#1F2937",
    textAlignVertical: "top",
    paddingTop: 0,
    minHeight: 80,
  },
  passwordToggle: {
    padding: 4,
  },
  selectText: {
    flex: 1,
    fontSize: 16,
    color: "#1F2937",
  },
  selectTextDark: {
    color: "#F9FAFB",
  },
  placeholderText: {
    color: "#9CA3AF",
  },
  noteContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    gap: 6,
  },
  note: {
    color: "#0891B2",
    fontSize: 12,
    flex: 1,
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    gap: 6,
  },
  errorText: {
    color: "#EF4444",
    fontSize: 12,
    fontWeight: "500",
    flex: 1,
  },
  customContentContainer: {
    marginBottom: 20,
  },
  buttonWrapper: {
    marginTop: 8,
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: "#06B6D4",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 17,
    gap: 10,
  },
  buttonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  buttonIconContainer: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  footer: {
    marginTop: 28,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  footerText: {
    fontSize: 15,
    color: "#6B7280",
  },
  footerTextDark: {
    color: "#9CA3AF",
  },
  link: {
    fontSize: 15,
    color: "#0891B2",
    fontWeight: "700",
  },
  additionalFooter: {
    marginTop: 24,
    alignItems: "center",
  },
  dividerContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    width: "100%",
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: "#E5E7EB",
  },
  dividerDark: {
    backgroundColor: "#374151",
  },
  dividerText: {
    marginHorizontal: 16,
    fontSize: 13,
    color: "#9CA3AF",
    fontWeight: "500",
  },
  dividerTextDark: {
    color: "#6B7280",
  },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(6, 182, 212, 0.08)",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(6, 182, 212, 0.2)",
  },
  secondaryButtonDark: {
    backgroundColor: "rgba(6, 182, 212, 0.15)",
    borderColor: "rgba(6, 182, 212, 0.3)",
  },
  secondaryButtonText: {
    fontSize: 14,
    color: "#0891B2",
    fontWeight: "600",
  },
  secondaryButtonTextDark: {
    color: "#22D3EE",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 24,
    width: "100%",
    maxHeight: "70%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.25,
    shadowRadius: 30,
    elevation: 20,
  },
  modalContentDark: {
    backgroundColor: "#1F2937",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1F2937",
  },
  modalTitleDark: {
    color: "#F9FAFB",
  },
  modalCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#F3F4F6",
    justifyContent: "center",
    alignItems: "center",
  },
  optionsContainer: {
    maxHeight: 300,
  },
  optionItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: "#F9FAFB",
  },
  optionItemDark: {
    backgroundColor: "#374151",
  },
  selectedOption: {
    backgroundColor: "rgba(6, 182, 212, 0.1)",
    borderWidth: 1,
    borderColor: "#06B6D4",
  },
  selectedOptionDark: {
    backgroundColor: "rgba(6, 182, 212, 0.2)",
  },
  optionText: {
    fontSize: 16,
    color: "#374151",
    fontWeight: "500",
  },
  optionTextDark: {
    color: "#E5E7EB",
  },
  selectedOptionText: {
    color: "#0891B2",
    fontWeight: "600",
  },
});
