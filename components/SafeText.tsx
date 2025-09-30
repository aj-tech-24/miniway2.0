import React from "react";
import { StyleSheet, Text, TextProps } from "react-native";

interface SafeTextProps extends TextProps {
  children: React.ReactNode;
  fallback?: string;
}

export const SafeText: React.FC<SafeTextProps> = ({
  children,
  fallback = "",
  style,
  ...props
}) => {
  // Ensure text content is never empty or undefined
  const textContent = children || fallback;

  // If text content is still empty, use a non-breaking space to prevent layout collapse
  const safeContent = textContent === "" ? "\u00A0" : textContent;

  return (
    <Text style={[styles.defaultText, style]} {...props}>
      {safeContent}
    </Text>
  );
};

const styles = StyleSheet.create({
  defaultText: {
    // Ensure text is always visible
    color: "#000000",
    fontSize: 14,
    // Prevent text from being optimized away
    includeFontPadding: true,
    textAlignVertical: "center",
  },
});

export default SafeText;
