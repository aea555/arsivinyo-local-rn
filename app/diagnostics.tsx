import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getLocalDiagnostics } from '@/src/api';
import { listCookieProfiles, LOCAL_COOKIE_PLATFORMS } from '@/src/services';
import { useTheme } from '@/src/theme';

type DiagnosticsState = {
  ytDlpVersion: string;
  ytDlpAvailable: boolean;
  pythonReady: boolean;
  ffmpegPath: string | null;
  ffprobePath: string | null;
  ffmpegAbi?: string | null;
  ffmpegRuntimeSource?: 'native_library' | 'asset_fallback' | 'none';
  nativeLibraryDir?: string | null;
  nativeLibraryEntries?: string[];
  ffmpegVersion?: string | null;
  ffprobeVersion?: string | null;
  ffmpegExists: boolean;
  ffprobeExists: boolean;
  ffmpegExecutable?: boolean;
  ffprobeExecutable?: boolean;
  ffmpegProbeError?: string | null;
  ffprobeProbeError?: string | null;
  mergeCapable: boolean;
  activeHttpUserAgent: string;
  secureCookieStoreEnabled: boolean;
  cookieEncryptionVersion: string;
  cookieProfilesEncryptedCount: number;
  cookieLegacyPlaintextCount: number;
  cookieMigrationStatus: 'not_needed' | 'migrated' | 'partial' | 'failed';
  activeTaskId: string | null;
  lastErrors: string[];
  cookieCounts: Record<string, number>;
};

const initialState: DiagnosticsState = {
  ytDlpVersion: 'unknown',
  ytDlpAvailable: false,
  pythonReady: false,
  ffmpegPath: null,
  ffprobePath: null,
  ffmpegAbi: null,
  ffmpegRuntimeSource: 'none',
  nativeLibraryDir: null,
  nativeLibraryEntries: [],
  ffmpegVersion: null,
  ffprobeVersion: null,
  ffmpegExists: false,
  ffprobeExists: false,
  ffmpegExecutable: false,
  ffprobeExecutable: false,
  ffmpegProbeError: null,
  ffprobeProbeError: null,
  mergeCapable: false,
  activeHttpUserAgent: 'unknown',
  secureCookieStoreEnabled: false,
  cookieEncryptionVersion: 'v1',
  cookieProfilesEncryptedCount: 0,
  cookieLegacyPlaintextCount: 0,
  cookieMigrationStatus: 'not_needed',
  activeTaskId: null,
  lastErrors: [],
  cookieCounts: {},
};

