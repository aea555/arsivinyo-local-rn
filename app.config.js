export default ({ config }) => {
    return {
        ...config,
        name: 'Arsivinyo Local',
        slug: 'arsivinyo-local-rn',
        version: '1.1.0',
        orientation: 'portrait',
        icon: './assets/images/icon.png',
        scheme: 'arsivinyo-local-rn',
        userInterfaceStyle: 'automatic',
        newArchEnabled: true,
        ios: {
            supportsTablet: true,
            bundleIdentifier: 'com.arsivinyo.local',
        },
        android: {
            adaptiveIcon: {
                backgroundColor: '#000000',
                foregroundImage: './assets/images/android-icon-foreground.png',
                backgroundImage: './assets/images/android-icon-background.png',
                monochromeImage: './assets/images/android-icon-monochrome.png',
            },
            edgeToEdgeEnabled: true,
            predictiveBackGestureEnabled: false,
            package: 'com.arsivinyo.local',
        },
        web: {
            output: 'static',
            favicon: './assets/images/favicon.png',
        },
        plugins: [
            'expo-router',
            [
                'expo-splash-screen',
                {
                    image: './assets/images/splash-icon.png',
                    imageWidth: 200,
                    resizeMode: 'contain',
                    backgroundColor: '#000000',
                    dark: {
                        backgroundColor: '#000000',
                    },
                },
            ],
            [
                'expo-media-library',
                {
                    savePhotosPermission: 'Allow $(PRODUCT_NAME) to save photos.',
                    isAccessMediaLocationEnabled: true,
                },
            ],
            [
                'expo-build-properties',
                {
                    ios: {
                        useFrameworks: 'static',
                    },
                },
            ],
            './modules/local-downloader/app.plugin.js',
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
