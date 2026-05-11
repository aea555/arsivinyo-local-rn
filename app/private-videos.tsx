import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  authenticateLocalPrivateAccess,
  copyLocalPrivateVideoToPublicGallery,
  deleteLocalPrivateVideo,
  listLocalPrivateVideos,
  pickAndImportLocalVideoToPrivateVault,
  prepareLocalPrivatePlayback,
} from '@/src/api';
import { AppText as Text } from '@/src/components';
import { createSession } from '@/src/features/privatePlayback/sessionStore';
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
  const router = useRouter();
  const [items, setItems] = useState<LocalPrivateVideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [unlocking, setUnlocking] = useState(false);
  const [locked, setLocked] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'play' | 'copy' | 'delete' | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LocalPrivateVideoItem | null>(null);
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
          'PRIVATE_PLAYER_SESSION_INVALID',
          'PRIVATE_AUTH_FAILED',
          'PRIVATE_MODE_UNAVAILABLE',
          'PRIVATE_STORAGE_WRITE_FAILED',
          'PRIVATE_IMPORT_PICK_CANCELLED',
          'PRIVATE_IMPORT_FAILED',
          'PRIVATE_IMPORT_UNSUPPORTED_TYPE',
          'PRIVATE_PUBLIC_COPY_FAILED',
          'PRIVATE_PUBLIC_COPY_LEGACY_UNSUPPORTED',
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
    async (purpose: 'view' | 'delete' | 'unprivate' | 'import' | 'export') => {
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
      return () => undefined;
    }, [unlockAndLoad])
  );

  const emptyMessage = useMemo(() => {
    if (loading) return null;
    if (error) return error;
    return t('privateVault.empty');
  }, [error, loading, t]);

  const importFromGallery = useCallback(async () => {
    if (isImporting) return;
    setIsImporting(true);
    setError(null);
    try {
      devLog('import start');
      await ensureAuth('import');
      const result = await pickAndImportLocalVideoToPrivateVault();
      devLog('import result', result);
      if (!result.success) {
        if (result.code === 'PRIVATE_IMPORT_PICK_CANCELLED') {
          return;
        }
        throw new Error(result.code || 'PRIVATE_IMPORT_FAILED');
      }
      await loadPrivateVideos();
    } catch (e) {
      devLog('import failed', e);
      setError(resolveErrorMessage(e, 'PRIVATE_IMPORT_FAILED'));
    } finally {
      setIsImporting(false);
    }
  }, [devLog, ensureAuth, isImporting, loadPrivateVideos, resolveErrorMessage]);

  const confirmDelete = useCallback(
    (item: LocalPrivateVideoItem) => {
      setDeleteTarget(item);
    },
    []
  );

  const closeDeleteModal = useCallback(() => {
    if (busyAction === 'delete') return;
    setDeleteTarget(null);
  }, [busyAction]);

  const runDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const item = deleteTarget;
    setBusyId(item.id);
    setBusyAction('delete');
    setError(null);
    try {
      devLog(`delete start id=${item.id}`);
      await ensureAuth('delete');
      const result = await deleteLocalPrivateVideo(item.id);
      devLog(`delete result id=${item.id}`, result);
      if (!result.success) {
        throw new Error(t('errors.PRIVATE_VIDEO_NOT_FOUND'));
      }
      await loadPrivateVideos();
      setDeleteTarget(null);
    } catch (e) {
      devLog(`delete failed id=${item.id}`, e);
      setError(e instanceof Error ? e.message : t('errors.UNKNOWN_ERROR'));
      setDeleteTarget(null);
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  }, [deleteTarget, devLog, ensureAuth, loadPrivateVideos, t]);

  const deletePending = useMemo(() => {
    if (!deleteTarget) return false;
    return busyAction === 'delete' && busyId === deleteTarget.id;
  }, [busyAction, busyId, deleteTarget]);

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
        stage = 'prepare_done';
        const session = createSession({
          itemId: item.id,
          title: item.title,
          tempUri: prepared.tempUri,
          mimeType: prepared.mimeType,
          traceId,
        });
        devLog(`play session_created trace=${traceId} sid=${session.sid} id=${item.id}`);
        stage = 'player_route_open';
        router.push({
          pathname: '/private-player',
          params: { sid: session.sid },
        });
        devLog(`play player_route_open trace=${traceId} sid=${session.sid} id=${item.id}`);
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
    [devLog, ensureAuth, resolveErrorMessage, router, t]
  );

  const copyToGallery = useCallback(
    async (item: LocalPrivateVideoItem) => {
      setBusyId(item.id);
      setBusyAction('copy');
      setError(null);
      try {
        devLog(`copy start id=${item.id}`);
        await ensureAuth('export');
        const result = await copyLocalPrivateVideoToPublicGallery(item.id);
        devLog(`copy result id=${item.id}`, result);
        if (!result.success) {
          throw new Error(result.code || 'PRIVATE_PUBLIC_COPY_FAILED');
        }
      } catch (e) {
        devLog(`copy failed id=${item.id}`, e);
        setError(resolveErrorMessage(e, 'PRIVATE_PUBLIC_COPY_FAILED'));
      } finally {
        setBusyId(null);
        setBusyAction(null);
      }
    },
    [devLog, ensureAuth, resolveErrorMessage]
  );

  const deleteModalVisible = !!deleteTarget;
  const deleteMessage = deleteTarget
    ? t('privateVault.deleteMessage', { title: deleteTarget.title })
    : '';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Modal transparent animationType="fade" visible={deleteModalVisible} onRequestClose={closeDeleteModal}>
        <View style={[styles.deleteModalBackdrop, { backgroundColor: colors.background + 'CC' }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeDeleteModal} disabled={deletePending} />
          <View
            style={[
              styles.deleteModalCard,
              { borderColor: colors.border, backgroundColor: colors.surfaceHover },
            ]}
          >
            <View style={[styles.deleteIconWrap, { borderColor: colors.error + '55', backgroundColor: colors.error + '16' }]}>
              <Ionicons name="trash-outline" size={18} color={colors.error} />
            </View>
            <Text style={[styles.deleteModalTitle, { color: colors.text }]}>
              {t('privateVault.deleteTitle')}
            </Text>
            <Text style={[styles.deleteModalMessage, { color: colors.textMuted }]}>
              {deleteMessage}
            </Text>
            <View style={styles.deleteModalActions}>
              <Pressable
                onPress={closeDeleteModal}
                disabled={deletePending}
                style={({ pressed }) => [
                  styles.deleteModalButton,
                  {
                    borderColor: colors.border,
                    backgroundColor: pressed ? colors.surface : colors.surfaceHover,
                    opacity: deletePending ? 0.65 : 1,
                  },
                ]}
              >
                <Text style={[styles.deleteModalButtonText, { color: colors.text }]}>
                  {t('common.cancel')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void runDelete()}
                disabled={deletePending}
                style={({ pressed }) => [
                  styles.deleteModalButton,
                  {
                    borderColor: colors.error + '66',
                    backgroundColor: pressed ? colors.error + '22' : colors.error + '16',
                    opacity: deletePending ? 0.8 : 1,
                  },
                ]}
              >
                {deletePending ? (
                  <ActivityIndicator size="small" color={colors.error} />
                ) : (
                  <Text style={[styles.deleteModalButtonText, { color: colors.error }]}>
                    {t('privateVault.deleteAction')}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>{t('privateVault.title')}</Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>{t('privateVault.subtitle')}</Text>
      </View>

      {!locked ? (
        <View style={styles.toolbar}>
          <Pressable
            onPress={() => void importFromGallery()}
            disabled={isImporting}
            style={({ pressed }) => [
              styles.importButton,
              {
                borderColor: colors.border,
                backgroundColor: pressed ? colors.surfaceHover : colors.surface,
                opacity: isImporting ? 0.7 : 1,
              },
            ]}
          >
            {isImporting ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Ionicons name="images-outline" size={16} color={colors.text} />
            )}
            <Text style={[styles.actionText, { color: colors.text }]}>
              {t('privateVault.importFromGallery')}
            </Text>
          </Pressable>
        </View>
      ) : null}

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
            const copyBusy = busy && busyAction === 'copy';
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
                    onPress={() => void copyToGallery(item)}
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
                    {copyBusy ? (
                      <ActivityIndicator size="small" color={colors.text} />
                    ) : (
                      <Text style={[styles.actionText, { color: colors.text }]}>
                        {t('privateVault.copyToGalleryAction')}
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
  deleteModalBackdrop: {
    flex: 1,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteModalCard: {
    width: '100%',
    maxWidth: 380,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 10,
  },
  deleteIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  deleteModalMessage: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  deleteModalActions: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  deleteModalButton: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  deleteModalButtonText: {
    fontSize: 13,
    fontWeight: '700',
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
  toolbar: {
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 8,
  },
  importButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
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
    flexWrap: 'wrap',
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
