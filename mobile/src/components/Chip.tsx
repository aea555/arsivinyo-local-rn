import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';

interface ChipProps {
  label: string;
  /** Accent color for the chip (hex). Used for background tint + border when active. */
  color?: string;
  /** Whether the chip is in its "selected" / "active" state — gives a stronger border and a checkmark. */
  active?: boolean;
  /** Optional leading icon. */
  iconName?: keyof typeof Ionicons.glyphMap;
  /** Optional trailing icon, e.g. an X for "remove tag" affordance. Overrides the active-state checkmark. */
  trailingIconName?: keyof typeof Ionicons.glyphMap;
  /** Visual scale. `sm` for tight per-row contexts; `md` for filter rows / pickers. */
  size?: 'sm' | 'md';
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Used inside the chip text to fade out when alpha-blending against unusual backgrounds. */
  textColor?: string;
}

/**
 * Reusable pill / chip primitive used for vault tags. Designed to render efficiently
 * inside FlatList rows (no inline functions in the hot path; minimal layout work).
 *
 * The visual model:
 *   - Inactive: subtle background tinted with `color` at ~16% alpha; plain border.
 *   - Active: same color background but at ~30% alpha; border in `color`; checkmark added.
 *
 * Both states preserve the label color so the chip stays readable on any backdrop.
 */
export function Chip({
  label,
  color = '#888888',
  active = false,
  iconName,
  trailingIconName,
  size = 'md',
  onPress,
  onLongPress,
  disabled = false,
  style,
  textColor,
}: ChipProps) {
  const sizing = size === 'sm' ? SIZES.sm : SIZES.md;
  const showCheck = active && !trailingIconName;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled || !onPress}
      style={({ pressed }) => [
        styles.base,
        {
          paddingHorizontal: sizing.paddingHorizontal,
          paddingVertical: sizing.paddingVertical,
          borderRadius: sizing.borderRadius,
          gap: sizing.gap,
          backgroundColor: color + (active ? '33' : '1A'),
          borderColor: active ? color : color + '55',
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {iconName ? <Ionicons name={iconName} size={sizing.iconSize} color={color} /> : null}
      <AppText
        numberOfLines={1}
        style={[
          styles.label,
          { fontSize: sizing.fontSize, color: textColor ?? color },
        ]}
      >
        {label}
      </AppText>
      {showCheck ? <Ionicons name="checkmark" size={sizing.iconSize} color={color} /> : null}
      {trailingIconName ? <Ionicons name={trailingIconName} size={sizing.iconSize} color={color} /> : null}
    </Pressable>
  );
}

/**
 * Horizontal scroll-friendly chip row. Stays one line, doesn't grow vertically.
 * Use with `<ScrollView horizontal>` or a flex-row View depending on your layout.
 */
export function ChipRow({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.row, style]}>{children}</View>;
}

const SIZES = {
  sm: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 4,
    iconSize: 12,
    fontSize: 11,
  },
  md: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    gap: 6,
    iconSize: 14,
    fontSize: 13,
  },
} as const;

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  label: {
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'nowrap',
  },
});
