import { useAppTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { Camera, CameraView } from "expo-camera";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

interface Passenger {
  id: string;
  passenger_id: string;
  status: "boarded" | "completed" | "cancelled";
  boarded_at: string;
  passenger_count: number;
  users?: {
    fullName: string;
    contact_number: string;
  };
}

interface Trip {
  id: string;
  status: "waiting" | "ongoing" | "completed" | "cancelled";
  buses: {
    id: string;
    plate_number: string;
    capacity: number;
    passengers: number;
    routes: {
      id: string;
      name: string;
      start_address: string;
      end_address: string;
    };
  };
  trip_passengers: Passenger[];
}

export function ConductorScreen() {
  const { theme } = useAppTheme();
  const [loading, setLoading] = useState(true);
  const [currentTrip, setCurrentTrip] = useState<Trip | null>(null);
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [passengerCount, setPassengerCount] = useState(0);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showGuestModal, setShowGuestModal] = useState(false);
  const [guestCount, setGuestCount] = useState(1);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const [scannedPassengers, setScannedPassengers] = useState<Set<string>>(
    new Set()
  );

  const scanLineAnimation = useRef(new Animated.Value(0)).current;

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

  // Custom Alert Function
  const showAlert = useCallback(
    (
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
    },
    []
  );

  const hideAlert = useCallback(() => {
    setShowCustomAlert(false);
  }, []);

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

  // Fetch current trip and passengers
  const fetchCurrentTrip = useCallback(async () => {
    try {
      setLoading(true);

      // Get current user
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        showAlert("Authentication Error", "Please log in again", "error");
        return;
      }

      // Find current trip for this conductor (assuming conductor is assigned to a bus)
      const { data: busData, error: busError } = await supabase
        .from("buses")
        .select(
          `
          id,
          plate_number,
          capacity,
          passengers,
          conductor_id,
          routes(
            id,
            name,
            start_address,
            end_address
          )
        `
        )
        .eq("conductor_id", user.id)
        .single();

      if (busError || !busData) {
        showAlert(
          "No Bus Assignment",
          "You haven't been assigned to a bus yet. Please contact your administrator.",
          "warning"
        );
        return;
      }

      // Find active trip for this bus
      const { data: tripData, error: tripError } = await supabase
        .from("trips")
        .select(
          `
          id,
          status,
          buses(
            id,
            plate_number,
            capacity,
            passengers,
            routes(
              id,
              name,
              start_address,
              end_address
            )
          ),
          trip_passengers(
            id,
            passenger_id,
            status,
            boarded_at,
            passenger_count,
            users(
              fullName,
              contact_number
            )
          )
        `
        )
        .eq("bus_id", busData.id)
        .in("status", ["waiting", "ongoing"])
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();

      if (tripError || !tripData) {
        // No active trip found
        console.log("Trip query error:", tripError);
        console.log("Trip data:", tripData);
        console.log("Bus ID:", busData.id);
        setCurrentTrip(null);
        setPassengers([]);
        setPassengerCount(0);
        return;
      }

      // Transform the data to match our interface
      const busInfo = Array.isArray(tripData.buses)
        ? tripData.buses[0]
        : tripData.buses;
      const transformedTrip: Trip = {
        id: tripData.id,
        status: tripData.status,
        buses: {
          ...busInfo,
          routes: Array.isArray(busInfo.routes)
            ? busInfo.routes[0]
            : busInfo.routes,
        },
        trip_passengers: (tripData.trip_passengers || []).map((p: any) => ({
          id: p.id,
          passenger_id: p.passenger_id,
          status: p.status,
          boarded_at: p.boarded_at,
          passenger_count: p.passenger_count,
          users: Array.isArray(p.users) ? p.users[0] : p.users,
        })),
      };

      setCurrentTrip(transformedTrip);
      setPassengers(transformedTrip.trip_passengers);

      // Calculate total passenger count
      const totalPassengers = transformedTrip.trip_passengers.reduce(
        (sum: number, p: Passenger) => sum + (p.passenger_count || 1),
        0
      );
      setPassengerCount(totalPassengers);

      // Set scanned passengers
      const passengerIds = new Set(
        transformedTrip.trip_passengers
          .filter((p: Passenger) => p.status === "boarded")
          .map((p: Passenger) => p.passenger_id)
      );
      setScannedPassengers(passengerIds);
    } catch (error) {
      console.error("Error fetching current trip:", error);
      showAlert("Error", "Failed to load trip data", "error");
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    fetchCurrentTrip();
  }, [fetchCurrentTrip]);

  // Request camera permissions
  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === "granted");
    })();
  }, []);

  // Animation for scanning line
  useEffect(() => {
    if (showQRScanner && !scanned) {
      const startAnimation = () => {
        scanLineAnimation.setValue(0);
        Animated.timing(scanLineAnimation, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }).start(() => {
          if (showQRScanner && !scanned) {
            startAnimation();
          }
        });
      };
      startAnimation();
    } else {
      scanLineAnimation.stopAnimation();
    }
  }, [showQRScanner, scanned, scanLineAnimation]);

  // Handle QR code scan
  const handleBarCodeScanned = async ({
    type,
    data,
  }: {
    type: string;
    data: string;
  }) => {
    if (scanned) return;

    setScanned(true);

    try {
      const payload = JSON.parse(data);

      if (!payload.commuterId) {
        showAlert(
          "Invalid QR Code",
          "This QR code is not valid for passenger boarding",
          "error"
        );
        return;
      }

      // Check if passenger is already scanned
      if (scannedPassengers.has(payload.commuterId)) {
        showAlert(
          "Already Boarded",
          "This passenger has already been scanned",
          "info"
        );
        return;
      }

      // Find the passenger in current trip
      const passenger = passengers.find(
        (p) => p.passenger_id === payload.commuterId
      );

      if (!passenger) {
        showAlert(
          "Passenger Not Found",
          "This passenger is not on the current trip",
          "error"
        );
        return;
      }

      if (passenger.status === "boarded") {
        showAlert(
          "Already Boarded",
          "This passenger has already boarded",
          "info"
        );
        return;
      }

      // Update passenger status to boarded
      const { error: updateError } = await supabase
        .from("trip_passengers")
        .update({
          status: "boarded",
          boarded_at: new Date().toISOString(),
        })
        .eq("id", passenger.id);

      if (updateError) {
        throw updateError;
      }

      // Update bus passenger count
      const newPassengerCount =
        passengerCount + (passenger.passenger_count || 1);
      const { error: busError } = await supabase
        .from("buses")
        .update({ passengers: newPassengerCount })
        .eq("id", currentTrip?.buses.id);

      if (busError) {
        console.error("Error updating bus passenger count:", busError);
      }

      // Update local state
      setPassengerCount(newPassengerCount);
      setScannedPassengers((prev) => new Set(prev).add(payload.commuterId));

      // Update passengers list
      setPassengers((prev) =>
        prev.map((p) =>
          p.id === passenger.id
            ? {
                ...p,
                status: "boarded" as const,
                boarded_at: new Date().toISOString(),
              }
            : p
        )
      );

      const passengerText =
        (passenger.passenger_count || 1) > 1
          ? `${passenger.passenger_count} passengers`
          : "1 passenger";

      showAlert(
        "Passenger Boarded! ✅",
        `${
          passenger.users?.fullName || "Passenger"
        } has been successfully boarded. ${passengerText} added.`,
        "success"
      );
    } catch (error) {
      console.error("Error processing QR scan:", error);
      showAlert(
        "Scan Error",
        "Failed to process QR code. Please try again.",
        "error"
      );
    } finally {
      setScanned(false);
    }
  };

  // Add guest passenger
  const addGuestPassenger = async () => {
    if (!currentTrip || guestCount < 1) {
      showAlert(
        "Invalid Input",
        "Please enter a valid number of guests",
        "error"
      );
      return;
    }

    if (passengerCount + guestCount > currentTrip.buses.capacity) {
      showAlert(
        "Bus Full",
        `Cannot add ${guestCount} guests. Bus capacity is ${currentTrip.buses.capacity} and you currently have ${passengerCount} passengers.`,
        "warning"
      );
      return;
    }

    try {
      // Create a guest passenger record
      const { error: insertError } = await supabase
        .from("trip_passengers")
        .insert({
          trip_id: currentTrip.id,
          bus_id: currentTrip.buses.id,
          passenger_id: `guest_${Date.now()}`, // Generate unique guest ID
          status: "boarded",
          boarded_at: new Date().toISOString(),
          passenger_count: guestCount,
        });

      if (insertError) {
        throw insertError;
      }

      // Update bus passenger count
      const newPassengerCount = passengerCount + guestCount;
      const { error: busError } = await supabase
        .from("buses")
        .update({ passengers: newPassengerCount })
        .eq("id", currentTrip.buses.id);

      if (busError) {
        console.error("Error updating bus passenger count:", busError);
      }

      // Update local state
      setPassengerCount(newPassengerCount);

      const guestText = guestCount > 1 ? `${guestCount} guests` : "1 guest";
      showAlert(
        "Guests Added! ✅",
        `${guestText} have been added to the passenger count.`,
        "success"
      );

      setShowGuestModal(false);
      setGuestCount(1);

      // Refresh data
      fetchCurrentTrip();
    } catch (error) {
      console.error("Error adding guest passengers:", error);
      showAlert(
        "Error",
        "Failed to add guest passengers. Please try again.",
        "error"
      );
    }
  };

  const renderPassengerItem = ({ item }: { item: Passenger }) => (
    <View style={styles.passengerItem}>
      <View style={styles.passengerInfo}>
        <Text style={styles.passengerName}>
          {item.users?.fullName || "Guest Passenger"}
        </Text>
        <Text style={styles.passengerDetails}>
          {item.passenger_count > 1
            ? `${item.passenger_count} passengers`
            : "1 passenger"}
        </Text>
        {item.users?.contact_number && (
          <Text style={styles.passengerContact}>
            {item.users.contact_number}
          </Text>
        )}
      </View>
      <View
        style={[
          styles.statusBadge,
          {
            backgroundColor: item.status === "boarded" ? "#E8F5E8" : "#FFF3CD",
          },
        ]}
      >
        <Ionicons
          name={item.status === "boarded" ? "checkmark-circle" : "time"}
          size={16}
          color={item.status === "boarded" ? "#4CAF50" : "#FF9500"}
        />
        <Text
          style={[
            styles.statusText,
            { color: item.status === "boarded" ? "#4CAF50" : "#FF9500" },
          ]}
        >
          {item.status === "boarded" ? "Boarded" : "Waiting"}
        </Text>
      </View>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style={theme === "dark" ? "light" : "dark"} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading conductor dashboard...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentTrip) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style={theme === "dark" ? "light" : "dark"} />
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <Ionicons name="person-circle" size={28} color="#fff" />
            <Text style={styles.headerTitle}>Conductor Dashboard</Text>
          </View>
        </View>
        <View style={styles.emptyState}>
          <Ionicons name="bus-outline" size={64} color="#8e8e93" />
          <Text style={styles.emptyTitle}>No Active Trip</Text>
          <Text style={styles.emptySubtitle}>
            You don't have any active trips at the moment. Check back later or
            contact your driver.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Ionicons name="person-circle" size={28} color="#fff" />
          <Text style={styles.headerTitle}>Conductor Dashboard</Text>
        </View>
        <Text style={styles.headerSubtitle}>
          {currentTrip.buses.plate_number} • {currentTrip.buses.routes.name}
        </Text>
      </View>

      {/* Trip Info Card */}
      <View style={styles.tripCard}>
        <View style={styles.tripHeader}>
          <View style={styles.tripInfo}>
            <Text style={styles.routeName}>
              {currentTrip.buses.routes.name}
            </Text>
            <Text style={styles.busPlate}>
              {currentTrip.buses.plate_number}
            </Text>
          </View>
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor:
                  currentTrip.status === "ongoing" ? "#E8F5E8" : "#FFF3CD",
              },
            ]}
          >
            <Ionicons
              name={currentTrip.status === "ongoing" ? "play-circle" : "time"}
              size={16}
              color={currentTrip.status === "ongoing" ? "#4CAF50" : "#FF9500"}
            />
            <Text
              style={[
                styles.statusText,
                {
                  color:
                    currentTrip.status === "ongoing" ? "#4CAF50" : "#FF9500",
                },
              ]}
            >
              {currentTrip.status === "ongoing" ? "In Progress" : "Waiting"}
            </Text>
          </View>
        </View>

        <View style={styles.routeDetails}>
          <View style={styles.routeItem}>
            <View
              style={[styles.locationMarker, { backgroundColor: "#4CAF50" }]}
            >
              <Ionicons name="location" size={12} color="#fff" />
            </View>
            <Text style={styles.locationText}>
              {currentTrip.buses.routes.start_address}
            </Text>
          </View>
          <View style={styles.routeItem}>
            <View
              style={[styles.locationMarker, { backgroundColor: "#FF3B30" }]}
            >
              <Ionicons name="location" size={12} color="#fff" />
            </View>
            <Text style={styles.locationText}>
              {currentTrip.buses.routes.end_address}
            </Text>
          </View>
        </View>
      </View>

      {/* Passenger Count Card */}
      <View style={styles.passengerCountCard}>
        <View style={styles.countHeader}>
          <Ionicons name="people" size={24} color="#007AFF" />
          <Text style={styles.countTitle}>Passenger Count</Text>
        </View>
        <View style={styles.countDisplay}>
          <Text style={styles.countNumber}>{passengerCount}</Text>
          <Text style={styles.countTotal}>/ {currentTrip.buses.capacity}</Text>
        </View>
        <View style={styles.countActions}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => setShowQRScanner(true)}
            disabled={!hasPermission}
          >
            <Ionicons name="qr-code" size={20} color="#fff" />
            <Text style={styles.actionButtonText}>Scan QR</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.guestButton]}
            onPress={() => setShowGuestModal(true)}
          >
            <Ionicons name="person-add" size={20} color="#fff" />
            <Text style={styles.actionButtonText}>Add Guest</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Passengers List */}
      <View style={styles.passengersSection}>
        <Text style={styles.sectionTitle}>
          Passengers ({passengers.length})
        </Text>
        <FlatList
          data={passengers}
          renderItem={renderPassengerItem}
          keyExtractor={(item) => item.id}
          style={styles.passengersList}
          showsVerticalScrollIndicator={false}
        />
      </View>

      {/* QR Scanner Modal */}
      <Modal
        visible={showQRScanner}
        animationType="slide"
        onRequestClose={() => setShowQRScanner(false)}
      >
        <View style={styles.scannerContainer}>
          <View style={styles.scannerHeader}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowQRScanner(false)}
            >
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.scannerTitle}>Scan Passenger QR Code</Text>
          </View>

          {hasPermission === null ? (
            <View style={styles.permissionContainer}>
              <Text style={styles.permissionText}>
                Requesting camera permission...
              </Text>
            </View>
          ) : hasPermission === false ? (
            <View style={styles.permissionContainer}>
              <Ionicons name="camera" size={64} color="#8e8e93" />
              <Text style={styles.permissionText}>
                Camera permission is required to scan QR codes
              </Text>
            </View>
          ) : (
            <View style={styles.cameraContainer}>
              <CameraView
                style={styles.camera}
                onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
                barcodeScannerSettings={{
                  barcodeTypes: ["qr"],
                }}
              />
              <View style={styles.scannerOverlay}>
                <View style={styles.scannerFrame}>
                  <Animated.View
                    style={[
                      styles.scanLine,
                      {
                        transform: [
                          {
                            translateY: scanLineAnimation.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0, 200],
                            }),
                          },
                        ],
                      },
                    ]}
                  />
                </View>
                <Text style={styles.scannerInstruction}>
                  Position the QR code within the frame
                </Text>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* Guest Passenger Modal */}
      <Modal
        visible={showGuestModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowGuestModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Add Guest Passengers</Text>
            <Text style={styles.modalSubtitle}>
              How many guests are boarding without using the app?
            </Text>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Number of Guests</Text>
              <View style={styles.numberInput}>
                <TouchableOpacity
                  style={styles.numberButton}
                  onPress={() => setGuestCount(Math.max(1, guestCount - 1))}
                >
                  <Ionicons name="remove" size={20} color="#007AFF" />
                </TouchableOpacity>
                <Text style={styles.numberDisplay}>{guestCount}</Text>
                <TouchableOpacity
                  style={styles.numberButton}
                  onPress={() =>
                    setGuestCount(
                      Math.min(
                        currentTrip.buses.capacity - passengerCount,
                        guestCount + 1
                      )
                    )
                  }
                >
                  <Ionicons name="add" size={20} color="#007AFF" />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setShowGuestModal(false);
                  setGuestCount(1);
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton]}
                onPress={addGuestPassenger}
              >
                <Text style={styles.confirmButtonText}>Add Guests</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
    backgroundColor: "#f2f2f7",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    fontSize: 16,
    color: "#8e8e93",
    marginTop: 12,
    fontWeight: "500",
  },
  header: {
    backgroundColor: "#007AFF",
    paddingTop: 20,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    marginBottom: 20,
    elevation: 4,
    shadowColor: "#007AFF",
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#fff",
    marginLeft: 12,
  },
  headerSubtitle: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.8)",
    fontWeight: "500",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1c1c1e",
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    color: "#8e8e93",
    textAlign: "center",
    lineHeight: 22,
  },
  tripCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  tripHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  tripInfo: {
    flex: 1,
  },
  routeName: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1c1c1e",
    marginBottom: 4,
  },
  busPlate: {
    fontSize: 14,
    color: "#8e8e93",
    fontWeight: "500",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 6,
  },
  routeDetails: {
    gap: 8,
  },
  routeItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  locationMarker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  locationText: {
    fontSize: 14,
    color: "#1c1c1e",
    fontWeight: "500",
    flex: 1,
  },
  passengerCountCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 20,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  countHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  countTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1c1c1e",
    marginLeft: 8,
  },
  countDisplay: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
    marginBottom: 20,
  },
  countNumber: {
    fontSize: 48,
    fontWeight: "bold",
    color: "#007AFF",
  },
  countTotal: {
    fontSize: 24,
    color: "#8e8e93",
    marginLeft: 8,
  },
  countActions: {
    flexDirection: "row",
    gap: 12,
  },
  actionButton: {
    flex: 1,
    backgroundColor: "#007AFF",
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  guestButton: {
    backgroundColor: "#34C759",
  },
  actionButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },
  passengersSection: {
    flex: 1,
    marginHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1c1c1e",
    marginBottom: 12,
  },
  passengersList: {
    flex: 1,
  },
  passengerItem: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  passengerInfo: {
    flex: 1,
  },
  passengerName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1c1c1e",
    marginBottom: 4,
  },
  passengerDetails: {
    fontSize: 14,
    color: "#8e8e93",
    marginBottom: 2,
  },
  passengerContact: {
    fontSize: 12,
    color: "#8e8e93",
  },
  scannerContainer: {
    flex: 1,
    backgroundColor: "#000",
  },
  scannerHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
  },
  closeButton: {
    marginRight: 16,
  },
  scannerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  permissionContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  permissionText: {
    fontSize: 16,
    color: "#8e8e93",
    textAlign: "center",
    marginTop: 16,
  },
  cameraContainer: {
    flex: 1,
    position: "relative",
  },
  camera: {
    flex: 1,
  },
  scannerOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  scannerFrame: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: "#007AFF",
    borderRadius: 12,
    position: "relative",
    overflow: "hidden",
  },
  scanLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: "#007AFF",
  },
  scannerInstruction: {
    color: "#fff",
    fontSize: 16,
    marginTop: 30,
    textAlign: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  modalContainer: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1c1c1e",
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 16,
    color: "#8e8e93",
    marginBottom: 24,
    lineHeight: 22,
  },
  inputContainer: {
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: "#1c1c1e",
    marginBottom: 12,
  },
  numberInput: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },
  numberButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#f2f2f7",
    justifyContent: "center",
    alignItems: "center",
  },
  numberDisplay: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#1c1c1e",
    minWidth: 60,
    textAlign: "center",
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  cancelButton: {
    backgroundColor: "#f2f2f7",
  },
  confirmButton: {
    backgroundColor: "#34C759",
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#8e8e93",
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  alertOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  alertContainer: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
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
    color: "#1c1c1e",
    flex: 1,
  },
  alertMessage: {
    fontSize: 16,
    color: "#8e8e93",
    lineHeight: 22,
    marginBottom: 24,
  },
  alertButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  alertButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    minWidth: 80,
    alignItems: "center",
  },
  alertCancelButton: {
    backgroundColor: "#f2f2f7",
  },
  alertCancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#8e8e93",
  },
  alertConfirmButton: {
    // backgroundColor will be set dynamically
  },
  alertConfirmButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
  },
});

export default ConductorScreen;
