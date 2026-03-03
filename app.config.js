export default ({ config }) => {
  return {
    ...config,
    name: "Arsivinyo Local",
    slug: "arsivinyo-local-rn",
    version: "2.0.0",
    orientation: "portrait",
    icon: "./assets/images/play_store_512.png",
    scheme: "arsivinyo-local-rn",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.arsivinyo.local",
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#000000",
        foregroundImage: "./assets/images/ic_launcher_foreground.png",
        backgroundImage: "./assets/images/ic_launcher_background.png",
        monochromeImage: "./assets/images/ic_launcher_monochrome.png",
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      package: "com.arsivinyo.local",
    },
    web: {
      output: "static",
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-video",
      "expo-router",
      [
        "expo-splash-screen",
        {
          image: "./assets/images/ic_launcher.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#000000",
          dark: {
            backgroundColor: "#000000",
          },
        },
      ],
      [
        "expo-media-library",
        {
          savePhotosPermission: "Allow $(PRODUCT_NAME) to save photos.",
          isAccessMediaLocationEnabled: true,
        },
      ],
      [
        "expo-build-properties",
        {
          ios: {
            useFrameworks: "static",
          },
        },
      ],
      "./modules/local-downloader/app.plugin.js",
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      localMode: true,
    },
  };
};
