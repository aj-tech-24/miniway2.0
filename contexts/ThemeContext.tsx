import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";
import { useColorScheme } from "react-native";

// Define the possible theme states
type Theme = "light" | "dark";
// Define what the user can choose: an explicit theme or follow the device
type ThemePreference = Theme | "system";

interface ThemeContextType {
  // The actual theme the app is currently using ('light' or 'dark')
  theme: Theme;
  // The user's stored preference ('system', 'light', or 'dark')
  themePreference: ThemePreference;
  // Function to set a new preference
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// A key to save the preference in the device's storage
const THEME_STORAGE_KEY = "user_theme_preference";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // 1. Get the device's current theme ('light' or 'dark')
  const systemTheme = useColorScheme() ?? "light";

  // 2. State to hold the user's chosen preference (defaults to 'system')
  const [themePreference, setThemePreference] =
    useState<ThemePreference>("system");

  // On app start, load the saved preference from storage
  useEffect(() => {
    const loadThemePreference = async () => {
      try {
        const savedPref = (await AsyncStorage.getItem(
          THEME_STORAGE_KEY
        )) as ThemePreference | null;
        if (savedPref) {
          setThemePreference(savedPref);
        }
      } catch (e) {
        console.error("Failed to load theme preference.", e);
      }
    };
    loadThemePreference();
  }, []);

  // 3. Determine the actual theme to apply.
  // If preference is 'system', use the device's theme. Otherwise, use the chosen one.
  const theme = themePreference === "system" ? systemTheme : themePreference;

  // 4. Create a function that updates the preference state AND saves it to storage
  const handleSetTheme = async (newPref: ThemePreference) => {
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, newPref);
      setThemePreference(newPref); // Update the state to trigger a re-render
    } catch (e) {
      console.error("Failed to save theme preference.", e);
    }
  };

  const value = { theme, themePreference, setTheme: handleSetTheme };

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

// Custom hook to easily use the theme context
export const useAppTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useAppTheme must be used within a ThemeProvider");
  }
  return context;
};
