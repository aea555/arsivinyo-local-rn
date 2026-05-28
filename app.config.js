export default ({ config }) => {
  return {
    ...config,
    name: "Arsivinyo Local",
    slug: "arsivinyo-local-rn",
    version: "2.2.0-beta.1",
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
      versionCode: 20200,
      adaptiveIcon: {
        backgroundColor: "#000000",
        foregroundImage: "./assets/images/ic_launcher_foreground.png",
        backgroundImage: "./assets/images/ic_launcher_background.png",
        monochromeImage: "./assets/images/ic_launcher_monochrome.png",
      },
      blockedPermissions: [
        "android.permission.ACCESS_MEDIA_LOCATION",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.READ_MEDIA_AUDIO",
        "android.permission.READ_MEDIA_IMAGES",
        "android.permission.READ_MEDIA_VIDEO",
        "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
      ],
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
        "expo-build-properties",
        {
          ios: {
            useFrameworks: "static",
          },
          android: {
            extraProguardRules: [
              "# Tink (vault cipher v4) uses reflection on its key managers.",
              "-keep class com.google.crypto.tink.** { *; }",
              "-keepclassmembers class com.google.crypto.tink.** { *; }",
              "-dontwarn com.google.crypto.tink.**",
              "# NanoHTTPD (vault loopback playback server)",
              "-keep class fi.iki.elonen.** { *; }",
              "-dontwarn fi.iki.elonen.**",
            ].join("\n"),
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
