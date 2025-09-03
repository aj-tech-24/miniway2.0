import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Animated from "react-native-reanimated";
const { height: SCREEN_HEIGHT } = Dimensions.get("window");

type Minibus = { id: string; plateNumber: string };
type BottomSheetProps = {
  animatedStyle: any;
  dropoffLocation: string;
  onSetDestination: () => void;
  onFindRide: () => void;
  minibuses: Minibus[];
  textColor: string;
  backgroundColor: string;
};

export function BottomSheet({
  animatedStyle,
  dropoffLocation,
  onSetDestination,
  onFindRide,
  minibuses,
  textColor,
  backgroundColor,
}: BottomSheetProps) {
  return (
    <Animated.View
      style={[styles.bottomSheet, { backgroundColor }, animatedStyle]}
    >
      <View style={styles.handleBar} />
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={[styles.bottomSheetTitle, { color: textColor }]}>
          Where to?
        </Text>
        <View
          style={[
            styles.inputContainer,
            { borderColor: "#444", backgroundColor, borderWidth: 1 },
          ]}
        >
          <Ionicons
            name="flag-outline"
            size={24}
            style={[styles.inputIcon, { color: "#007AFF" }]}
          />
          <TouchableOpacity
            style={styles.inputTouchable}
            onPress={onSetDestination}
          >
            <Text
              style={[
                styles.inputText,
                { color: dropoffLocation ? textColor : "#888" },
              ]}
            >
              {dropoffLocation || "Set destination on map"}
            </Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={styles.findRideButton}
          onPress={onFindRide} // 👈 Add the onPress handler
        >
          <Text style={styles.findRideButtonText}>Find a Ride</Text>
        </TouchableOpacity>
        <View style={styles.nearbyContainer}>
          <Text style={[styles.nearbyTitle, { color: textColor }]}>
            Nearby Minibuses
          </Text>
          <Text style={styles.noBusesText}>No active minibuses nearby....</Text>
        </View>
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topContainer: {
    position: "absolute",
    top: 60,
    left: 10,
    right: 10,
    zIndex: 1,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    paddingHorizontal: 15,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 16,
  },
  clearIcon: {
    padding: 5,
    marginRight: 5,
  },
  activityIndicator: {
    marginLeft: 5,
  },
  noResultsText: {
    padding: 15,
    textAlign: "center",
    fontSize: 16,
    fontStyle: "italic",
  },
  predictionsContainer: {
    borderRadius: 8,
    marginTop: 8,
    maxHeight: 250, // Limit the height of the list
  },
  predictionItem: {
    padding: 15,
  },
  separator: {
    height: 1,
    width: "95%",
    alignSelf: "center",
  },
  markerContainer: {
    backgroundColor: "#007AFF",
    padding: 8,
    borderRadius: 20,
    borderColor: "#fff",
    borderWidth: 2,
  },
  userMarker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0, 122, 255, 0.3)",
    borderColor: "#007AFF",
    borderWidth: 3,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 10,
    color: "#fff",
    fontSize: 16,
  },
  trackButton: {
    position: "absolute",
    bottom: SCREEN_HEIGHT * 0.25, // Position above the collapsed bottom sheet
    right: 20,
    backgroundColor: "#007AFF",
    padding: 12,
    borderRadius: 30,
    elevation: 5,
  },
  bottomSheet: {
    position: "absolute",
    width: "100%",
    height: SCREEN_HEIGHT,
    top: SCREEN_HEIGHT, // Start off-screen
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    elevation: 10,
  },
  handleBar: {
    width: 40,
    height: 5,
    backgroundColor: "#ccc",
    borderRadius: 3,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 15,
  },
  bottomSheetTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 20,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f0f2f5",
    borderRadius: 10,
    paddingHorizontal: 15,
    marginBottom: 15,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    height: 50,
    fontSize: 16,
  },
  instructionContainer: {
    position: "absolute",
    top: 60, // Adjust as needed
    alignSelf: "center",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  instructionText: {
    color: "#fff",
    fontSize: 16,
  },
  pinActionContainer: {
    position: "absolute",
    bottom: 30, // Adjust as needed
    left: 20,
    right: 20,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  pinActionButton: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 10,
    elevation: 5,
  },
  confirmButton: {
    backgroundColor: "#007AFF",
  },
  cancelButton: {
    backgroundColor: "#6c757d",
  },
  pinActionButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  savedLocationsContainer: {
    flexDirection: "row",
    marginBottom: 20,
  },
  savedLocationButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#e9f2ff",
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 20,
    marginRight: 10,
  },
  savedLocationText: {
    marginLeft: 8,
    color: "#007AFF",
    fontWeight: "600",
  },
  findRideButton: {
    backgroundColor: "#007AFF",
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 25,
  },
  findRideButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  nearbyContainer: {},
  nearbyTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 10,
  },
  busItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f2f5",
  },
  busInfo: {
    marginLeft: 15,
  },
  busPlate: {
    fontSize: 16,
    fontWeight: "600",
  },
  busStatus: {
    color: "#666",
  },
  noBusesText: {
    textAlign: "center",
    color: "#888",
    marginTop: 20,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  modalContent: {
    width: "85%",
    backgroundColor: "white",
    borderRadius: 20,
    padding: 30,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: "bold",
    marginTop: 15,
    marginBottom: 10,
    textAlign: "center",
  },
  modalText: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginBottom: 25,
    lineHeight: 24,
  },
  modalButton: {
    backgroundColor: "#007AFF",
    borderRadius: 10,
    paddingVertical: 15,
    paddingHorizontal: 50,
  },
  modalButtonText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 16,
  },
  inputTouchable: {
    flex: 1,
    height: 50,
    justifyContent: "center",
  },
  inputText: {
    fontSize: 16,
  },
  centerPinContainer: {
    position: "absolute",
    top: "50%",
    left: "50%",
    // Offset by half the icon's size to truly center it
    marginLeft: -20,
    marginTop: -40, // Adjust this to have the tip of the pin at the center
  },
});
