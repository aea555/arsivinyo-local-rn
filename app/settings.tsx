import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Alert,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SettingsItem, ThemePicker } from '@/src/components';
import { BUILD_CONFIG } from '@/src/config';
import { getErrorMessage } from '@/src/api/errors';
import {
    type CookiePlatform,
    type CookieProfile,
    getDefaultCookieProfile,
    importCookieProfile,
    listCookieProfiles,
    LOCAL_COOKIE_PLATFORMS,
    setDefaultCookieProfile,
} from '@/src/services';
import { useTheme } from '@/src/theme';

export default function SettingsScreen() {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const router = useRouter();

    const [cookieSummary, setCookieSummary] = useState<Record<CookiePlatform, { count: number; defaultProfile: string | null }>>(
        Object.fromEntries(
            LOCAL_COOKIE_PLATFORMS.map((platform) => [platform, { count: 0, defaultProfile: null }])
        ) as Record<CookiePlatform, { count: number; defaultProfile: string | null }>
    );
    const [selectorPlatform, setSelectorPlatform] = useState<CookiePlatform | null>(null);
    const [selectorProfiles, setSelectorProfiles] = useState<CookieProfile[]>([]);
    const [selectorDefaultProfile, setSelectorDefaultProfile] = useState<string | null>(null);
    const [diagnosticUnlockTaps, setDiagnosticUnlockTaps] = useState(0);

    const refreshCookieSummary = useCallback(async () => {
        try {
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
        } catch (error) {
            const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
            const message = getErrorMessage(code);
            Alert.alert(t('common.error'), message);
        }
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
            const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
            const message = getErrorMessage(code);
            Alert.alert(t('common.error'), message);
        }
    }, [refreshCookieSummary, t]);

    const openDefaultSelector = useCallback(async (platform: CookiePlatform) => {
        const profiles = await listCookieProfiles(platform);
        if (profiles.length === 0) {
            Alert.alert(t('common.error'), t('settings.noCookieProfiles'));
            return;
        }

        const defaultProfile = await getDefaultCookieProfile(platform);
        setSelectorProfiles(profiles);
        setSelectorDefaultProfile(defaultProfile);
        setSelectorPlatform(platform);
    }, [t]);

    const handleCookiePlatformPress = useCallback((platform: CookiePlatform) => {
        Alert.alert(
            t(`settings.cookiePlatform.${platform}`),
            t('settings.cookieActionPrompt'),
            [
                {
                    text: t('settings.importCookieAction'),
                    onPress: () => {
                        void handleImportCookie(platform);
                    },
                },
                {
                    text: t('settings.selectDefaultCookieAction'),
                    onPress: () => {
                        void openDefaultSelector(platform);
                    },
                },
                {
                    text: t('common.cancel'),
                    style: 'cancel',
                },
            ],
        );
    }, [handleImportCookie, openDefaultSelector, t]);

    const handleSetDefaultProfile = useCallback(async (platform: CookiePlatform, profileName: string) => {
        try {
            await setDefaultCookieProfile(platform, profileName);
            await refreshCookieSummary();
            setSelectorDefaultProfile(profileName);
        } catch (error) {
            const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
            const message = getErrorMessage(code);
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

    const closeSelector = useCallback(() => {
        setSelectorPlatform(null);
        setSelectorProfiles([]);
        setSelectorDefaultProfile(null);
    }, []);

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
                                onPress={() => handleCookiePlatformPress(platform)}
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

            <Modal
                visible={selectorPlatform !== null}
                transparent
                animationType="fade"
                onRequestClose={closeSelector}
            >
                <View style={styles.modalBackdrop}>
                    <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <Text style={[styles.modalTitle, { color: colors.text }]}>
                            {selectorPlatform ? t('settings.selectDefaultForPlatform', { platform: t(`settings.cookiePlatform.${selectorPlatform}`) }) : ''}
                        </Text>
                        <ScrollView style={styles.modalList}>
                            {selectorPlatform && selectorProfiles.map((profile) => {
                                const selected = selectorDefaultProfile === profile.profileName;
                                return (
                                    <Pressable
                                        key={`${selectorPlatform}-${profile.profileName}`}
                                        onPress={() => {
                                            void handleSetDefaultProfile(selectorPlatform, profile.profileName);
                                        }}
                                        style={({ pressed }) => [
                                            styles.modalItem,
                                            {
                                                backgroundColor: pressed ? colors.surfaceHover : 'transparent',
                                                borderColor: selected ? colors.accent : colors.border,
                                            },
                                        ]}
                                    >
                                        <Text style={[styles.modalItemTitle, { color: selected ? colors.accent : colors.text }]}>
                                            {profile.profileName}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </ScrollView>
                        <Pressable
                            onPress={closeSelector}
                            style={({ pressed }) => [
                                styles.modalCloseButton,
                                { backgroundColor: pressed ? colors.surfaceHover : colors.background },
                            ]}
                        >
                            <Text style={[styles.modalCloseText, { color: colors.text }]}>{t('common.cancel')}</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>
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
    modalBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.45)',
        justifyContent: 'center',
        padding: 20,
    },
    modalCard: {
        borderRadius: 16,
        borderWidth: 1,
        maxHeight: '70%',
        padding: 16,
    },
    modalTitle: {
        fontSize: 16,
        fontWeight: '700',
        marginBottom: 12,
    },
    modalList: {
        maxHeight: 260,
    },
    modalItem: {
        borderWidth: 1,
        borderRadius: 10,
        paddingVertical: 10,
        paddingHorizontal: 12,
        marginBottom: 8,
    },
    modalItemTitle: {
        fontSize: 14,
        fontWeight: '500',
    },
    modalCloseButton: {
        marginTop: 8,
        borderRadius: 10,
        paddingVertical: 10,
        alignItems: 'center',
    },
    modalCloseText: {
        fontSize: 14,
        fontWeight: '600',
    },
});
