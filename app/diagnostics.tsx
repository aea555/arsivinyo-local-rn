import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getLocalDiagnostics, getLocalVaultDiagnostics, runLocalImpersonationSelfTest } from '@/src/api';
import { AppText as Text } from '@/src/components';
import { BUILD_CONFIG } from '@/src/config';
import type { LocalVaultDiagnostics } from '@/src/native/localDownloader';
import { listCookieProfiles, LOCAL_COOKIE_PLATFORMS } from '@/src/services';
import { useTheme } from '@/src/theme';

type DiagnosticsState = {
  ytDlpVersion: string;
  ytDlpAvailable: boolean;
  pythonReady: boolean;
  ytDlpBundledVersion?: string | null;
  ytDlpActiveVersion?: string | null;
  ytDlpOverrideVersion?: string | null;
  ytDlpPendingVersion?: string | null;
  ytDlpFailedVersion?: string | null;
  ytDlpFailedReason?: string | null;
  ytDlpOverrideSource?: string | null;
  ytDlpOverridePath?: string | null;
  ytDlpOverrideStorageReady?: boolean;
  normalizedUrlLast?: string | null;
  attemptTraceCount?: number;
  lastExtractorKey?: string | null;
  lastRawYtDlpError?: string | null;
  lastCookieCheck?: {
    platform?: string;
    hasCookieFile: boolean;
    domainCoverage: string[];
    unexpiredCount: number;
  } | null;
  ytDlpVersionAgeDays?: number | null;
  platformStrategyLast?: string | null;
  impersonationRuntimeAvailable?: boolean | null;
  impersonationEnabled?: boolean;
  impersonationBackend?: 'curl_cffi' | 'none';
  impersonationRequiredByExtractorLast?: string | null;
  impersonationAttemptedTargetsLast?: string[];
  impersonationResolvedTargetLast?: string | null;
  impersonationWheelVersion?: string | null;
  impersonationBuildAbiCoverage?: string[];
  impersonationBootstrapError?: string | null;
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
  customDomainsCount?: number;
  customProfilesCount?: number;
  cookieLegacyPlaintextCount: number;
  cookieMigrationStatus: 'not_needed' | 'migrated' | 'partial' | 'failed';
  customDomainMatchLast?: {
    urlHost: string;
    matchedDomain?: string | null;
    profileName?: string | null;
  } | null;
  activeTaskId: string | null;
  lastErrors: string[];
  cookieCounts: Record<string, number>;
};

const initialState: DiagnosticsState = {
  ytDlpVersion: 'unknown',
  ytDlpAvailable: false,
  pythonReady: false,
  ytDlpBundledVersion: null,
  ytDlpActiveVersion: null,
  ytDlpOverrideVersion: null,
  ytDlpPendingVersion: null,
  ytDlpFailedVersion: null,
  ytDlpFailedReason: null,
  ytDlpOverrideSource: 'bundled',
  ytDlpOverridePath: null,
  ytDlpOverrideStorageReady: false,
  normalizedUrlLast: null,
  attemptTraceCount: 0,
  lastExtractorKey: null,
  lastRawYtDlpError: null,
  lastCookieCheck: null,
  ytDlpVersionAgeDays: null,
  platformStrategyLast: null,
  impersonationRuntimeAvailable: null,
  impersonationEnabled: false,
  impersonationBackend: 'none',
  impersonationRequiredByExtractorLast: null,
  impersonationAttemptedTargetsLast: [],
  impersonationResolvedTargetLast: null,
  impersonationWheelVersion: null,
  impersonationBuildAbiCoverage: [],
  impersonationBootstrapError: null,
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
  customDomainsCount: 0,
  customProfilesCount: 0,
  cookieLegacyPlaintextCount: 0,
  cookieMigrationStatus: 'not_needed',
  customDomainMatchLast: null,
  activeTaskId: null,
  lastErrors: [],
  cookieCounts: {},
};

