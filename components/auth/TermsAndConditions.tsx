import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

interface TermsAndConditionsProps {
  accepted: boolean;
  onAcceptChange: (accepted: boolean) => void;
  error?: string;
}

export default function TermsAndConditions({
  accepted,
  onAcceptChange,
  error,
}: TermsAndConditionsProps) {
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showFullTerms, setShowFullTerms] = useState(false);

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.checkboxContainer}
        onPress={() => onAcceptChange(!accepted)}
        activeOpacity={0.7}
      >
        <View style={[styles.checkbox, accepted && styles.checkboxChecked]}>
          {accepted && <Ionicons name="checkmark" size={18} color="#fff" />}
        </View>
        <Text style={styles.checkboxText}>
          I agree to the
          <Text
            style={styles.link}
            onPress={(e) => {
              e.stopPropagation();
              setShowTermsModal(true);
            }}
          >
            Terms and Conditions
          </Text>
        </Text>
      </TouchableOpacity>
      {error && <Text style={styles.errorText}>{error}</Text>}

      {/* Terms and Conditions Modal */}
      <Modal
        visible={showTermsModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setShowTermsModal(false);
          setShowFullTerms(false);
        }}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Terms and Conditions</Text>
            <TouchableOpacity
              onPress={() => {
                setShowTermsModal(false);
                setShowFullTerms(false);
              }}
            >
              <Ionicons name="close" size={28} color="#1c1c1e" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.modalContent}
            contentContainerStyle={styles.scrollViewContent}
            showsVerticalScrollIndicator={true}
            bounces={true}
          >
            <Text style={styles.lastUpdated}>
              Last Updated: October 30, 2025
            </Text>

            {/* Preview (always shown) */}
            <Text style={styles.sectionTitle}>1. Acceptance of Terms</Text>
            <Text style={styles.paragraph}>
              By accessing and using the Miniway application, you accept and
              agree to be bound by these Terms and Conditions. If you do not
              agree to these terms, please do not use our service.
            </Text>

            <Text style={styles.sectionTitle}>2. Service Description</Text>
            <Text style={styles.paragraph}>
              Miniway is a minibus tracking and booking platform that connects
              commuters, drivers, and conductors. We provide real-time location
              tracking, route planning, and passenger management services.
            </Text>

            {!showFullTerms ? (
              <TouchableOpacity
                style={styles.readMoreButton}
                onPress={() => setShowFullTerms(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.readMoreText}>Read more</Text>
                <Ionicons name="chevron-down" size={18} color="#007AFF" />
              </TouchableOpacity>
            ) : (
              <>
                {/* Full terms (rest of sections) */}
                <Text style={styles.sectionTitle}>3. User Accounts</Text>
                <Text style={styles.paragraph}>
                  3.1. You must provide accurate and complete information when
                  creating an account.
                </Text>
                <Text style={styles.paragraph}>
                  3.2. You are responsible for maintaining the confidentiality
                  of your account credentials.
                </Text>
                <Text style={styles.paragraph}>
                  3.3. You must notify us immediately of any unauthorized use of
                  your account.
                </Text>
                <Text style={styles.paragraph}>
                  3.4. Users must be at least 18 years old to create an account.
                </Text>

                <Text style={styles.sectionTitle}>4. User Roles</Text>
                <Text style={styles.paragraph}>
                  4.1. <Text style={styles.bold}>Commuters</Text>: Can search
                  for routes, track buses, and request pickups.
                </Text>
                <Text style={styles.paragraph}>
                  4.2. <Text style={styles.bold}>Drivers</Text>: Can manage
                  trips, update location, and accept passenger requests.
                </Text>
                <Text style={styles.paragraph}>
                  4.3. <Text style={styles.bold}>Conductors</Text>: Can manage
                  passenger boarding and collect fares.
                </Text>

                <Text style={styles.sectionTitle}>5. Payment and Fares</Text>
                <Text style={styles.paragraph}>
                  5.1. Fares are determined by the service operators and may
                  vary by route and time.
                </Text>
                <Text style={styles.paragraph}>
                  5.2. Payment methods and procedures are subject to change.
                </Text>
                <Text style={styles.paragraph}>
                  5.3. Refunds are handled on a case-by-case basis according to
                  our refund policy.
                </Text>

                <Text style={styles.sectionTitle}>6. Location Services</Text>
                <Text style={styles.paragraph}>
                  6.1. Our app uses GPS and location services to provide
                  real-time tracking.
                </Text>
                <Text style={styles.paragraph}>
                  6.2. By using our service, you consent to the collection and
                  use of location data as described in our Privacy Policy.
                </Text>
                <Text style={styles.paragraph}>
                  6.3. Location accuracy may vary depending on device and
                  network conditions.
                </Text>

                <Text style={styles.sectionTitle}>7. User Conduct</Text>
                <Text style={styles.paragraph}>You agree not to:</Text>
                <Text style={styles.paragraph}>
                  • Use the service for any illegal purpose
                </Text>
                <Text style={styles.paragraph}>
                  • Harass, threaten, or harm other users
                </Text>
                <Text style={styles.paragraph}>
                  • Provide false or misleading information
                </Text>
                <Text style={styles.paragraph}>
                  • Attempt to interfere with the service&#39;s operation
                </Text>
                <Text style={styles.paragraph}>
                  • Share your account with others
                </Text>

                <Text style={styles.sectionTitle}>8. Safety and Security</Text>
                <Text style={styles.paragraph}>
                  8.1. All users are expected to prioritize safety while using
                  the service.
                </Text>
                <Text style={styles.paragraph}>
                  8.2. Drivers must comply with all traffic laws and
                  regulations.
                </Text>
                <Text style={styles.paragraph}>
                  8.3. Report any safety concerns or incidents immediately
                  through the app.
                </Text>

                <Text style={styles.sectionTitle}>9. Privacy</Text>
                <Text style={styles.paragraph}>
                  Your use of Miniway is also governed by our Privacy Policy,
                  which describes how we collect, use, and protect your personal
                  information. Please review the Privacy Policy to understand
                  our practices.
                </Text>

                <Text style={styles.sectionTitle}>
                  10. Intellectual Property
                </Text>
                <Text style={styles.paragraph}>
                  10.1. All content, features, and functionality of the Miniway
                  app are owned by us and are protected by copyright, trademark,
                  and other intellectual property laws.
                </Text>
                <Text style={styles.paragraph}>
                  10.2. You may not copy, modify, distribute, or create
                  derivative works without our express written permission.
                </Text>

                <Text style={styles.sectionTitle}>11. Disclaimers</Text>
                <Text style={styles.paragraph}>
                  11.1. The service is provided &#34;as is&#34; without
                  warranties of any kind.
                </Text>
                <Text style={styles.paragraph}>
                  11.2. We do not guarantee uninterrupted or error-free service.
                </Text>
                <Text style={styles.paragraph}>
                  11.3. We are not responsible for delays, cancellations, or
                  route changes by service operators.
                </Text>
                <Text style={styles.paragraph}>
                  11.4. We do not guarantee the accuracy of real-time location
                  data.
                </Text>

                <Text style={styles.sectionTitle}>
                  12. Limitation of Liability
                </Text>
                <Text style={styles.paragraph}>
                  To the maximum extent permitted by law, Miniway shall not be
                  liable for any indirect, incidental, special, consequential,
                  or punitive damages, or any loss of profits or revenues,
                  whether incurred directly or indirectly.
                </Text>

                <Text style={styles.sectionTitle}>13. Termination</Text>
                <Text style={styles.paragraph}>
                  13.1. We reserve the right to suspend or terminate your
                  account at any time for violation of these terms.
                </Text>
                <Text style={styles.paragraph}>
                  13.2. You may terminate your account at any time by contacting
                  support.
                </Text>
                <Text style={styles.paragraph}>
                  13.3. Upon termination, you must cease all use of the service.
                </Text>

                <Text style={styles.sectionTitle}>14. Changes to Terms</Text>
                <Text style={styles.paragraph}>
                  We reserve the right to modify these Terms and Conditions at
                  any time. We will notify users of significant changes via
                  email or in-app notification. Continued use of the service
                  after changes constitutes acceptance of the new terms.
                </Text>

                <Text style={styles.sectionTitle}>15. Governing Law</Text>
                <Text style={styles.paragraph}>
                  These Terms and Conditions are governed by and construed in
                  accordance with the laws of Kenya, without regard to its
                  conflict of law provisions.
                </Text>

                <Text style={styles.sectionTitle}>16. Contact Information</Text>
                <Text style={styles.paragraph}>
                  For questions about these Terms and Conditions, please contact
                  us at:
                </Text>
                <Text style={styles.paragraph}>
                  Email: support@miniway.co.ke
                </Text>
                <Text style={styles.paragraph}>Phone: +254 700 000 000</Text>

                <Text style={styles.sectionTitle}>17. Severability</Text>
                <Text style={styles.paragraph}>
                  If any provision of these Terms and Conditions is found to be
                  unenforceable or invalid, that provision will be limited or
                  eliminated to the minimum extent necessary so that these Terms
                  and Conditions will otherwise remain in full force and effect.
                </Text>

                <TouchableOpacity
                  style={styles.readMoreButton}
                  onPress={() => setShowFullTerms(false)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.readMoreText}>Show less</Text>
                  <Ionicons name="chevron-up" size={18} color="#007AFF" />
                </TouchableOpacity>
              </>
            )}

            <View style={styles.bottomSpacer} />
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => {
                setShowTermsModal(false);
                setShowFullTerms(false);
              }}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 12,
  },
  checkboxContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#007AFF",
    marginRight: 12,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  checkboxChecked: {
    backgroundColor: "#007AFF",
    borderColor: "#007AFF",
  },
  checkboxText: {
    fontSize: 14,
    color: "#1c1c1e",
    flex: 1,
    lineHeight: 20,
  },
  link: {
    color: "#007AFF",
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  errorText: {
    fontSize: 12,
    color: "#FF3B30",
    marginTop: 4,
    marginLeft: 36,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "#fff",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 20,
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    backgroundColor: "#f8f8f8",
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#1c1c1e",
  },
  modalContent: {
    flex: 1,
  },
  scrollViewContent: {
    padding: 20,
    paddingBottom: 60,
  },
  lastUpdated: {
    fontSize: 13,
    color: "#8e8e93",
    fontStyle: "italic",
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1c1c1e",
    marginTop: 20,
    marginBottom: 10,
  },
  paragraph: {
    fontSize: 15,
    color: "#3a3a3c",
    lineHeight: 22,
    marginBottom: 12,
  },
  bold: {
    fontWeight: "700",
  },
  bottomSpacer: {
    height: 60,
  },
  modalFooter: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
    backgroundColor: "#f8f8f8",
  },
  acceptButton: {
    backgroundColor: "#007AFF",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  acceptButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  closeButton: {
    paddingVertical: 12,
    alignItems: "center",
  },
  closeButtonText: {
    color: "#007AFF",
    fontSize: 16,
    fontWeight: "500",
  },
  readMoreButton: {
    marginTop: 8,
    marginBottom: 8,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
  },
  readMoreText: {
    color: "#007AFF",
    fontSize: 15,
    fontWeight: "600",
    marginRight: 6,
  },
});
