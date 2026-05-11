import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from 'react-native';
import {
    DarkThemeVariant,
    LightThemeVariant,
    themeDisplayNames,
    useTheme,
} from '../theme';
import { AppText as Text } from './AppText';

interface ThemePickerProps {
    onClose?: () => void;
}

export const ThemePicker: React.FC<ThemePickerProps> = ({ onClose }) => {
    const { t } = useTranslation();
    const {
        colors,
        config,
        isDark,
        setMode,
        setVariant,
        availableDarkVariants,
        availableLightVariants,
    } = useTheme();

    const currentVariants = isDark ? availableDarkVariants : availableLightVariants;

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Mode Selector */}
            <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
                    {t('settings.themeMode')}
                </Text>
                <View style={[styles.modeContainer, { backgroundColor: colors.surface }]}>
                    <Pressable
                        onPress={() => setMode('light')}
                        style={[
                            styles.modeButton,
                            !isDark && { backgroundColor: colors.primary },
                        ]}
                    >
                        <Ionicons
                            name="sunny"
                            size={20}
                            color={!isDark ? colors.primaryText : colors.text}
                        />
                        <Text
                            style={[
                                styles.modeText,
                                { color: !isDark ? colors.primaryText : colors.text },
                            ]}
                        >
                            {t('settings.lightMode')}
                        </Text>
                    </Pressable>

                    <Pressable
                        onPress={() => setMode('dark')}
                        style={[
                            styles.modeButton,
                            isDark && { backgroundColor: colors.primary },
                        ]}
                    >
                        <Ionicons
                            name="moon"
                            size={20}
                            color={isDark ? colors.primaryText : colors.text}
                        />
                        <Text
                            style={[
                                styles.modeText,
                                { color: isDark ? colors.primaryText : colors.text },
                            ]}
                        >
                            {t('settings.darkMode')}
                        </Text>
                    </Pressable>
                </View>
            </View>

            {/* Variant Selector */}
            <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
                    {t('settings.themeVariant')}
                </Text>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.variantsContainer}
                >
                    {currentVariants.map((variant) => {
                        const isSelected = config.variant === variant;
                        return (
                            <Pressable
                                key={variant}
                                onPress={() => setVariant(variant)}
                                style={[
                                    styles.variantButton,
                                    { backgroundColor: colors.surface, borderColor: colors.border },
                                    isSelected && { borderColor: colors.primary, borderWidth: 2 },
                                ]}
                            >
                                <View
                                    style={[
                                        styles.variantPreview,
                                        { backgroundColor: getVariantPreviewColor(variant, isDark) },
                                    ]}
                                />
                                <Text
                                    style={[
                                        styles.variantText,
                                        { color: isSelected ? colors.primary : colors.text },
                                    ]}
                                >
                                    {themeDisplayNames[variant]}
                                </Text>
                                {isSelected && (
                                    <Ionicons
                                        name="checkmark-circle"
                                        size={16}
                                        color={colors.primary}
                                        style={styles.checkIcon}
                                    />
                                )}
                            </Pressable>
                        );
                    })}
                </ScrollView>
            </View>
        </View>
    );
};

// Helper to get preview colors for variants
function getVariantPreviewColor(
    variant: DarkThemeVariant | LightThemeVariant,
    isDark: boolean
): string {
    const previewColors: Record<string, string> = {
        // Dark variants
        zinc: '#27272a',
        slate: '#1e293b',
        crimson: '#7f1d1d',
        emerald: '#065f46',
        // Light variants
        neutral: '#e5e5e5',
        warm: '#fef3c7',
        cool: '#bae6fd',
    };
    return previewColors[variant] || (isDark ? '#27272a' : '#e5e5e5');
}

const styles = StyleSheet.create({
    container: {
        padding: 16,
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 12,
    },
    modeContainer: {
        flexDirection: 'row',
        borderRadius: 12,
        padding: 4,
    },
    modeButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        borderRadius: 10,
        gap: 8,
    },
    modeText: {
        fontSize: 15,
        fontWeight: '600',
    },
    variantsContainer: {
        gap: 12,
        paddingRight: 16,
    },
    variantButton: {
        width: 100,
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: 12,
        borderWidth: 1,
        alignItems: 'center',
    },
    variantPreview: {
        width: 40,
        height: 40,
        borderRadius: 20,
        marginBottom: 8,
    },
    variantText: {
        fontSize: 13,
        fontWeight: '500',
    },
    checkIcon: {
        position: 'absolute',
        top: 8,
        right: 8,
    },
});

export default ThemePicker;
