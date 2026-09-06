import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText as Text } from './AppText';
import {
    darkThemes,
    lightThemes,
    themeDisplayNames,
    useTheme,
    type DarkThemeVariant,
    type LightThemeVariant,
    type ThemeVariant,
} from '../theme';

/**
 * Theme selection: a light/dark switch and a grid of palettes.
 *
 * The palettes were a horizontal strip, which hid half of them off-screen with nothing
 * to indicate more existed — workable at three, useless at eight. A wrapping grid shows
 * every option at once and grows without changing shape.
 *
 * Each tile previews the palette it selects rather than showing one flat colour: the
 * tile is painted in that theme's own background, border and accent, so the choice is
 * visible before it is applied.
 */
export const ThemePicker: React.FC = () => {
    const { t } = useTranslation();
    const { colors, config, isDark, setMode, setVariant, availableDarkVariants, availableLightVariants } =
        useTheme();

    const currentVariants: ThemeVariant[] = isDark
        ? (availableDarkVariants as ThemeVariant[])
        : (availableLightVariants as ThemeVariant[]);

    /** The palette a tile represents, so it can paint itself in that theme. */
    const paletteFor = (variant: ThemeVariant) =>
        isDark
            ? darkThemes[variant as DarkThemeVariant]
            : lightThemes[variant as LightThemeVariant];

    return (
        <View style={styles.container}>
            <View style={[styles.modeRow, { backgroundColor: colors.surfaceHover }]}>
                {(['light', 'dark'] as const).map((mode) => {
                    const active = isDark === (mode === 'dark');
                    return (
                        <Pressable
                            key={mode}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: active }}
                            onPress={() => setMode(mode)}
                            style={[styles.modeButton, active && { backgroundColor: colors.primary }]}
                        >
                            <Ionicons
                                name={mode === 'dark' ? 'moon' : 'sunny'}
                                size={16}
                                color={active ? colors.primaryText : colors.textMuted}
                            />
                            <Text
                                style={[
                                    styles.modeText,
                                    { color: active ? colors.primaryText : colors.textMuted },
                                ]}
                            >
                                {mode === 'dark' ? t('settings.darkMode') : t('settings.lightMode')}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>

            <View style={styles.grid}>
                {currentVariants.map((variant) => {
                    const selected = config.variant === variant;
                    const palette = paletteFor(variant);
                    return (
                        <Pressable
                            key={variant}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: selected }}
                            accessibilityLabel={themeDisplayNames[variant]}
                            onPress={() => setVariant(variant)}
                            style={[
                                styles.tile,
                                {
                                    backgroundColor: palette.background,
                                    borderColor: selected ? colors.accent : palette.border,
                                    borderWidth: selected ? 2 : 1,
                                },
                            ]}
                        >
                            <View style={styles.swatchRow}>
                                <View style={[styles.swatch, { backgroundColor: palette.accent }]} />
                                <View style={[styles.swatch, { backgroundColor: palette.surfaceActive }]} />
                                <View style={[styles.swatch, { backgroundColor: palette.text }]} />
                            </View>
                            <Text numberOfLines={1} style={[styles.tileName, { color: palette.text }]}>
                                {themeDisplayNames[variant]}
                            </Text>
                            {selected ? (
                                <Ionicons
                                    name="checkmark-circle"
                                    size={15}
                                    color={colors.accent}
                                    style={styles.check}
                                />
                            ) : null}
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    // Matches SettingsItem's own inset so the picker lines up with the rows above and
    // below it, now that the section card no longer pads its children.
    container: { gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
    modeRow: { flexDirection: 'row', borderRadius: 10, padding: 3 },
    modeButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        borderRadius: 8,
        gap: 6,
    },
    modeText: { fontSize: 13, fontWeight: '600' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    // Three across on a phone, and the grid simply grows taller as palettes are added.
    tile: {
        width: '31.5%',
        borderRadius: 10,
        paddingVertical: 10,
        paddingHorizontal: 8,
        alignItems: 'center',
        gap: 6,
    },
    swatchRow: { flexDirection: 'row', gap: 3 },
    swatch: { width: 12, height: 12, borderRadius: 6 },
    tileName: { fontSize: 11, fontWeight: '600' },
    check: { position: 'absolute', top: 4, right: 4 },
});

export default ThemePicker;