export default function DiagnosticsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const [state, setState] = useState<DiagnosticsState>(initialState);

  const loadDiagnostics = useCallback(async () => {
    const [diag, cookieCounts] = await Promise.all([
      getLocalDiagnostics(),
      Promise.all(
        LOCAL_COOKIE_PLATFORMS.map(async (platform) => {
          const profiles = await listCookieProfiles(platform);
          return [platform, profiles.length] as const;
        })
      ),
    ]);

    setState({
      ytDlpVersion: diag.ytDlpVersion,
      ytDlpAvailable: diag.ytDlpAvailable,
      pythonReady: diag.pythonReady,
      ffmpegPath: diag.ffmpegPath,
      ffprobePath: diag.ffprobePath,
      ffmpegAbi: diag.ffmpegAbi,
      ffmpegRuntimeSource: diag.ffmpegRuntimeSource,
      nativeLibraryDir: diag.nativeLibraryDir,
      nativeLibraryEntries: diag.nativeLibraryEntries ?? [],
      ffmpegVersion: diag.ffmpegVersion,
      ffprobeVersion: diag.ffprobeVersion,
      ffmpegExists: diag.ffmpegExists,
      ffprobeExists: diag.ffprobeExists,
      ffmpegExecutable: diag.ffmpegExecutable,
      ffprobeExecutable: diag.ffprobeExecutable,
      ffmpegProbeError: diag.ffmpegProbeError,
      ffprobeProbeError: diag.ffprobeProbeError,
      mergeCapable: diag.mergeCapable,
      activeHttpUserAgent: diag.activeHttpUserAgent,
      secureCookieStoreEnabled: diag.secureCookieStoreEnabled,
      cookieEncryptionVersion: diag.cookieEncryptionVersion,
      cookieProfilesEncryptedCount: diag.cookieProfilesEncryptedCount,
      cookieLegacyPlaintextCount: diag.cookieLegacyPlaintextCount,
      cookieMigrationStatus: diag.cookieMigrationStatus,
      activeTaskId: diag.activeTaskId,
      lastErrors: diag.lastErrors,
      cookieCounts: Object.fromEntries(cookieCounts),
    });
  }, []);

  useEffect(() => {
    loadDiagnostics();
  }, [loadDiagnostics]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}> 
      <View style={[styles.header, { borderBottomColor: colors.border }]}> 
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('settings.diagnostics')}</Text>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => [
            styles.closeButton,
            { backgroundColor: pressed ? colors.surfaceHover : colors.surface },
          ]}
        >
          <Ionicons name="close" size={20} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.contentContainer}>
        <View style={[styles.card, { backgroundColor: colors.surface }]}> 
          <Text style={[styles.title, { color: colors.text }]}>Runtime</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Python ready: {state.pythonReady ? 'yes' : 'no'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>yt-dlp: {state.ytDlpVersion}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>yt-dlp import: {state.ytDlpAvailable ? 'ok' : 'failed'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>FFmpeg path: {state.ffmpegPath ?? 'not bundled'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>FFprobe path: {state.ffprobePath ?? 'not bundled'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>FFmpeg ABI: {state.ffmpegAbi ?? 'unknown'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Runtime source: {state.ffmpegRuntimeSource ?? 'unknown'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Native library dir: {state.nativeLibraryDir ?? 'unknown'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Native entries: {(state.nativeLibraryEntries ?? []).join(', ') || 'none'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>FFmpeg version: {state.ffmpegVersion ?? 'unknown'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>FFprobe version: {state.ffprobeVersion ?? 'unknown'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>FFmpeg available: {state.ffmpegExists ? 'yes' : 'no'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>FFprobe available: {state.ffprobeExists ? 'yes' : 'no'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>FFmpeg executable: {state.ffmpegExecutable ? 'yes' : 'no'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>FFprobe executable: {state.ffprobeExecutable ? 'yes' : 'no'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>FFmpeg probe error: {state.ffmpegProbeError ?? 'none'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>FFprobe probe error: {state.ffprobeProbeError ?? 'none'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Merge capable: {state.mergeCapable ? 'yes' : 'no'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>HTTP User-Agent: {state.activeHttpUserAgent}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Secure cookie store: {state.secureCookieStoreEnabled ? 'yes' : 'no'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Cookie encryption: {state.cookieEncryptionVersion}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Encrypted cookie profiles: {state.cookieProfilesEncryptedCount}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Legacy plaintext cookies: {state.cookieLegacyPlaintextCount}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Cookie migration status: {state.cookieMigrationStatus}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Active task: {state.activeTaskId ?? 'none'}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface }]}> 
          <Text style={[styles.title, { color: colors.text }]}>Cookie Profiles</Text>
          {LOCAL_COOKIE_PLATFORMS.map((platform) => (
            <Text key={platform} style={[styles.row, { color: colors.textMuted }]}> 
              {platform}: {state.cookieCounts[platform] ?? 0}
            </Text>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface }]}> 
          <Text style={[styles.title, { color: colors.text }]}>Last Errors</Text>
          {state.lastErrors.length === 0 ? (
            <Text style={[styles.row, { color: colors.textMuted }]}>No errors captured</Text>
          ) : (
            state.lastErrors.map((err, index) => (
              <Text key={`${err}-${index}`} style={[styles.errorRow, { color: colors.error }]}> 
                {err}
              </Text>
            ))
          )}
        </View>

        <Pressable
          onPress={loadDiagnostics}
          style={({ pressed }) => [
            styles.refreshButton,
            { backgroundColor: pressed ? colors.surfaceHover : colors.surface },
          ]}
        >
          <Text style={[styles.refreshText, { color: colors.text }]}>{t('settings.refreshDiagnostics')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentContainer: {
    padding: 20,
    gap: 12,
  },
  card: {
    borderRadius: 16,
    padding: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  row: {
    fontSize: 13,
    marginBottom: 4,
  },
  errorRow: {
    fontSize: 12,
    marginBottom: 6,
  },
  refreshButton: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  refreshText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
