// app.config.js

export default {
  expo: {
    name: "Miniway",
    slug: "miniway",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "miniway",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/adaptive-icon.png",
        backgroundColor: "#ffffff",
      },
      edgeToEdgeEnabled: true,
      package: "com.arvinjoy.miniway",
      googleServicesFile: "./google-services.json",
      config: {
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLEMAPS_API,
        },
      },
    },
    web: {
      bundler: "metro",
      output: "static",
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 300,
          resizeMode: "contain",
          backgroundColor: "#ffffff",
        },
      ],
      [
        "expo-camera",
        {
          cameraPermission: "Allow $(PRODUCT_NAME) to access your camera",
          microphonePermission:
            "Allow $(PRODUCT_NAME) to access your microphone",
          recordAudioAndroid: true,
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },

    // 👇 ADD THIS BLOCK 👇
    extra: {
      eas: {
        projectId: "e4033fd1-a39b-48c3-a4ba-a0faa1fe693a",
      },
      nativeNotifyAppId: 32035,
      nativeNotifyAppToken: "C3YxvEGRY2D8OydDIV4Wvf",
    },
  },
};
