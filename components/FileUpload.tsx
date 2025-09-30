import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import React, { useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface FileUploadProps {
  label: string;
  placeholder?: string;
  onFileSelected: (file: DocumentPicker.DocumentPickerResult) => void;
  error?: string;
  acceptedTypes?: string[];
  maxSize?: number; // in MB
}

export default function FileUpload({
  label,
  placeholder = "Tap to select a file",
  onFileSelected,
  error,
  acceptedTypes = [".pdf", ".doc", ".docx"],
  maxSize = 10, // 10MB default
}: FileUploadProps) {
  const [selectedFile, setSelectedFile] =
    useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileSelection = async () => {
    try {
      setIsUploading(true);

      const result = await DocumentPicker.getDocumentAsync({
        type: acceptedTypes,
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];

        // Check file size
        if (file.size && file.size > maxSize * 1024 * 1024) {
          Alert.alert(
            "File Too Large",
            `Please select a file smaller than ${maxSize}MB. Your file is ${(
              file.size /
              (1024 * 1024)
            ).toFixed(1)}MB.`
          );
          return;
        }

        setSelectedFile(file);
        onFileSelected(result);
      }
    } catch (error) {
      console.error("Error picking document:", error);
      Alert.alert("Error", "Failed to select file. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>

      <TouchableOpacity
        style={[
          styles.uploadButton,
          error && styles.uploadButtonError,
          selectedFile && styles.uploadButtonSuccess,
        ]}
        onPress={handleFileSelection}
        disabled={isUploading}
      >
        <View style={styles.uploadContent}>
          <Ionicons
            name={selectedFile ? "checkmark-circle" : "cloud-upload"}
            size={24}
            color={selectedFile ? "#34C759" : error ? "#FF3B30" : "#007AFF"}
          />
          <View style={styles.uploadTextContainer}>
            <Text
              style={[
                styles.uploadText,
                selectedFile && styles.uploadTextSuccess,
                error && styles.uploadTextError,
              ]}
            >
              {selectedFile ? selectedFile.name : placeholder}
            </Text>
            {selectedFile && selectedFile.size && (
              <Text style={styles.fileSize}>
                {formatFileSize(selectedFile.size)}
              </Text>
            )}
          </View>
        </View>

        {!selectedFile && (
          <Ionicons name="chevron-forward" size={20} color="#A0A3BD" />
        )}
      </TouchableOpacity>

      {error && <Text style={styles.errorText}>{error}</Text>}

      {selectedFile && (
        <View style={styles.fileInfo}>
          <Text style={styles.fileInfoText}>
            ✓ Resume uploaded successfully
          </Text>
          <TouchableOpacity
            style={styles.removeButton}
            onPress={() => {
              setSelectedFile(null);
              onFileSelected({ canceled: true, assets: null });
            }}
          >
            <Text style={styles.removeButtonText}>Remove</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 15,
  },
  label: {
    fontSize: 16,
    color: "#333",
    marginBottom: 8,
    fontWeight: "500",
  },
  uploadButton: {
    backgroundColor: "#fff",
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#E1E5E9",
    borderStyle: "dashed",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 60,
  },
  uploadButtonError: {
    borderColor: "#FF3B30",
  },
  uploadButtonSuccess: {
    borderColor: "#34C759",
    backgroundColor: "#F0FFF4",
  },
  uploadContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  uploadTextContainer: {
    marginLeft: 12,
    flex: 1,
  },
  uploadText: {
    fontSize: 16,
    color: "#333",
    fontWeight: "500",
  },
  uploadTextSuccess: {
    color: "#34C759",
  },
  uploadTextError: {
    color: "#FF3B30",
  },
  fileSize: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  errorText: {
    color: "#FF3B30",
    marginTop: 5,
    fontSize: 12,
  },
  fileInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#F0FFF4",
    borderRadius: 8,
  },
  fileInfoText: {
    fontSize: 14,
    color: "#34C759",
    fontWeight: "500",
  },
  removeButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: "#FF3B30",
    borderRadius: 6,
  },
  removeButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
});
