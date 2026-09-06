import React from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText as Text } from './AppText';
import { useTheme } from '@/src/theme';

export interface ConfirmConfig {
  title: string;
  message: string;
  /** Label of the confirming button. */
  confirm: string;
  /** Colours the confirming button as a warning. Use for anything irreversible. */
  destructive: boolean;
}

/**
 * Confirmation dialog for destructive or otherwise irreversible actions.
 *
 * Extracted from the music library so every screen confirms the same way rather than
 * each growing its own modal. Reads the theme itself instead of taking a `colors`
 * prop, matching the other shared components.
 *
 * Renders nothing when `config` is null, so callers can drive it straight from a
 * nullable "pending action" without guarding the JSX.
 */
export function ConfirmModal({
  visible,
  busy = false,
  config,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  busy?: boolean;
  config: ConfirmConfig | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  if (!config) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>{config.title}</Text>
          <Text style={[styles.message, { color: colors.textMuted }]}>{config.message}</Text>
          <View style={styles.buttons}>
            <Pressable onPress={onCancel} style={[styles.button, { backgroundColor: colors.surfaceHover }]}>
              <Text style={[styles.buttonText, { color: colors.text }]}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={busy}
              style={[
                styles.button,
                { backgroundColor: config.destructive ? colors.error : colors.accent },
              ]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.background} />
              ) : (
                <Text style={[styles.buttonText, { color: colors.background }]}>{config.confirm}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#000000CC',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: { width: '100%', maxWidth: 420, borderRadius: 16, borderWidth: 1, padding: 20, gap: 12 },
  title: { fontSize: 17, fontWeight: '700' },
  message: { fontSize: 14, lineHeight: 20 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 4 },
  button: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingVertical: 12,
    minHeight: 44,
  },
  buttonText: { fontSize: 15, fontWeight: '700' },
});
