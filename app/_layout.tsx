import {
  Monda_400Regular,
  Monda_500Medium,
  Monda_600SemiBold,
  Monda_700Bold,
  useFonts as useMondaFonts,
} from '@expo-google-fonts/monda';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import '@/global.css';
import { AnimatedSplash } from '@/src/components';
import i18n from '@/src/i18n';
import { appHeaderTitleFontFamily } from '@/src/components';
import { ThemeProvider, useTheme } from '@/src/theme';

// Prevent native splash from auto-hiding
SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  anchor: '(tabs)',
};

function AppContent() {
  const { isDark, colors } = useTheme();
  const { t } = useTranslation();

  return (
    <>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTitleStyle: { fontFamily: appHeaderTitleFontFamily },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="settings"
          options={{
            presentation: 'modal',
            headerShown: true,
            title: t('settings.title'),
          }}
        />
        <Stack.Screen
          name="diagnostics"
          options={{
            presentation: 'card',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="recent-failures"
          options={{
            presentation: 'card',
            headerShown: true,
            title: t('failureLogs.title'),
          }}
        />
        <Stack.Screen
          name="private-videos"
          options={{
            presentation: 'card',
            headerShown: true,
            title: '',
          }}
        />
        <Stack.Screen
          name="private-player"
          options={{
            presentation: 'card',
            headerShown: false,
          }}
        />
      </Stack>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </>
  );
}

export default function RootLayout() {
  const [showSplash, setShowSplash] = useState(true);
  const [mondaLoaded] = useMondaFonts({
    Monda_400Regular,
    Monda_500Medium,
    Monda_600SemiBold,
    Monda_700Bold,
  });

  useEffect(() => {
    // Hide native splash once our layout is ready
    SplashScreen.hideAsync();
  }, []);

  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
  }, []);

  const appReady = !showSplash && mondaLoaded;

  if (!appReady) {
    return (
      <GestureHandlerRootView style={styles.root}>
        <AnimatedSplash onAnimationComplete={handleSplashComplete} />
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <AppContent />
        </ThemeProvider>
      </I18nextProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
