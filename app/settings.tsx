import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SettingsItem, ThemePicker } from '@/src/components';
import { BUILD_CONFIG } from '@/src/config';
import {
    getDefaultCookieProfile,
    importCookieProfile,
    listCookieProfiles,
    LOCAL_COOKIE_PLATFORMS,
    setDefaultCookieProfile,
} from '@/src/services';
import type { CookiePlatform } from '@/src/services';
import { useTheme } from '@/src/theme';

export default function SettingsScreen() {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const router = useRouter();

    const [cookieSummary, setCookieSummary] = useState<Record<CookiePlatform, { count: number; defaultProfile: string | null }>>({
        youtube: { count: 0, defaultProfile: null },
        instagram: { count: 0, defaultProfile: null },
        facebook: { count: 0, defaultProfile: null },
        twitter: { count: 0, defaultProfile: null },
        reddit: { count: 0, defaultProfile: null },
    });
    const [diagnosticUnlockTaps, setDiagnosticUnlockTaps] = useState(0);

    const refreshCookieSummary = useCallback(async () => {
        const summaryEntries = await Promise.all(
            LOCAL_COOKIE_PLATFORMS.map(async (platform) => {
                const [profiles, defaultProfile] = await Promise.all([
                    listCookieProfiles(platform),
                    getDefaultCookieProfile(platform),
                ]);

                return [platform, { count: profiles.length, defaultProfile }] as const;
            })
        );

        setCookieSummary(Object.fromEntries(summaryEntries) as Record<CookiePlatform, { count: number; defaultProfile: string | null }>);
    }, []);

    useEffect(() => {
        refreshCookieSummary();
    }, [refreshCookieSummary]);

    const handleImportCookie = useCallback(async (platform: CookiePlatform) => {
        try {
            const result = await importCookieProfile(platform);
            if (!result.imported) {
                return;
            }

            if (result.profileName) {
                await setDefaultCookieProfile(platform, result.profileName);
            }

            await refreshCookieSummary();
            Alert.alert(t('common.success'), t('settings.cookieImportSuccess', { platform, profile: result.profileName ?? 'default' }));
        } catch (error) {
            const message = error instanceof Error ? error.message : t('errors.UNKNOWN_ERROR');
            Alert.alert(t('common.error'), message);
        }
    }, [refreshCookieSummary, t]);

    const handleClose = useCallback(() => {
        router.back();
    }, [router]);

    const handleVersionPress = useCallback(() => {
        setDiagnosticUnlockTaps((prev) => prev + 1);
    }, []);

    const openDiagnostics = useCallback(() => {
        router.push('/diagnostics' as never);
    }, [router]);

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
                <Text style={[styles.headerTitle, { color: colors.text }]}>
                    {t('settings.title')}
                </Text>
                <Pressable
                    onPress={handleClose}
                    hitSlop={8}
                    style={({ pressed }) => [
                        styles.closeButton,
                        { backgroundColor: pressed ? colors.surfaceHover : colors.surface },
                    ]}
                >
                    <Ionicons name="close" size={20} color={colors.text} />
                </Pressable>
            </View>

            <ScrollView
                style={styles.content}
                contentContainerStyle={styles.contentContainer}
            >
                {/* Appearance Section */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
                        {t('settings.appearance')}
                    </Text>
                    <View style={[styles.sectionContent, { backgroundColor: colors.surface }]}>
                        <ThemePicker />
                    </View>
                </View>

                {/* Cookie Profiles Section */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
                        {t('settings.cookieProfiles')}
                    </Text>
                    <View style={[styles.sectionContent, { backgroundColor: colors.surface }]}>
                        {LOCAL_COOKIE_PLATFORMS.map((platform) => (
                            <SettingsItem
                                key={platform}
                                icon="document-attach-outline"
                                title={t(`settings.cookiePlatform.${platform}`)}
                                subtitle={t('settings.cookiePlatformHint', {
                                    count: cookieSummary[platform].count,
                                    defaultProfile: cookieSummary[platform].defaultProfile ?? t('settings.noDefaultCookie'),
                                })}
                                onPress={() => handleImportCookie(platform)}
                            />
                        ))}
                    </View>
                </View>

                {/* About Section */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
                        {t('settings.about')}
                    </Text>
                    <View style={[styles.sectionContent, { backgroundColor: colors.surface }]}>
                        <SettingsItem
                            icon="information-circle-outline"
                            title={t('settings.version')}
                            value={BUILD_CONFIG.APP_VERSION}
                            onPress={handleVersionPress}
                            showArrow={false}
                        />
                        {(diagnosticUnlockTaps >= 7 || __DEV__) && (
                            <SettingsItem
                                icon="bug-outline"
                                title={t('settings.diagnostics')}
                                subtitle={t('settings.diagnosticsHint')}
                                onPress={openDiagnostics}
                            />
                        )}
                    </View>
                </View>
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
        fontSize: 24,
        fontWeight: '700',
    },
    closeButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
    },
    content: {
        flex: 1,
    },
    contentContainer: {
        padding: 20,
        paddingBottom: 40,
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 8,
        marginLeft: 4,
    },
    sectionContent: {
        borderRadius: 16,
        overflow: 'hidden',
        padding: 16,
        gap: 8,
    },
});
