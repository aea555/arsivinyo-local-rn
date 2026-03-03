import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { clearLocalPrivatePlaybackCache, setLocalSecureScreen } from '@/src/api';
import { deleteSession, getSession } from '@/src/features/privatePlayback/sessionStore';
import { useTheme } from '@/src/theme';

export default function PrivatePlayerScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ sid?: string | string[] }>();

  const sid = useMemo(() => {
    if (Array.isArray(params.sid)) return params.sid[0] ?? '';
    return params.sid ?? '';
  }, [params.sid]);

  const session = useMemo(() => getSession(sid), [sid]);
  const [firstFrameRendered, setFirstFrameRendered] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const player = useVideoPlayer(
    session ? { uri: session.tempUri, useCaching: false } : null,
    (instance) => {
      instance.loop = false;
      instance.muted = false;
      instance.timeUpdateEventInterval = 0.5;
      instance.staysActiveInBackground = false;
      instance.showNowPlayingNotification = false;
      instance.play();
    }
  );

  useEffect(() => {
    if (!session) return;
    const subscription = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'error') {
        setPlayerError(error?.message || 'PRIVATE_VIDEO_NOT_FOUND');
      }
      if (status === 'readyToPlay' && !player.playing) {
        player.play();
      }
    });
    return () => subscription.remove();
  }, [player, session]);

  useEffect(() => {
    void setLocalSecureScreen(true).catch(() => undefined);
    return () => {
      void setLocalSecureScreen(false).catch(() => undefined);
      deleteSession(sid);
      void clearLocalPrivatePlaybackCache().catch(() => undefined);
    };
  }, [sid]);

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/private-videos');
  };

  const retryPlayback = async () => {
    if (!session) return;
    setPlayerError(null);
    setFirstFrameRendered(false);
    try {
      await player.replaceAsync({ uri: session.tempUri, useCaching: false });
      player.play();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PRIVATE_VIDEO_NOT_FOUND';
      setPlayerError(message);
    }
  };

  if (!session) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: colors.error }]}>
            {t('errors.PRIVATE_PLAYER_SESSION_INVALID')}
          </Text>
          <Pressable
            onPress={goBack}
            style={({ pressed }) => [
              styles.button,
              {
                borderColor: colors.border,
                backgroundColor: pressed ? colors.surfaceHover : colors.surface,
              },
            ]}
          >
            <Text style={[styles.buttonText, { color: colors.text }]}>{t('privateVault.playerBack')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#000' }]}>
      <View style={styles.playerContainer}>
        <VideoView
          player={player}
          style={styles.player}
          nativeControls
          contentFit="contain"
          surfaceType="surfaceView"
          allowsPictureInPicture={false}
          fullscreenOptions={{
            enable: true,
            orientation: 'landscape',
            autoExitOnRotate: true,
          }}
          onFirstFrameRender={() => setFirstFrameRendered(true)}
        />

        {!firstFrameRendered && !playerError ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.loadingText}>{t('privateVault.playerLoading')}</Text>
          </View>
        ) : null}

        {playerError ? (
          <View style={styles.errorOverlay}>
            <Ionicons name="warning-outline" size={24} color={colors.error} />
            <Text style={[styles.errorText, { color: colors.error }]}>
              {t('privateVault.playerError')}
            </Text>
            <View style={styles.errorActions}>
              <Pressable
                onPress={() => void retryPlayback()}
                style={({ pressed }) => [
                  styles.button,
                  {
                    borderColor: colors.border,
                    backgroundColor: pressed ? colors.surfaceHover : colors.surface,
                  },
                ]}
              >
                <Text style={[styles.buttonText, { color: colors.text }]}>
                  {t('privateVault.playerRetry')}
                </Text>
              </Pressable>
              <Pressable
                onPress={goBack}
                style={({ pressed }) => [
                  styles.button,
                  {
                    borderColor: colors.border,
                    backgroundColor: pressed ? colors.surfaceHover : colors.surface,
                  },
                ]}
              >
                <Text style={[styles.buttonText, { color: colors.text }]}>
                  {t('privateVault.playerBack')}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  playerContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  player: {
    flex: 1,
    backgroundColor: '#000',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    gap: 12,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
  },
  loadingText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },
  errorText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorActions: {
    marginTop: 4,
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    minWidth: 120,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
