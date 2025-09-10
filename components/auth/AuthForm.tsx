import { Ionicons } from "@expo/vector-icons"; // Import Ionicons
import React from "react";
import {
  ActivityIndicator,
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
    keyboardType?: "default" | "email-address" | "number-pad";
    autoCapitalize?: "none" | "words" | "sentences";
    error?: string;
    note?: string;
    isPasswordField?: boolean; // Add this new property to identify password fields
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
}: AuthFormProps) {
  const [showErrorModal, setShowErrorModal] = React.useState(false);
  const [showSuccessModal, setShowSuccessModal] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false); // New state for password visibility

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
    <View style={styles.container}>
      <Text style={[styles.title, { color: textColor }]}>{title}</Text>
      <Text style={[styles.subtitle, { color: textColor }]}>{subtitle}</Text>

      {fields.map((field) => (
        <View key={field.name} style={styles.inputContainer}>
          <Text style={[styles.label, { color: textColor }]}>
            {field.label}
          </Text>
          {field.isPasswordField ? ( // Conditionally render based on isPasswordField
            <View style={styles.passwordInputContainer}>
              <TextInput
                style={[
                  styles.input,
                  field.error && styles.inputError,
                  styles.passwordInput, // Apply passwordInput style for password fields
                ]}
                placeholder={field.placeholder}
                placeholderTextColor="#A0A3BD"
                value={field.value}
                onChangeText={field.onChangeText}
                secureTextEntry={!showPassword} // Use !showPassword directly
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
            <TextInput // Render normal TextInput for non-password fields
              style={[styles.input, field.error && styles.inputError]}
              placeholder={field.placeholder}
              placeholderTextColor="#A0A3BD"
              value={field.value}
              onChangeText={field.onChangeText}
              secureTextEntry={field.secureTextEntry} // Use original secureTextEntry for non-password fields
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 30,
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
});
