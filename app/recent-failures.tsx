import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { getLocalDownloadFailureLogs } from '@/src/api';
import { AppText as Text } from '@/src/components';
import type { LocalDownloadFailureLog } from '@/src/native/localDownloader';
import { copyToClipboard } from '@/src/services';
import { useTheme } from '@/src/theme';

function formatFailureDate(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(value).toLocaleString();
}

export default function RecentFailuresScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [logs, setLogs] = useState<LocalDownloadFailureLog[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      setLogs(await getLocalDownloadFailureLogs());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadLogs();
    }, [loadLogs])
  );

  const empty = useMemo(() => !loading && logs.length === 0, [loading, logs.length]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const copyFailureLog = useCallback(async (log: LocalDownloadFailureLog) => {
    const date = formatFailureDate(log.createdAt) ?? t('failureLogs.unknownDate');
    const content = [
      date,
      log.code ? `Code: ${log.code}` : null,
      log.taskId ? `Task: ${log.taskId}` : null,
      log.url ? `URL: ${log.url}` : null,
      '',
      log.message,
    ].filter((line) => line !== null).join('\n');

    const copied = await copyToClipboard(content);
    if (!copied) return;

    setCopiedId(log.id);
    setTimeout(() => {
      setCopiedId((current) => (current === log.id ? null : current));
    }, 1500);
  }, [t]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.contentContainer}>
        {loading ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.surface }]}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>{t('common.loading')}</Text>
          </View>
        ) : null}

        {empty ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.surface }]}>
            <Ionicons name="checkmark-circle-outline" size={24} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>{t('failureLogs.empty')}</Text>
          </View>
        ) : null}

        {logs.map((log) => {
          const expanded = expandedIds.has(log.id);
          return (
            <View key={log.id} style={styles.logGroup}>
              <Text style={[styles.dateText, { color: colors.textMuted }]}>
                {formatFailureDate(log.createdAt) ?? t('failureLogs.unknownDate')}
              </Text>
              <View
                style={[
                  styles.logCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Pressable
                  onPress={() => toggleExpanded(log.id)}
                  style={({ pressed }) => [
                    styles.logHeader,
                    { backgroundColor: pressed ? colors.surfaceHover : 'transparent' },
                  ]}
                >
                  <Text style={[styles.logTitle, { color: colors.text }]}>
                    {log.code || t('home.downloadFailed')}
                  </Text>
                  <Ionicons
                    name={expanded ? 'chevron-up-outline' : 'chevron-down-outline'}
                    size={18}
                    color={colors.textMuted}
                  />
                </Pressable>
                {expanded ? (
                  <View style={styles.logBody}>
                    {log.url ? (
                      <Text style={[styles.urlText, { color: colors.text }]}>
                        URL: {log.url}
                      </Text>
                    ) : null}
                    <Text style={[styles.messageText, { color: colors.textMuted }]}>
                      {log.message}
                    </Text>
                    <Pressable
                      onPress={() => {
                        void copyFailureLog(log);
                      }}
                      style={({ pressed }) => [
                        styles.copyButton,
                        {
                          backgroundColor: pressed ? colors.surfaceHover : colors.background,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Ionicons
                        name={copiedId === log.id ? 'checkmark-outline' : 'copy-outline'}
                        size={16}
                        color={copiedId === log.id ? colors.accent : colors.text}
                      />
                      <Text
                        style={[
                          styles.copyButtonText,
                          { color: copiedId === log.id ? colors.accent : colors.text },
                        ]}
                      >
                        {copiedId === log.id ? t('failureLogs.copied') : t('failureLogs.copy')}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  emptyCard: {
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  logGroup: {
    marginBottom: 14,
  },
  dateText: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    marginLeft: 4,
  },
  logCard: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 14,
  },
  logTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  messageText: {
    fontSize: 12,
    lineHeight: 18,
  },
  urlText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  logBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 12,
  },
  copyButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  copyButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
