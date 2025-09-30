import { Ionicons } from "@expo/vector-icons"; // Import Ionicons
import React from "react";
import {
  ActivityIndicator,
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
  const [showErrorModal, setShowErrorModal] = React.useState(false);
  const [showSuccessModal, setShowSuccessModal] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [showSelectModal, setShowSelectModal] = React.useState(false);
  const [currentSelectField, setCurrentSelectField] = React.useState<any>(null);

  React.useEffect(() => {
    if (message) {
      if (message.type === "error") {
        setShowErrorModal(true);
      } else if (message.type === "success") {
        setShowSuccessModal(true);
      }
    }
  }, [message]);

  return (
    <ScrollView
      style={styles.scrollContainer}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.title, { color: textColor }]}>{title}</Text>
      <Text style={[styles.subtitle, { color: textColor }]}>{subtitle}</Text>

      {customContent && (
        <View style={styles.customContentContainer}>{customContent}</View>
      )}

      {fields.map((field) => (
        <View key={field.name} style={styles.inputContainer}>
          <Text style={[styles.label, { color: textColor }]}>
            {field.label}
          </Text>
          {field.isSelectField ? (
            <TouchableOpacity
              style={[
                styles.input,
                styles.selectInput,
                field.error && styles.inputError,
              ]}
              onPress={() => {
                setCurrentSelectField(field);
                setShowSelectModal(true);
              }}
            >
              <Text
                style={[
                  styles.selectText,
                  !field.value && styles.placeholderText,
                ]}
              >
                {field.value
                  ? field.options?.find((opt) => opt.value === field.value)
                      ?.label || field.value
                  : field.placeholder}
              </Text>
              <Ionicons name="chevron-down" size={20} color="#A0A3BD" />
            </TouchableOpacity>
          ) : field.isTextArea ? (
            <TextInput
              style={[
                styles.input,
                styles.textAreaInput,
                field.error && styles.inputError,
              ]}
              placeholder={field.placeholder}
              placeholderTextColor="#A0A3BD"
              value={field.value}
              onChangeText={field.onChangeText}
              keyboardType={field.keyboardType}
              autoCapitalize={field.autoCapitalize}
              multiline={true}
              numberOfLines={4}
              textAlignVertical="top"
            />
          ) : field.isPasswordField ? (
            <View style={styles.passwordInputContainer}>
              <TextInput
                style={[
                  styles.input,
                  field.error && styles.inputError,
                  styles.passwordInput,
                ]}
                placeholder={field.placeholder}
                placeholderTextColor="#A0A3BD"
                value={field.value}
                onChangeText={field.onChangeText}
                secureTextEntry={!showPassword}
                keyboardType={field.keyboardType}
                autoCapitalize={field.autoCapitalize}
              />
              <TouchableOpacity
                style={styles.passwordToggle}
                onPress={() => setShowPassword(!showPassword)}
              >
                <Ionicons
                  name={showPassword ? "eye-off" : "eye"}
                  size={24}
                  color="#A0A3BD"
                />
              </TouchableOpacity>
            </View>
          ) : (
            <TextInput
              style={[styles.input, field.error && styles.inputError]}
              placeholder={field.placeholder}
              placeholderTextColor="#A0A3BD"
              value={field.value}
              onChangeText={field.onChangeText}
              secureTextEntry={field.secureTextEntry}
              keyboardType={field.keyboardType}
              autoCapitalize={field.autoCapitalize}
            />
          )}
          {field.note && <Text style={styles.note}>{field.note}</Text>}
          {field.error && <Text style={styles.errorText}>{field.error}</Text>}
        </View>
      ))}

      <TouchableOpacity
        style={[styles.button, isLoading && styles.buttonDisabled]}
        onPress={onButtonPress}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{buttonText}</Text>
        )}
      </TouchableOpacity>

      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: textColor }]}>
          {footerText}{" "}
        </Text>
        <TouchableOpacity onPress={onFooterLinkPress} disabled={isLoading}>
          <Text style={styles.link}>{footerLinkText}</Text>
        </TouchableOpacity>
      </View>

      {additionalFooterText &&
        additionalFooterLinkText &&
        onAdditionalFooterLinkPress && (
          <View style={styles.additionalFooter}>
            <Text style={[styles.footerText, { color: textColor }]}>
              {additionalFooterText}{" "}
            </Text>
            <TouchableOpacity
              onPress={onAdditionalFooterLinkPress}
              disabled={isLoading}
            >
              <Text style={styles.link}>{additionalFooterLinkText}</Text>
            </TouchableOpacity>
          </View>
        )}

      {/* Error Modal */}
      <ErrorModal
        visible={showErrorModal}
        title="Error"
        message={message?.text || "An error occurred"}
        onClose={() => setShowErrorModal(false)}
        icon="close-circle"
        iconColor="#FF3B30"
      />

      {/* Success Modal */}
      <SuccessModal
        visible={showSuccessModal}
        title="Success"
        message={message?.text || "Operation completed successfully"}
        onClose={() => setShowSuccessModal(false)}
        icon="checkmark-circle"
        iconColor="#34C759"
      />

      {/* Select Options Modal */}
      <Modal
        visible={showSelectModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSelectModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              Select {currentSelectField?.label}
            </Text>
            <ScrollView style={styles.optionsContainer}>
              {currentSelectField?.options?.map((option: any) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.optionItem,
                    currentSelectField?.value === option.value &&
                      styles.selectedOption,
                  ]}
                  onPress={() => {
                    currentSelectField?.onChangeText(option.value);
                    setShowSelectModal(false);
                  }}
                >
                  <Text
                    style={[
                      styles.optionText,
                      currentSelectField?.value === option.value &&
                        styles.selectedOptionText,
                    ]}
                  >
                    {option.label}
                  </Text>
                  {currentSelectField?.value === option.value && (
                    <Ionicons name="checkmark" size={20} color="#007AFF" />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setShowSelectModal(false)}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContainer: {
    flex: 1,
  },
  container: {
    paddingHorizontal: 30,
    paddingBottom: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 10,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 30,
    textAlign: "center",
  },
  inputContainer: {
    marginBottom: 15,
  },
  label: {
    fontSize: 16,
    color: "#333",
    marginBottom: 8,
    fontWeight: "500",
  },
  input: {
    backgroundColor: "#fff",
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderRadius: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#E1E5E9",
    color: "#333",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
    width: "100%", // Added to make all inputs take full width
  },
  inputError: {
    borderColor: "#FF3B30",
    borderWidth: 2,
  },
  note: {
    color: "#8E8E93",
    marginTop: 5,
    fontSize: 12,
    fontStyle: "italic",
  },
  errorText: {
    color: "#FF3B30",
    marginTop: 5,
    fontSize: 12,
  },
  button: {
    backgroundColor: "#007AFF",
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 10,
    height: 58,
    justifyContent: "center",
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  footer: {
    marginTop: 30,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    flexWrap: "wrap",
  },
  additionalFooter: {
    marginTop: 15,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    flexWrap: "wrap",
  },
  footerText: {
    fontSize: 16,
    color: "#666",
  },
  link: {
    fontSize: 16,
    color: "#007AFF",
    fontWeight: "600",
  },
  passwordInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    position: "relative", // Needed for absolute positioning of the toggle
  },
  passwordInput: {
    flex: 1, // Allow the input to take up available space
    paddingRight: 60, // Make space for the toggle
  },
  passwordToggle: {
    position: "absolute",
    right: 15,
    padding: 10,
  },
  selectInput: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  selectText: {
    fontSize: 16,
    color: "#333",
    flex: 1,
  },
  placeholderText: {
    color: "#A0A3BD",
  },
  textAreaInput: {
    height: 100,
    paddingTop: 15,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    width: "80%",
    maxHeight: "70%",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 15,
    textAlign: "center",
    color: "#333",
  },
  optionsContainer: {
    maxHeight: 300,
  },
  optionItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 15,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E1E5E9",
  },
  selectedOption: {
    backgroundColor: "#F0F8FF",
  },
  optionText: {
    fontSize: 16,
    color: "#333",
  },
  selectedOptionText: {
    color: "#007AFF",
    fontWeight: "600",
  },
  cancelButton: {
    marginTop: 15,
    paddingVertical: 12,
    backgroundColor: "#6C757D",
    borderRadius: 8,
    alignItems: "center",
  },
  cancelButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  customContentContainer: {
    marginBottom: 15,
  },
});
