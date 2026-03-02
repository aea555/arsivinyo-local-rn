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
  ffmpegPath: string | null;
  ffmpegExists: boolean;
  activeTaskId: string | null;
  lastErrors: string[];
  cookieCounts: Record<string, number>;
};

const initialState: DiagnosticsState = {
  ytDlpVersion: 'unknown',
  ffmpegPath: null,
  ffmpegExists: false,
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
      ffmpegPath: diag.ffmpegPath,
      ffmpegExists: diag.ffmpegExists,
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
          <Text style={[styles.row, { color: colors.textMuted }]}>yt-dlp: {state.ytDlpVersion}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>FFmpeg path: {state.ffmpegPath ?? 'not bundled'}</Text>
          <Text style={[styles.row, { color: colors.textMuted }]}>FFmpeg available: {state.ffmpegExists ? 'yes' : 'no'}</Text>
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
