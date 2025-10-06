/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

const tintColorLight = "#0a7ea4";
const tintColorDark = "#fff";

export const Colors = {
  light: {
    text: "#11181C",
    background: "#F0F8FF",
    tint: tintColorLight,
    icon: "#687076",
    tabIconDefault: "#687076",
    tabIconSelected: tintColorLight,
    placeholderTextColor: "#888",
    separatorColor: "#EEE",
    // Additional colors for better theming
    cardBackground: "#FFFFFF",
    inputBackground: "#FFFFFF",
    buttonBackground: "#FFF",
    buttonText: "#1A202C",
    success: "#10B981",
    warning: "#F59E0B",
    error: "#EF4444",
    info: "#3B82F6",
    border: "#E5E7EB",
    shadow: "rgba(0, 0, 0, 0.1)",
    overlay: "rgba(0, 0, 0, 0.5)",
    searchBackground: "#F9FAFB",
    modalBackground: "#FFFFFF",
    headerBackground: "#FFFFFF",
    tabBarBackground: "#FFFFFF",
    borderColor: "#E5E7EB",
  },
  dark: {
    text: "#ECEDEE",
    background: "#212A37",
    tint: tintColorDark,
    icon: "#007AFF",
    tabIconDefault: "#555",
    tabIconSelected: tintColorDark,
    placeholderTextColor: "#AAA",
    separatorColor: "#555",
    // Additional colors for better theming
    cardBackground: "#2D3748",
    inputBackground: "#2D3748",
    buttonBackground: "#00e62c",
    buttonText: "#fff",
    success: "#34D399",
    warning: "#FBBF24",
    error: "#F87171",
    info: "#60A5FA",
    border: "#4A5568",
    shadow: "rgba(0, 0, 0, 0.3)",
    overlay: "rgba(0, 0, 0, 0.7)",
    searchBackground: "#1A202C",
    modalBackground: "#2D3748",
    headerBackground: "#1A202C",
    tabBarBackground: "#1A202C",
    borderColor: "#296dff",
  },
};
