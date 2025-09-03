import { Colors } from "@/constants/Colors";
// ✅ Import your theme context hook
import { useAppTheme } from "@/contexts/ThemeContext";

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof typeof Colors.light & keyof typeof Colors.dark
) {
  // ✅ Get the theme from your context, not the device settings
  const { theme } = useAppTheme();
  const colorFromProps = props[theme];

  if (colorFromProps) {
    return colorFromProps;
  } else {
    // Return the color from your Colors.ts file based on the context's theme
    return Colors[theme][colorName];
  }
}
