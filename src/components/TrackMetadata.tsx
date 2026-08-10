import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText as Text } from './AppText';
import type { LocalSound } from '@/src/api';
import { useTheme } from '@/src/theme';

/**
 * Metadata rows for one track.
 *
 * Shared by the library's info sheet and the player screen so the two can never drift
 * into describing the same track differently.
 *
 * A track this app rendered is called out explicitly rather than left for the user to
 * infer from the title: the `(Slowed + Reverb)` suffix is only a naming convention and
 * a rename erases it, whereas `presetId` is recorded in the index and survives.
 */
export function TrackMetadata({
  song,
  presetName,
  sourceTitle,
}: {
  song: LocalSound;
  /** Display name of the preset used, when the track is a render. */
  presetName?: string | null;
  /** Title of the track this was rendered from, when known. */
  sourceTitle?: string | null;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const rendered = typeof song.presetId === 'string' && song.presetId.length > 0;

  const rows: { label: string; value: string; accent?: boolean }[] = [];

  if (song.format) {
    rows.push({
      label: t('sounds.metadata.format'),
      value: `${song.format.toUpperCase()} · ${
        song.lossless ? t('sounds.metadata.lossless') : t('sounds.metadata.lossy')
      }`,
      accent: song.lossless,
    });
  }
  rows.push({ label: t('sounds.metadata.duration'), value: formatDuration(song.durationSec) });
  if (song.sizeBytes > 0) {
    rows.push({ label: t('sounds.metadata.size'), value: formatBytes(song.sizeBytes) });
  }
  if (song.createdAt > 0) {
    rows.push({ label: t('sounds.metadata.added'), value: formatDate(song.createdAt) });
  }
  if (rendered) {
    rows.push({
      label: t('sounds.metadata.preset'),
      value: presetName ?? song.presetId ?? '',
      accent: true,
    });
    if (sourceTitle) {
      rows.push({ label: t('sounds.metadata.source'), value: sourceTitle });
    }
  }
  if (song.fileName) {
    rows.push({ label: t('sounds.metadata.fileName'), value: song.fileName });
  }

  return (
    <View>
      {rendered ? (
        <View style={[styles.renderedNote, { borderColor: colors.accent }]}>
          <Text style={[styles.renderedNoteText, { color: colors.accent }]}>
            {t('sounds.metadata.madeByApp')}
          </Text>
        </View>
      ) : null}
      {rows.map((row) => (
        <View key={row.label} style={styles.row}>
          <Text style={[styles.label, { color: colors.textMuted }]}>{row.label}</Text>
          <Text
            numberOfLines={2}
            style={[styles.value, { color: row.accent ? colors.accent : colors.text }]}
          >
            {row.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatDate(timestampMs: number): string {
  try {
    return new Date(timestampMs).toLocaleString();
  } catch {
    return '';
  }
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6, gap: 12 },
  // Fixed label column so the values line up into a readable second column.
  label: { fontSize: 13, width: 110 },
  value: { fontSize: 13, flex: 1 },
  renderedNote: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  renderedNoteText: { fontSize: 12, fontWeight: '600' },
});