export default function DiagnosticsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const [state, setState] = useState<DiagnosticsState>(initialState);
  const [vaultDiag, setVaultDiag] = useState<LocalVaultDiagnostics | null>(null);

  const loadDiagnostics = useCallback(async () => {
    const [diag, cookieCounts, vault] = await Promise.all([
      getLocalDiagnostics(),
      Promise.all(
        LOCAL_COOKIE_PLATFORMS.map(async (platform) => {
          const profiles = await listCookieProfiles(platform);
          return [platform, profiles.length] as const;
        })
      ),
      getLocalVaultDiagnostics().catch(() => null),
    ]);
    setVaultDiag(vault);

    setState({
      ytDlpVersion: diag.ytDlpVersion,
      ytDlpAvailable: diag.ytDlpAvailable,
      pythonReady: diag.pythonReady,
      ytDlpBundledVersion: diag.ytDlpBundledVersion ?? null,
      ytDlpActiveVersion: diag.ytDlpActiveVersion ?? null,
      ytDlpOverrideVersion: diag.ytDlpOverrideVersion ?? null,
      ytDlpPendingVersion: diag.ytDlpPendingVersion ?? null,
      ytDlpFailedVersion: diag.ytDlpFailedVersion ?? null,
      ytDlpFailedReason: diag.ytDlpFailedReason ?? null,
      ytDlpOverrideSource: diag.ytDlpOverrideSource ?? 'bundled',
      ytDlpOverridePath: diag.ytDlpOverridePath ?? null,
      ytDlpOverrideStorageReady: diag.ytDlpOverrideStorageReady ?? false,
      normalizedUrlLast: diag.normalizedUrlLast ?? null,
      attemptTraceCount: diag.attemptTraceCount ?? 0,
      lastExtractorKey: diag.lastExtractorKey ?? null,
      lastRawYtDlpError: diag.lastRawYtDlpError ?? null,
      lastCookieCheck: diag.lastCookieCheck ?? null,
      ytDlpVersionAgeDays: diag.ytDlpVersionAgeDays ?? null,
      platformStrategyLast: diag.platformStrategyLast ?? null,
      impersonationRuntimeAvailable: diag.impersonationRuntimeAvailable ?? null,
      impersonationEnabled: diag.impersonationEnabled ?? false,
      impersonationBackend: diag.impersonationBackend ?? 'none',
      impersonationRequiredByExtractorLast: diag.impersonationRequiredByExtractorLast ?? null,
      impersonationAttemptedTargetsLast: diag.impersonationAttemptedTargetsLast ?? [],
      impersonationResolvedTargetLast: diag.impersonationResolvedTargetLast ?? null,
      impersonationWheelVersion: diag.impersonationWheelVersion ?? null,
      impersonationBuildAbiCoverage: diag.impersonationBuildAbiCoverage ?? [],
      impersonationBootstrapError: diag.impersonationBootstrapError ?? null,
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
      customDomainsCount: diag.customDomainsCount ?? 0,
      customProfilesCount: diag.customProfilesCount ?? 0,
      cookieLegacyPlaintextCount: diag.cookieLegacyPlaintextCount,
      cookieMigrationStatus: diag.cookieMigrationStatus,
      customDomainMatchLast: diag.customDomainMatchLast ?? null,
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
          <Text style={[styles.title, { color: colors.text }]}>App</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Version: {BUILD_CONFIG.APP_VERSION || 'unknown'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Version code: {BUILD_CONFIG.APP_VERSION_CODE ?? 'unknown'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Channel: {BUILD_CONFIG.APP_CHANNEL}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.title, { color: colors.text }]}>Vault</Text>
          {vaultDiag ? (
            <>
              <Text style={[styles.row, { color: colors.textMuted }]}>
                Cipher v4: {vaultDiag.cipherCounts.v4} / v3: {vaultDiag.cipherCounts.v3} / other: {vaultDiag.cipherCounts.other}
              </Text>
              <Text style={[styles.row, { color: colors.textMuted }]}>
                Loopback: {vaultDiag.loopbackRunning ? `running:${vaultDiag.loopbackPort ?? '?'}` : 'stopped'}
              </Text>
              <Text style={[styles.row, { color: colors.textMuted }]}>
                Active video sessions: {vaultDiag.activeVideoSessions}
              </Text>
              <Text style={[styles.row, { color: colors.textMuted }]}>
                Evicted sessions: {vaultDiag.evictedVideoSessions}
              </Text>
              <Text style={[styles.row, { color: colors.textMuted }]}>
                Migration running: {vaultDiag.migration.running ? 'yes' : 'no'}
              </Text>
              <Text style={[styles.row, { color: colors.textMuted }]}>
                Last migration: {vaultDiag.migration.lastProcessed ?? '-'} / {vaultDiag.migration.lastTotal ?? '-'} (last error: {vaultDiag.migration.lastErrorCode ?? 'none'})
              </Text>
            </>
          ) : (
            <Text style={[styles.row, { color: colors.textMuted }]}>Unavailable</Text>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.title, { color: colors.text }]}>Runtime</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Python ready: {state.pythonReady ? 'yes' : 'no'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>yt-dlp: {state.ytDlpVersion}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>yt-dlp bundled: {state.ytDlpBundledVersion ?? 'unknown'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>yt-dlp active: {state.ytDlpActiveVersion ?? 'unknown'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>yt-dlp source: {state.ytDlpOverrideSource ?? 'bundled'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>yt-dlp override: {state.ytDlpOverrideVersion ?? 'none'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>yt-dlp pending: {state.ytDlpPendingVersion ?? 'none'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>yt-dlp failed version: {state.ytDlpFailedVersion ?? 'none'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>yt-dlp failed reason: {state.ytDlpFailedReason ?? 'none'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>yt-dlp override storage: {state.ytDlpOverrideStorageReady ? 'ready' : 'not ready'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>yt-dlp override path: {state.ytDlpOverridePath ?? 'none'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>yt-dlp age days: {state.ytDlpVersionAgeDays ?? 'unknown'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>yt-dlp import: {state.ytDlpAvailable ? 'ok' : 'failed'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Normalized URL (last): {state.normalizedUrlLast ?? 'none'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Attempt traces: {state.attemptTraceCount ?? 0}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Strategy (last): {state.platformStrategyLast ?? 'none'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>
            Impersonation runtime: {state.impersonationRuntimeAvailable == null ? 'unknown' : state.impersonationRuntimeAvailable ? 'available' : 'unavailable'}
          </Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Impersonation enabled: {state.impersonationEnabled ? 'yes' : 'no'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Impersonation backend: {state.impersonationBackend ?? 'none'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Impersonation wheel version: {state.impersonationWheelVersion ?? 'unknown'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Impersonation ABIs: {(state.impersonationBuildAbiCoverage ?? []).join(', ') || 'none'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Impersonation required extractor (last): {state.impersonationRequiredByExtractorLast ?? 'none'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Impersonation attempted targets (last): {(state.impersonationAttemptedTargetsLast ?? []).join(', ') || 'none'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Impersonation resolved target (last): {state.impersonationResolvedTargetLast ?? 'none'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Impersonation bootstrap error: {state.impersonationBootstrapError ?? 'none'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Extractor key (last): {state.lastExtractorKey ?? 'none'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Raw yt-dlp error (last): {state.lastRawYtDlpError ?? 'none'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>
            Cookie check (last): {state.lastCookieCheck
              ? `${state.lastCookieCheck.platform ?? 'n/a'} | has=${state.lastCookieCheck.hasCookieFile ? 'yes' : 'no'} | ` +
                `unexpired=${state.lastCookieCheck.unexpiredCount} | domains=${state.lastCookieCheck.domainCoverage.join(', ') || 'none'}`
              : 'none'}
          </Text>
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
          <Text style={[styles.row, { color: colors.textMuted }]}>Custom domains: {state.customDomainsCount ?? 0}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Custom profiles: {state.customProfilesCount ?? 0}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Legacy plaintext cookies: {state.cookieLegacyPlaintextCount}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>Cookie migration status: {state.cookieMigrationStatus}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>
            Last custom match: {state.customDomainMatchLast
              ? `${state.customDomainMatchLast.urlHost} -> ${state.customDomainMatchLast.matchedDomain ?? 'none'} (${state.customDomainMatchLast.profileName ?? 'none'})`
              : 'none'}
          </Text>
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
          onPress={async () => {
            await runLocalImpersonationSelfTest();
            await loadDiagnostics();
          }}
          style={({ pressed }) => [
            styles.refreshButton,
            { backgroundColor: pressed ? colors.surfaceHover : colors.surface },
          ]}
        >
          <Text style={[styles.refreshText, { color: colors.text }]}>Run Impersonation Self-Test</Text>
        </Pressable>

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
