// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Extend asset and source extensions
config.resolver.assetExts.push("glb", "gltf", "png", "jpg");
config.resolver.sourceExts.push("cjs", "mjs");

module.exports = config;
