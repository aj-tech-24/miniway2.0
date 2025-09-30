// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Extend asset and source extensions
config.resolver.assetExts.push(
  "glb",
  "gltf",
  "png",
  "jpg",
  "ttf",
  "otf",
  "woff",
  "woff2"
);
config.resolver.sourceExts.push("cjs", "mjs");

// Ensure fonts are properly bundled
config.transformer.assetPlugins = ["expo-asset/tools/hashAssetFiles"];

module.exports = config;
