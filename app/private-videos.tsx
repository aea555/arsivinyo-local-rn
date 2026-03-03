import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  authenticateLocalPrivateAccess,
  clearLocalPrivatePlaybackCache,
  deleteLocalPrivateVideo,
  listLocalPrivateVideos,
  openLocalPrivatePlayback,
  prepareLocalPrivatePlayback,
} from '@/src/api';
import type { LocalPrivateVideoItem } from '@/src/native/localDownloader';
import { useTheme } from '@/src/theme';

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(timestamp: number): string {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString();
}

async function withTimeout<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  const startedAt = Date.now();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(code)), ms);
  });
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (__DEV__) {
      console.log(`[PrivateVault] timeout-guard finish code=${code} elapsedMs=${Date.now() - startedAt}`);
    }
  }
}

export default function PrivateVideosScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [items, setItems] = useState<LocalPrivateVideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [unlocking, setUnlocking] = useState(false);
  const [locked, setLocked] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'play' | 'delete' | null>(null);
  const devLog = useCallback((message: string, data?: unknown) => {
    if (!__DEV__) return;
    if (data === undefined) {
      console.log(`[PrivateVault] ${message}`);
      return;
    }
    console.log(`[PrivateVault] ${message}`, data);
  }, []);

  const authReasonToMessage = useCallback(
    (reason?: string) => {
      if (!reason) return t('errors.PRIVATE_AUTH_FAILED');
      const localized = t(`errors.${reason}`);
      return localized === `errors.${reason}` ? t('errors.PRIVATE_AUTH_FAILED') : localized;
    },
    [t]
  );

  const resolveErrorMessage = useCallback(
    (error: unknown, fallbackCode: string = 'UNKNOWN_ERROR') => {
      if (error instanceof Error) {
        const knownCodes = [
          'PRIVATE_LEGACY_VAULT_UNSUPPORTED',
          'PRIVATE_VIDEO_NOT_FOUND',
          'PRIVATE_AUTH_FAILED',
          'PRIVATE_MODE_UNAVAILABLE',
          'PRIVATE_STORAGE_WRITE_FAILED',
        ];
        const matched = knownCodes.find((code) => error.message.includes(code));
        if (matched) {
          const localized = t(`errors.${matched}`);
          if (localized !== `errors.${matched}`) return localized;
        }
        return error.message;
      }
      const localizedFallback = t(`errors.${fallbackCode}`);
      return localizedFallback === `errors.${fallbackCode}` ? t('errors.UNKNOWN_ERROR') : localizedFallback;
    },
    [t]
  );

  const ensureAuth = useCallback(
    async (purpose: 'view' | 'delete' | 'unprivate') => {
      devLog(`auth start purpose=${purpose}`);
      const auth = await authenticateLocalPrivateAccess(purpose);
      devLog(`auth result purpose=${purpose}`, auth);
      if (!auth.granted) {
        throw new Error(authReasonToMessage(auth.reason));
      }
    },
    [authReasonToMessage, devLog]
  );

  const loadPrivateVideos = useCallback(async () => {
    devLog('list start');
    setLoading(true);
    setError(null);
    try {
      const result = await listLocalPrivateVideos();
      devLog(`list success count=${result.length}`);
      setItems(result);
    } catch (e) {
      devLog('list failed', e);
      setError(e instanceof Error ? e.message : t('errors.UNKNOWN_ERROR'));
    } finally {
      setLoading(false);
    }
  }, [devLog, t]);

  const unlockAndLoad = useCallback(async () => {
    devLog('unlockAndLoad start');
    setUnlocking(true);
    setError(null);
    try {
      await ensureAuth('view');
      setLocked(false);
      await loadPrivateVideos();
      devLog('unlockAndLoad success');
    } catch (e) {
      devLog('unlockAndLoad failed', e);
      setLocked(true);
      setItems([]);
      setLoading(false);
      setError(e instanceof Error ? e.message : t('errors.PRIVATE_AUTH_FAILED'));
    } finally {
      setUnlocking(false);
    }
  }, [devLog, ensureAuth, loadPrivateVideos, t]);

  useFocusEffect(
    useCallback(() => {
      void unlockAndLoad();
      return () => {
        void clearLocalPrivatePlaybackCache().catch(() => undefined);
      };
    }, [unlockAndLoad])
  );

  const emptyMessage = useMemo(() => {
    if (loading) return null;
    if (error) return error;
    return t('privateVault.empty');
  }, [error, loading, t]);

  const confirmDelete = useCallback(
    (item: LocalPrivateVideoItem) => {
      Alert.alert(
        t('privateVault.deleteTitle'),
        t('privateVault.deleteMessage', { title: item.title }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('privateVault.deleteAction'),
            style: 'destructive',
            onPress: () => {
              void (async () => {
                setBusyId(item.id);
                setBusyAction('delete');
                try {
                  devLog(`delete start id=${item.id}`);
                  await ensureAuth('delete');
                  const result = await deleteLocalPrivateVideo(item.id);
                  devLog(`delete result id=${item.id}`, result);
                  if (!result.success) {
                    throw new Error(t('errors.PRIVATE_VIDEO_NOT_FOUND'));
                  }
                  await loadPrivateVideos();
                } catch (e) {
                  devLog(`delete failed id=${item.id}`, e);
                  setError(e instanceof Error ? e.message : t('errors.UNKNOWN_ERROR'));
                } finally {
                  setBusyId(null);
                  setBusyAction(null);
                }
              })();
            },
          },
        ]
      );
    },
    [devLog, ensureAuth, loadPrivateVideos, t]
  );

  const playVideo = useCallback(
    async (item: LocalPrivateVideoItem) => {
      const traceId = `pv_${item.id.slice(0, 8)}_${Date.now().toString(36)}`;
      const startedAt = Date.now();
      let stage = 'init';
      let watchdog: ReturnType<typeof setInterval> | null = null;
      setBusyId(item.id);
      setBusyAction('play');
      setError(null);
      try {
        devLog(`play start trace=${traceId} id=${item.id}`);
        if (item.cipherVersion === 'v1') {
          throw new Error('PRIVATE_LEGACY_VAULT_UNSUPPORTED');
        }
        if (__DEV__) {
          watchdog = setInterval(() => {
            devLog(
              `play watchdog trace=${traceId} stage=${stage} elapsedMs=${Date.now() - startedAt}`
            );
          }, 3000);
        }
        stage = 'auth';
        await ensureAuth('view');
        stage = 'prepare';
        const prepared = await withTimeout(
          prepareLocalPrivatePlayback(item.id, traceId),
          300_000,
          'PRIVATE_VIDEO_NOT_FOUND'
        );
        devLog(`play prepared trace=${traceId} id=${item.id}`, prepared);
        if (!prepared.success || !prepared.tempUri) {
          throw new Error(t('errors.PRIVATE_VIDEO_NOT_FOUND'));
        }
        stage = 'open-player';
        const opened = await withTimeout(
          openLocalPrivatePlayback(prepared.tempUri, item.title, traceId),
          8_000,
          'PRIVATE_VIDEO_NOT_FOUND'
        );
        devLog(`play opened trace=${traceId} id=${item.id}`, opened);
        if (!opened.success) {
          throw new Error(t('errors.PRIVATE_VIDEO_NOT_FOUND'));
        }
        stage = 'done';
      } catch (e) {
        devLog(`play failed trace=${traceId} id=${item.id} stage=${stage}`, e);
        setError(resolveErrorMessage(e, 'PRIVATE_VIDEO_NOT_FOUND'));
      } finally {
        if (watchdog) {
          clearInterval(watchdog);
        }
        devLog(`play finish trace=${traceId} id=${item.id} stage=${stage} elapsedMs=${Date.now() - startedAt}`);
        setBusyId(null);
        setBusyAction(null);
      }
    },
    [devLog, ensureAuth, resolveErrorMessage]
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}> 
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>{t('privateVault.title')}</Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>{t('privateVault.subtitle')}</Text>
      </View>

      {unlocking ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>
            {t('privateVault.unlocking')}
          </Text>
        </View>
      ) : locked ? (
        <View style={styles.centered}>
          <Ionicons name="lock-closed-outline" size={34} color={colors.textMuted} />
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>
            {error || t('privateVault.lockedMessage')}
          </Text>
          <Pressable
            onPress={() => void unlockAndLoad()}
            style={({ pressed }) => [
              styles.unlockButton,
              {
                borderColor: colors.border,
                backgroundColor: pressed ? colors.surfaceHover : colors.surface,
              },
            ]}
          >
            <Text style={[styles.actionText, { color: colors.text }]}>{t('privateVault.unlockAction')}</Text>
          </Pressable>
        </View>
      ) : loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="lock-closed-outline" size={32} color={colors.textMuted} />
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>{emptyMessage}</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const busy = busyId === item.id;
            const playBusy = busy && busyAction === 'play';
            const deleteBusy = busy && busyAction === 'delete';
            const legacyV1 = item.cipherVersion === 'v1';
            return (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
                <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={[styles.meta, { color: colors.textMuted }]}>
                  {t('privateVault.createdAt', { value: formatDate(item.createdAt) })}
                </Text>
                <Text style={[styles.meta, { color: colors.textMuted }]}>
                  {t('privateVault.size', { value: formatSize(item.sizeBytesEncrypted) })}
                </Text>
                {legacyV1 ? (
                  <Text style={[styles.legacyMeta, { color: colors.error }]}>
                    {t('errors.PRIVATE_LEGACY_VAULT_UNSUPPORTED')}
                  </Text>
                ) : null}

                <View style={styles.actionsRow}>
                  <Pressable
                    onPress={() => void playVideo(item)}
                    disabled={busy || legacyV1}
                    style={({ pressed }) => [
                      styles.actionButton,
                      {
                        borderColor: colors.border,
                        backgroundColor: pressed ? colors.surfaceHover : colors.surface,
                        opacity: busy || legacyV1 ? 0.7 : 1,
                      },
                    ]}
                  >
                    {playBusy ? (
                      <ActivityIndicator size="small" color={colors.text} />
                    ) : (
                      <Text style={[styles.actionText, { color: colors.text }]}>
                        {t('privateVault.playAction')}
                      </Text>
                    )}
                  </Pressable>

                  <Pressable
                    onPress={() => confirmDelete(item)}
                    disabled={busy}
                    style={({ pressed }) => [
                      styles.actionButton,
                      {
                        borderColor: colors.error + '66',
                        backgroundColor: pressed ? colors.error + '22' : colors.error + '16',
                        opacity: busy ? 0.7 : 1,
                      },
                    ]}
                  >
                    {deleteBusy ? (
                      <ActivityIndicator size="small" color={colors.error} />
                    ) : (
                      <Text style={[styles.actionText, { color: colors.error }]}>{t('privateVault.deleteAction')}</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 6,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 20,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 10,
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  meta: {
    fontSize: 12,
  },
  legacyMeta: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '600',
  },
  actionsRow: {
    marginTop: 6,
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  unlockButton: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
});
