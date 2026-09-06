import React, { forwardRef, useMemo } from 'react';
import {
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextInputProps,
  type TextProps,
} from 'react-native';

const MONDA_REGULAR = 'Monda_400Regular';
const MONDA_MEDIUM = 'Monda_500Medium';
const MONDA_SEMIBOLD = 'Monda_600SemiBold';
const MONDA_BOLD = 'Monda_700Bold';

function resolveMondaFamily(style: unknown): string | null {
  const flattened = StyleSheet.flatten(style as never) as { fontFamily?: string; fontWeight?: string | number } | undefined;
  if (flattened?.fontFamily) {
    return null;
  }

  const weight = String(flattened?.fontWeight ?? '').toLowerCase();
  if (weight === 'bold' || weight === '700' || weight === '800' || weight === '900') {
    return MONDA_BOLD;
  }
  if (weight === '600') {
    return MONDA_SEMIBOLD;
  }
  if (weight === '500') {
    return MONDA_MEDIUM;
  }
  return MONDA_REGULAR;
}

// Monda's vertical metrics, combined with Android's default `includeFontPadding`,
// push glyphs low within their line box — which makes text look bottom-aligned and,
// in tight containers (pills, chips), clips descenders/cedillas so Turkish letters
// like ş/ç appear to lose their marks. Disabling font padding centers glyphs and
// stops the clipping. It's a no-op on iOS.
const FONT_PADDING_FIX = { includeFontPadding: false } as const;

export const AppText = forwardRef<React.ComponentRef<typeof NativeText>, TextProps>(
  function AppText({ style, ...props }, ref) {
    const fontFamily = useMemo(() => resolveMondaFamily(style), [style]);
    return (
      <NativeText
        ref={ref}
        {...props}
        style={fontFamily ? [style, { fontFamily, fontWeight: undefined }, FONT_PADDING_FIX] : [style, FONT_PADDING_FIX]}
      />
    );
  }
);

export const AppTextInput = forwardRef<React.ComponentRef<typeof NativeTextInput>, TextInputProps>(
  function AppTextInput({ style, ...props }, ref) {
    const fontFamily = useMemo(() => resolveMondaFamily(style), [style]);
    return (
      <NativeTextInput
        ref={ref}
        {...props}
        style={fontFamily ? [style, { fontFamily, fontWeight: undefined }, FONT_PADDING_FIX] : [style, FONT_PADDING_FIX]}
      />
    );
  }
);

export const appHeaderTitleFontFamily = MONDA_BOLD;
