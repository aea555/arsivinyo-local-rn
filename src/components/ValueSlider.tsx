import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

import { AppText as Text } from './AppText';
import { useTheme } from '@/src/theme';

/**
 * A minimal horizontal slider.
 *
 * Built on PanResponder rather than a slider package on purpose: the project has no
 * slider dependency, and adding one would pull in a native module and force a rebuild
 * for what is a handful of lines of arithmetic. This keeps preset editing a pure JS
 * change that reloads over Metro.
 *
 * Dragging is relative to where the gesture started, and a tap jumps the thumb to the
 * touched position first, so both interactions feel right without needing page
 * coordinates.
 */
export function ValueSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
  disabled = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  /** Renders the numeric readout; defaults to a trimmed decimal. */
  formatValue?: (value: number) => string;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);

  // Kept in refs because the PanResponder closure is created once and would otherwise
  // capture stale values.
  const widthRef = useRef(0);
  const startValueRef = useRef(value);
  const valueRef = useRef(value);
  valueRef.current = value;

  const snap = useCallback(
    (raw: number) => {
      const clamped = Math.min(max, Math.max(min, raw));
      const stepped = Math.round((clamped - min) / step) * step + min;
      // Re-clamp: rounding up from the last step can overshoot the maximum.
      const bounded = Math.min(max, Math.max(min, stepped));
      // Kill floating-point dust like 0.7300000000000001 from repeated addition.
      return Math.round(bounded * 1000) / 1000;
    },
    [max, min, step]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        onPanResponderGrant: (event) => {
          const width = widthRef.current;
          if (width <= 0) return;
          const ratio = event.nativeEvent.locationX / width;
          const next = snap(min + ratio * (max - min));
          startValueRef.current = next;
          onChange(next);
        },
        onPanResponderMove: (_event, gesture) => {
          const width = widthRef.current;
          if (width <= 0) return;
          const delta = (gesture.dx / width) * (max - min);
          onChange(snap(startValueRef.current + delta));
        },
      }),
    [disabled, max, min, onChange, snap]
  );

  const ratio = max > min ? (value - min) / (max - min) : 0;
  const fillPercent = `${Math.min(100, Math.max(0, ratio * 100))}%` as const;
  const readout = formatValue ? formatValue(value) : String(Math.round(value * 100) / 100);

  return (
    <View style={[styles.container, disabled && styles.disabled]}>
      <View style={styles.header}>
        <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.readout, { color: colors.textMuted }]}>{readout}</Text>
      </View>
      <View
        style={styles.touchArea}
        onLayout={(event) => {
          const width = event.nativeEvent.layout.width;
          widthRef.current = width;
          setTrackWidth(width);
        }}
        {...panResponder.panHandlers}
      >
        <View style={[styles.track, { backgroundColor: colors.borderSubtle }]}>
          <View style={[styles.fill, { backgroundColor: colors.accent, width: fillPercent }]} />
        </View>
        {trackWidth > 0 ? (
          <View
            pointerEvents="none"
            style={[
              styles.thumb,
              {
                backgroundColor: colors.accent,
                borderColor: colors.surface,
                left: Math.min(trackWidth - THUMB_SIZE, Math.max(0, ratio * trackWidth - THUMB_SIZE / 2)),
              },
            ]}
          />
        ) : null}
      </View>
    </View>
  );
}

const THUMB_SIZE = 18;

const styles = StyleSheet.create({
  container: { paddingVertical: 8 },
  disabled: { opacity: 0.4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 13 },
  readout: { fontSize: 13, fontVariant: ['tabular-nums'] },
  // Taller than the visible track so the control is comfortably touchable.
  touchArea: { height: 32, justifyContent: 'center', marginTop: 4 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%' },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 2,
  },
});
