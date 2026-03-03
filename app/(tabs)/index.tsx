import { Sixtyfour_400Regular, useFonts } from '@expo-google-fonts/sixtyfour';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { cancelTask, downloadMedia, DownloadProgress } from '@/src/api';
import type { DownloadState } from '@/src/api/types';
import { BannerAd, DownloadButton } from '@/src/components';
import {
  downloadAndSaveFile,
  getUrlFromClipboard,
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
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const isOngoingDownload =
    downloadState === 'starting' ||
    downloadState === 'downloading' ||
    downloadState === 'processing' ||
    downloadState === 'saving';

  const progressValue = (() => {
    if (!isOngoingDownload) return null;
    if (typeof downloadPercent === 'number') {
      return Math.max(0, Math.min(100, Math.round(downloadPercent)));
    }
    if (downloadState === 'processing') return 95;
    if (downloadState === 'saving') return 99;
    return 0;
  })();

  const handleDownload = useCallback(async () => {
    try {
      // Reset state
      setDownloadState('starting');
      setStatusMessage('');
      setActiveTaskId(null);
      setDownloadPercent(0);

      // Get URL from clipboard
      const url = await getUrlFromClipboard();
      if (!url) {
        setDownloadState('error');
        setStatusMessage(t('home.noUrlInClipboard'));
        setActiveTaskId(null);
        setDownloadPercent(null);
        setTimeout(() => setDownloadState('idle'), 3000);
        return;
      }

      // Start download via API
      const result = await downloadMedia(url, (progress: DownloadProgress) => {
        setDownloadState(progress.state);
        if (progress.taskId) {
          setActiveTaskId(progress.taskId);
        }
        if (typeof progress.progressPercent === 'number') {
          setDownloadPercent(progress.progressPercent);
        } else if (progress.state === 'processing') {
          setDownloadPercent((prev) => (typeof prev === 'number' ? Math.max(prev, 95) : 95));
        } else if (progress.state === 'saving') {
          setDownloadPercent((prev) => (typeof prev === 'number' ? Math.max(prev, 99) : 99));
        }
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
      setDownloadPercent(100);

      // Reset after delay
      setTimeout(() => {
        setDownloadState('idle');
        setStatusMessage('');
        setActiveTaskId(null);
        setDownloadPercent(null);
      }, 3000);
    } catch (error) {
      const cancelCode = (error as { code?: string } | null)?.code;
      const isCancelled = cancelCode === 'DOWNLOAD_CANCELLED' || cancelCode === 'TASK_CANCELLED';
      if (isCancelled) {
        setDownloadState('idle');
        setStatusMessage(t('errors.DOWNLOAD_CANCELLED'));
        setActiveTaskId(null);
        setDownloadPercent(null);
        return;
      }

      console.error('Download error:', error);

      setDownloadState('error');
      setStatusMessage(
        error instanceof Error ? error.message : t('errors.UNKNOWN_ERROR')
      );
      setActiveTaskId(null);
      setDownloadPercent(null);
      setTimeout(() => setDownloadState('idle'), 3000);
    }
  }, [t]);

  const openCancelConfirm = useCallback(() => {
    if (!activeTaskId || !isOngoingDownload) return;
    setShowCancelConfirm(true);
  }, [activeTaskId, isOngoingDownload]);

  const closeCancelConfirm = useCallback(() => {
    if (isCancelling) return;
    setShowCancelConfirm(false);
  }, [isCancelling]);

  const confirmCancelDownload = useCallback(async () => {
    if (!activeTaskId) {
      setShowCancelConfirm(false);
      return;
    }
    setIsCancelling(true);
    try {
      const result = await cancelTask(activeTaskId);
      if (!result.success) {
        setStatusMessage(t('home.cancelRequestFailed'));
      }
    } catch {
      setStatusMessage(t('home.cancelRequestFailed'));
    } finally {
      setIsCancelling(false);
      setShowCancelConfirm(false);
    }
  }, [activeTaskId, t]);

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

          {isOngoingDownload && progressValue !== null ? (
            <View style={styles.progressSection}>
              <Text style={[styles.progressText, { color: colors.text }]}>
                {t('home.downloadProgress', { percent: progressValue })}
              </Text>
              <View style={[styles.progressTrack, { backgroundColor: colors.surfaceHover }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${progressValue}%`,
                      backgroundColor: colors.accent,
                    },
                  ]}
                />
              </View>
            </View>
          ) : null}

          {isOngoingDownload && activeTaskId ? (
            <Pressable
              onPress={openCancelConfirm}
              style={({ pressed }) => [
                styles.cancelButton,
                {
                  backgroundColor: pressed ? colors.error + '22' : colors.error + '16',
                  borderColor: colors.error + '66',
                },
              ]}
            >
              <Ionicons name="close-circle-outline" size={18} color={colors.error} />
              <Text style={[styles.cancelButtonText, { color: colors.error }]}>
                {t('home.cancelDownload')}
              </Text>
            </Pressable>
          ) : null}

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

        <Modal
          visible={showCancelConfirm}
          transparent
          animationType="fade"
          onRequestClose={closeCancelConfirm}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {t('home.cancelDownloadTitle')}
              </Text>
              <Text style={[styles.modalMessage, { color: colors.textMuted }]}>
                {t('home.cancelDownloadMessage')}
              </Text>

              <View style={styles.modalActions}>
                <Pressable
                  onPress={closeCancelConfirm}
                  disabled={isCancelling}
                  style={({ pressed }) => [
                    styles.modalButton,
                    {
                      backgroundColor: pressed ? colors.surfaceHover : colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.modalButtonText, { color: colors.text }]}>{t('common.cancel')}</Text>
                </Pressable>

                <Pressable
                  onPress={confirmCancelDownload}
                  disabled={isCancelling}
                  style={({ pressed }) => [
                    styles.modalButton,
                    {
                      backgroundColor: pressed ? colors.error + '22' : colors.error + '16',
                      borderColor: colors.error + '66',
                    },
                  ]}
                >
                  {isCancelling ? (
                    <ActivityIndicator size="small" color={colors.error} />
                  ) : (
                    <Text style={[styles.modalButtonText, { color: colors.error }]}>
                      {t('home.confirmCancelDownload')}
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
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
  progressSection: {
    width: 260,
    marginTop: 18,
    alignItems: 'center',
    gap: 10,
  },
  progressText: {
    fontSize: 13,
    fontWeight: '600',
  },
  progressTrack: {
    width: '100%',
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  cancelButton: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cancelButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  modalMessage: {
    fontSize: 14,
    lineHeight: 20,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 6,
  },
  modalButton: {
    minWidth: 110,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  modalButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
