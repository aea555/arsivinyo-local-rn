import { Sixtyfour_400Regular, useFonts } from '@expo-google-fonts/sixtyfour';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Pressable,
  StyleSheet,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  getLocalPrivateModeState,
  cancelTask,
  downloadMedia,
  DownloadProgress,
  getLocalBackgroundState,
  listenBackgroundState,
  setLocalAudioModeEnabled,
  setLocalPrivateModeEnabled,
} from '@/src/api';
import type { DownloadState } from '@/src/api/types';
import { AppText as Text, DownloadButton } from '@/src/components';
import {
  downloadAndSaveFile,
  getUrlFromClipboard,
} from '@/src/services';
import { useTheme } from '@/src/theme';

/** How long a transient status line stays before clearing itself. */
const STATUS_MESSAGE_TTL_MS = 5000;

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
  const [downloadSpeedBytesPerSec, setDownloadSpeedBytesPerSec] = useState<number | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [backgroundServiceRunning, setBackgroundServiceRunning] = useState(false);
  const [backgroundQueueSize, setBackgroundQueueSize] = useState(0);
  const [privateModeEnabled, setPrivateModeEnabled] = useState(false);
  const [isPrivateToggleBusy, setIsPrivateToggleBusy] = useState(false);
  const [audioModeEnabled, setAudioModeEnabled] = useState(false);
  const speedEmaBytesPerSecRef = useRef<number | null>(null);
  const speedLogCounterRef = useRef(0);

  const isOngoingDownload =
    downloadState === 'starting' ||
    downloadState === 'downloading' ||
    downloadState === 'processing' ||
    downloadState === 'saving';

  const progressValue = (() => {
    if (!isOngoingDownload) return null;
    if (downloadState === 'processing' || downloadState === 'saving') {
      return null;
    }
    if (typeof downloadPercent === 'number') {
      return Math.max(0, Math.min(100, Math.round(downloadPercent)));
    }
    return 0;
  })();

  const speedValue = (() => {
    if (downloadState !== 'downloading') return null;
    if (typeof progressValue === 'number' && progressValue >= 99) return null;
    if (typeof downloadSpeedBytesPerSec !== 'number' || downloadSpeedBytesPerSec <= 0) return null;
    return downloadSpeedBytesPerSec / (1024 * 1024);
  })();

  const speedLabel = speedValue == null ? null : `${speedValue >= 10 ? speedValue.toFixed(1) : speedValue.toFixed(2)} MB/s`;

  useEffect(() => {
    let mounted = true;
    void getLocalBackgroundState()
      .then((state) => {
        if (!mounted) return;
        setBackgroundServiceRunning(state.serviceRunning);
        setBackgroundQueueSize(state.queueSize);
        setPrivateModeEnabled(Boolean(state.privateModeEnabled));
        setAudioModeEnabled(Boolean(state.audioModeEnabled));
      })
      .catch(() => undefined);

    void getLocalPrivateModeState()
      .then((state) => {
        if (!mounted) return;
        setPrivateModeEnabled(Boolean(state.enabled));
      })
      .catch(() => undefined);

    const sub = (() => {
      try {
        return listenBackgroundState((state) => {
          setBackgroundServiceRunning(Boolean(state.serviceRunning));
          setBackgroundQueueSize(state.queueSize || 0);
          if (typeof state.privateModeEnabled === 'boolean') {
            setPrivateModeEnabled(state.privateModeEnabled);
          }
          if (typeof state.audioModeEnabled === 'boolean') {
            setAudioModeEnabled(state.audioModeEnabled);
          }
        });
      } catch {
        return { remove: () => undefined };
      }
    })();

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const handleDownload = useCallback(async () => {
    try {
      // Reset state
      setDownloadState('starting');
      setStatusMessage('');
      setActiveTaskId(null);
      setDownloadPercent(0);
      setDownloadSpeedBytesPerSec(null);
      speedEmaBytesPerSecRef.current = null;
      speedLogCounterRef.current = 0;

      // Get URL from clipboard
      const url = await getUrlFromClipboard();
      if (!url) {
        setDownloadState('error');
        setStatusMessage(t('home.noUrlInClipboard'));
        setActiveTaskId(null);
        setDownloadPercent(null);
        setDownloadSpeedBytesPerSec(null);
        speedEmaBytesPerSecRef.current = null;
        setTimeout(() => setDownloadState('idle'), 3000);
        return;
      }

      // Start download via API
      const result = await downloadMedia(url, (progress: DownloadProgress) => {
        setDownloadState(progress.state);
        if (progress.taskId) {
          setActiveTaskId(progress.taskId);
        }
        if (progress.state === 'downloading') {
          if (typeof progress.progressPercent === 'number') {
            setDownloadPercent(progress.progressPercent);
            if (progress.progressPercent >= 99) {
              setDownloadSpeedBytesPerSec(null);
            }
          }
          if (typeof progress.speedBytesPerSec === 'number' && progress.speedBytesPerSec > 0) {
            if (typeof progress.progressPercent === 'number' && progress.progressPercent >= 99) {
              setDownloadSpeedBytesPerSec(null);
            } else {
              const alpha = 0.22;
              const prev = speedEmaBytesPerSecRef.current;
              const smoothed = prev == null
                ? progress.speedBytesPerSec
                : prev + alpha * (progress.speedBytesPerSec - prev);
              speedEmaBytesPerSecRef.current = smoothed;
              setDownloadSpeedBytesPerSec(smoothed);

              if (__DEV__) {
                speedLogCounterRef.current += 1;
                if (speedLogCounterRef.current % 8 === 0) {
                  const rawMb = progress.speedBytesPerSec / (1024 * 1024);
                  const smoothMb = smoothed / (1024 * 1024);
                  console.info(
                    `[Download][speed] raw=${rawMb.toFixed(2)}MB/s smoothed=${smoothMb.toFixed(2)}MB/s progress=${progress.progressPercent ?? 'n/a'}`
                  );
                }
              }
            }
          }
        } else if (progress.state === 'processing' || progress.state === 'saving') {
          setDownloadPercent(null);
          setDownloadSpeedBytesPerSec(null);
          speedEmaBytesPerSecRef.current = null;
        } else if (progress.state === 'starting') {
          setDownloadPercent(0);
          setDownloadSpeedBytesPerSec(null);
          speedEmaBytesPerSecRef.current = null;
        }
        if (progress.errorMessage) {
          setStatusMessage(progress.errorMessage);
        }
      }, audioModeEnabled ? 'public' : (privateModeEnabled ? 'private' : 'public'), audioModeEnabled ? 'audio' : 'video');

      console.info('Download response:', result);

      // Audio downloads are moved into the public music library natively, so there
      // is nothing to save to the gallery here.
      if (!result.isPrivate && !result.isAudio) {
        // Save local file to device gallery
        setDownloadState('saving');
        if (!result.localPath) {
          throw new Error(t('errors.FILE_NOT_FOUND'));
        }
        console.log('[HomeScreen] localPath:', result.localPath);
        console.log('[HomeScreen] filename:', result.filename);
        const saveResult = await downloadAndSaveFile(result.localPath, result.filename);
        console.log('[HomeScreen] downloadAndSaveFile returned:', saveResult);
      }

      // Success!
      setDownloadState('completed');
      setStatusMessage(result.isAudio ? t('home.savedToMusic') : result.isPrivate ? t('home.privateSaved') : result.filename);
      setDownloadPercent(100);
      setDownloadSpeedBytesPerSec(null);
      speedEmaBytesPerSecRef.current = null;

      // Reset after delay
      setTimeout(() => {
        setDownloadState('idle');
        setStatusMessage('');
        setActiveTaskId(null);
        setDownloadPercent(null);
        setDownloadSpeedBytesPerSec(null);
        speedEmaBytesPerSecRef.current = null;
      }, 3000);
    } catch (error) {
      const cancelCode = (error as { code?: string } | null)?.code;
      const isCancelled = cancelCode === 'DOWNLOAD_CANCELLED' || cancelCode === 'TASK_CANCELLED';
      if (isCancelled) {
        setDownloadState('idle');
        setStatusMessage(t('errors.DOWNLOAD_CANCELLED'));
        setActiveTaskId(null);
        setDownloadPercent(null);
        setDownloadSpeedBytesPerSec(null);
        speedEmaBytesPerSecRef.current = null;
        return;
      }

      console.error('Download error:', error);

      setDownloadState('error');
      setStatusMessage(t('home.downloadFailed'));
      setActiveTaskId(null);
      setDownloadPercent(null);
      setDownloadSpeedBytesPerSec(null);
      speedEmaBytesPerSecRef.current = null;
      setTimeout(() => setDownloadState('idle'), 3000);
    }
  }, [privateModeEnabled, audioModeEnabled, t]);

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

  const openPrivateVideos = useCallback(() => {
    router.push('/private-videos');
  }, [router]);

  const openSounds = useCallback(() => {
    // Cast: expo-router typed routes regenerate to include this screen at build time.
    router.push('/sounds' as Href);
  }, [router]);

  const handleToggleAudioMode = useCallback(async () => {
    const next = !audioModeEnabled;
    setAudioModeEnabled(next); // optimistic
    try {
      const result = await setLocalAudioModeEnabled(next);
      const resolved = Boolean(result.enabled);
      setAudioModeEnabled(resolved);
      // Audio mode forces public output, so enabling it clears private mode natively.
      if (resolved) setPrivateModeEnabled(false);
    } catch {
      setAudioModeEnabled(!next); // revert on failure
    }
  }, [audioModeEnabled]);

  // Intercept Android hardware / gesture back on the home screen: instead of letting
  // the app exit silently, ask for confirmation via our own modal. When the modal is
  // open it owns the back press (via onRequestClose), so this only fires from the bare
  // home screen.
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        setShowExitConfirm(true);
        return true;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => sub.remove();
    }, [])
  );

  // Transient feedback, so give it a lifetime. It was only ever cleared when a new
  // download started, which let a message outlive the thing it described: toggling
  // private mode on, then enabling audio mode (which clears private mode natively),
  // left "Private mode enabled" sitting under a chip that read OFF.
  useEffect(() => {
    if (!statusMessage) return;
    const timer = setTimeout(() => setStatusMessage(''), STATUS_MESSAGE_TTL_MS);
    return () => clearTimeout(timer);
  }, [statusMessage]);

  const handleTogglePrivateMode = useCallback(async () => {
    if (isPrivateToggleBusy) return;
    setIsPrivateToggleBusy(true);
    try {
      const nextEnabled = !privateModeEnabled;
      const result = await setLocalPrivateModeEnabled(nextEnabled);
      setPrivateModeEnabled(Boolean(result.enabled));
      setStatusMessage(
        result.enabled ? t('home.privateModeEnabled') : t('home.privateModeDisabled')
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : t('errors.UNKNOWN_ERROR');
      setStatusMessage(message);
    } finally {
      setIsPrivateToggleBusy(false);
    }
  }, [isPrivateToggleBusy, privateModeEnabled, t]);


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
            {/* Neon Title with Sixtyfour Font.
                A wordmark, not body text: it must never wrap or track the system font
                size. Sixtyfour is an unusually wide face, so at a 1.3x system font
                scale — common on Samsung — it overflowed and broke onto a second line.
                allowFontScaling stops the scale from applying, and the single line plus
                auto-shrink guarantees it fits whatever width is left after the header
                actions take theirs. */}
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
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
          <View style={styles.headerActions}>
            {/* Labelled, not icon-only. These three go to entirely different screens,
                and an icon alone gives no way to know which before tapping it. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('home.privateVault')}
              accessibilityHint={t('home.privateVaultHint')}
              onPress={openPrivateVideos}
              style={({ pressed }) => [
                styles.headerNavButton,
                { backgroundColor: pressed ? colors.surfaceHover : colors.surface },
              ]}
              hitSlop={6}
            >
              <Ionicons name="shield-checkmark-outline" size={19} color={colors.text} />
              <Text allowFontScaling={false} numberOfLines={1} style={[styles.headerNavLabel, { color: colors.textMuted }]}>
                {t('home.navVault')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('home.musicLibrary')}
              accessibilityHint={t('home.musicLibraryHint')}
              onPress={openSounds}
              style={({ pressed }) => [
                styles.headerNavButton,
                { backgroundColor: pressed ? colors.surfaceHover : colors.surface },
              ]}
              hitSlop={6}
            >
              <Ionicons name="musical-notes-outline" size={19} color={colors.text} />
              <Text allowFontScaling={false} numberOfLines={1} style={[styles.headerNavLabel, { color: colors.textMuted }]}>
                {t('home.navMusic')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('home.navSettings')}
              onPress={openSettings}
              style={({ pressed }) => [
                styles.headerNavButton,
                { backgroundColor: pressed ? colors.surfaceHover : colors.surface },
              ]}
              hitSlop={6}
            >
              <Ionicons name="settings-outline" size={19} color={colors.text} />
              <Text allowFontScaling={false} numberOfLines={1} style={[styles.headerNavLabel, { color: colors.textMuted }]}>
                {t('home.navSettings')}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Main Content */}
        <View style={styles.content}>
          <DownloadButton
            onPress={handleDownload}
            state={downloadState}
            disabled={downloadState !== 'idle' && downloadState !== 'error'}
          />

          {/* Modes sit WITH the download button because they modify what it does, not
              with navigation. They stay inline rather than behind a modal: the cost of
              not noticing private mode is a file saved somewhere you did not intend,
              so the state has to be readable without opening anything. State is carried
              by the label as well as the colour, so it does not depend on seeing hue. */}
          <View style={styles.modeRow}>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: privateModeEnabled, disabled: audioModeEnabled }}
              accessibilityLabel={privateModeEnabled ? t('home.privateModeOn') : t('home.privateModeOff')}
              accessibilityHint={privateModeEnabled ? t('home.privateModeHintOn') : t('home.privateModeHintOff')}
              onPress={handleTogglePrivateMode}
              disabled={isPrivateToggleBusy || audioModeEnabled}
              style={({ pressed }) => [
                styles.modeChip,
                {
                  backgroundColor: privateModeEnabled ? colors.accent + '1F' : (pressed ? colors.surfaceHover : colors.surface),
                  borderColor: privateModeEnabled ? colors.accent : colors.border,
                  opacity: (isPrivateToggleBusy || audioModeEnabled) ? 0.45 : 1,
                },
              ]}
            >
              {isPrivateToggleBusy ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Ionicons
                  name={privateModeEnabled ? 'lock-closed' : 'lock-open-outline'}
                  size={17}
                  color={privateModeEnabled ? colors.accent : colors.textMuted}
                />
              )}
              <Text numberOfLines={1} style={[styles.modeChipLabel, { color: privateModeEnabled ? colors.text : colors.textMuted }]}>
                {t('home.modePrivate')}
              </Text>
              <Text numberOfLines={1} style={[styles.modeChipState, { color: privateModeEnabled ? colors.accent : colors.textMuted }]}>
                {privateModeEnabled ? t('home.modeOn') : t('home.modeOff')}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: audioModeEnabled }}
              accessibilityLabel={audioModeEnabled ? t('home.audioModeOn') : t('home.audioModeOff')}
              accessibilityHint={audioModeEnabled ? t('home.audioModeHintOn') : t('home.audioModeHintOff')}
              onPress={handleToggleAudioMode}
              style={({ pressed }) => [
                styles.modeChip,
                {
                  backgroundColor: audioModeEnabled ? colors.accent + '1F' : (pressed ? colors.surfaceHover : colors.surface),
                  borderColor: audioModeEnabled ? colors.accent : colors.border,
                },
              ]}
            >
              <Ionicons
                name={audioModeEnabled ? 'musical-notes' : 'videocam-outline'}
                size={17}
                color={audioModeEnabled ? colors.accent : colors.textMuted}
              />
              <Text numberOfLines={1} style={[styles.modeChipLabel, { color: audioModeEnabled ? colors.text : colors.textMuted }]}>
                {t('home.modeAudio')}
              </Text>
              <Text numberOfLines={1} style={[styles.modeChipState, { color: audioModeEnabled ? colors.accent : colors.textMuted }]}>
                {audioModeEnabled ? t('home.modeOn') : t('home.modeOff')}
              </Text>
            </Pressable>
          </View>

          {/* Shown only while there is actually work. A permanent "Idle" line reports
              nothing and turns the modes into the middle of three stacked blocks. */}
          {backgroundServiceRunning ? (
            <View style={styles.statusLine}>
              <Ionicons name="cloud-download-outline" size={13} color={colors.accent} />
              <Text numberOfLines={1} style={[styles.statusLineText, { color: colors.textMuted }]}>
                {t('home.backgroundActive', { count: backgroundQueueSize })}
              </Text>
            </View>
          ) : null}

          {isOngoingDownload ? (
            <View style={styles.progressSection}>
              <Text style={[styles.progressText, { color: colors.text }]}>
                {downloadState === 'processing'
                  ? t('home.processing')
                  : downloadState === 'saving'
                    ? t('common.loading')
                    : t('home.downloadProgress', { percent: progressValue ?? 0 })}
              </Text>
              {progressValue !== null ? (
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
              ) : (
                <ActivityIndicator size="small" color={colors.accent} />
              )}
              {speedLabel ? (
                <Text style={[styles.speedText, { color: colors.textMuted }]}>
                  {speedLabel}
                </Text>
              ) : null}
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

        <Modal
          visible={showExitConfirm}
          transparent
          animationType="fade"
          onRequestClose={() => setShowExitConfirm(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>{t('home.exitTitle')}</Text>
              <Text style={[styles.modalMessage, { color: colors.textMuted }]}>{t('home.exitMessage')}</Text>

              <View style={styles.modalActions}>
                <Pressable
                  onPress={() => setShowExitConfirm(false)}
                  style={({ pressed }) => [
                    styles.modalButton,
                    { backgroundColor: pressed ? colors.surfaceHover : colors.surface, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.modalButtonText, { color: colors.text }]}>{t('common.cancel')}</Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    setShowExitConfirm(false);
                    BackHandler.exitApp();
                  }}
                  style={({ pressed }) => [
                    styles.modalButton,
                    { backgroundColor: pressed ? colors.error + '22' : colors.error + '16', borderColor: colors.error + '66' },
                  ]}
                >
                  <Text style={[styles.modalButtonText, { color: colors.error }]}>{t('home.exitConfirm')}</Text>
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  headerNavButton: {
    minWidth: 52,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  // Fixed size: these labels must not grow with the system font setting or they push
  // the wordmark out of the header.
  headerNavLabel: { fontSize: 9, fontWeight: '600', letterSpacing: 0.2 },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 60,
  },
  // Content-width and centred rather than a grid of flex:1 cells. A two-across grid
  // only looks right at an even count — a third toggle would strand one on its own row
  // — and full-width cells fight a screen composed around a single centred focal point.
  modeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
    paddingHorizontal: 20,
  },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 14,
    minHeight: 40,
  },
  modeChipLabel: { fontSize: 13, fontWeight: '600' },
  modeChipState: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  statusLineText: { fontSize: 11 },
  actionTextBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  actionSubtitle: {
    fontSize: 11.5,
    fontWeight: '500',
  },
  actionTrailing: {
    marginLeft: 10,
  },
  modeBadge: {
    minWidth: 58,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignItems: 'center',
    justifyContent: 'center',
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
  speedText: {
    fontSize: 12,
    fontWeight: '600',
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
