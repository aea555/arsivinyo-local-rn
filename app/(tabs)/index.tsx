import { Sixtyfour_400Regular, useFonts } from '@expo-google-fonts/sixtyfour';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { downloadMedia, DownloadProgress } from '@/src/api';
import type { DownloadState } from '@/src/api/types';
import { BannerAd, DownloadButton } from '@/src/components';
import {
  downloadAndSaveFile,
  getUrlFromClipboard,
  incrementDownloadCount,
  resetDownloadCount,
  shouldShowInterstitialAd
} from '@/src/services';
import { useTheme } from '@/src/theme';

export default function HomeScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    Sixtyfour_400Regular,
  });

  const [downloadState, setDownloadState] = useState<DownloadState>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');

  const handleDownload = useCallback(async () => {
    try {
      // Reset state
      setDownloadState('starting');
      setStatusMessage('');

      // Get URL from clipboard
      const url = await getUrlFromClipboard();
      if (!url) {
        setDownloadState('error');
        setStatusMessage(t('home.noUrlInClipboard'));
        setTimeout(() => setDownloadState('idle'), 3000);
        return;
      }

      // Start download via API
      const result = await downloadMedia(url, (progress: DownloadProgress) => {
        setDownloadState(progress.state);
        if (progress.errorMessage) {
          setStatusMessage(progress.errorMessage);
        }
      });

      console.info('Download response:', result);

      // Save local file to device gallery
      setDownloadState('saving');
      console.log('[HomeScreen] localPath:', result.localPath);
      console.log('[HomeScreen] filename:', result.filename);

      const saveResult = await downloadAndSaveFile(result.localPath, result.filename);
      console.log('[HomeScreen] downloadAndSaveFile returned:', saveResult);

      // Success!
      setDownloadState('completed');
      setStatusMessage(result.filename);

      // Track download for ads
      await incrementDownloadCount();
      const showAd = await shouldShowInterstitialAd();
      if (showAd) {
        // TODO: Show interstitial ad here
        await resetDownloadCount();
      }

      // Reset after delay
      setTimeout(() => {
        setDownloadState('idle');
        setStatusMessage('');
      }, 3000);
    } catch (error) {
      console.error('Download error:', error);

      setDownloadState('error');
      setStatusMessage(
        error instanceof Error ? error.message : t('errors.UNKNOWN_ERROR')
      );
      setTimeout(() => setDownloadState('idle'), 3000);
    }
  }, [t]);

  const openSettings = useCallback(() => {
    router.push('/settings');
  }, [router]);

  return (
    <LinearGradient
      colors={[colors.background, colors.accent + '15', colors.background]}
      locations={[0, 0.5, 1]}
      style={styles.gradient}
    >
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {/* Neon Title with Sixtyfour Font */}
            <Text
              style={[
                styles.title,
                {
                  color: colors.accent,
                  textShadowColor: colors.accent,
                  textShadowOffset: { width: 0, height: 0 },
                  textShadowRadius: 15,
                  fontFamily: fontsLoaded ? 'Sixtyfour_400Regular' : undefined,
                },
              ]}
            >
              {t('common.appName')}
            </Text>
          </View>
          <Pressable
            onPress={openSettings}
            style={({ pressed }) => [
              styles.settingsButton,
              { backgroundColor: pressed ? colors.surfaceHover : colors.surface },
            ]}
            hitSlop={8}
          >
            <Ionicons name="settings-outline" size={22} color={colors.text} />
          </Pressable>
        </View>

        {/* Main Content */}
        <View style={styles.content}>
          <DownloadButton
            onPress={handleDownload}
            state={downloadState}
            disabled={downloadState !== 'idle' && downloadState !== 'error'}
          />

          {statusMessage ? (
            <Text
              style={[
                styles.statusMessage,
                {
                  color:
                    downloadState === 'error'
                      ? colors.error
                      : downloadState === 'completed'
                        ? colors.success
                        : colors.textMuted,
                },
              ]}
            >
              {statusMessage}
            </Text>
          ) : null}
        </View>

        {/* Banner Ad */}
        <BannerAd />
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    overflow: 'visible',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'visible',
    flex: 1,
    marginRight: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '400',
    letterSpacing: 2,
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 60,
  },
  statusMessage: {
    marginTop: 24,
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 280,
  },
});
