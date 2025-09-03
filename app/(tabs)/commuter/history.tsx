import React from "react";
import { FlatList, SafeAreaView, StyleSheet, Text, View } from "react-native";

const MOCK_HISTORY = [
  {
    id: "1",
    route: "Route 4A: Downtown to Uptown",
    date: "2024-08-21",
    status: "Completed",
  },
  {
    id: "2",
    route: "Route 12B: Crosstown Express",
    date: "2024-08-20",
    status: "Completed",
  },
  {
    id: "3",
    route: "Route 7: North to South",
    date: "2024-08-19",
    status: "Cancelled",
  },
];

export function HistoryScreen() {
  const renderItem = ({ item }: { item: (typeof MOCK_HISTORY)[0] }) => (
    <View
      style={[styles.card, item.status === "Cancelled" && styles.cancelledCard]}
    >
      <Text style={styles.cardTitle}>{item.route}</Text>
      <Text style={styles.cardSubtitle}>{item.date}</Text>
      <View
        style={[
          styles.statusBadge,
          item.status === "Cancelled" && { backgroundColor: "#dc3545" },
        ]}
      >
        <Text style={styles.statusText}>{item.status}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.listContainer}>
      <FlatList
        data={MOCK_HISTORY}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 20 }}
        ListHeaderComponent={
          <Text style={styles.listHeader}>Trip History</Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f8f9fa",
    padding: 20,
  },
  listContainer: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: "#6c757d",
    marginBottom: 40,
  },
  listHeader: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 20,
    paddingHorizontal: 5,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    marginBottom: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  cancelledCard: {
    backgroundColor: "#e9ecef",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  cardSubtitle: {
    fontSize: 14,
    color: "#6c757d",
    marginTop: 4,
  },
  statusBadge: {
    position: "absolute",
    top: 15,
    right: 15,
    backgroundColor: "#28a745",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
  },
  button: {
    backgroundColor: "#dc3545",
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
});

export default HistoryScreen;
