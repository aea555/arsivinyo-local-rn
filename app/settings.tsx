import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getErrorMessage } from '@/src/api/errors';
import { SettingsItem, ThemePicker } from '@/src/components';
import { BUILD_CONFIG } from '@/src/config';
import {
  type CookiePlatform,
  type CookieProfile,
  type CustomDomainProfile,
  type CustomDomainSummary,
  deleteCustomDomainProfile,
  getDefaultCookieProfile,
  importCookieProfile,
  importCustomCookieProfile,
  listCookieProfiles,
  listCustomDomainProfiles,
  listCustomDomains,
  LOCAL_COOKIE_PLATFORMS,
  setDefaultCookieProfile,
  setCustomDomainDefault,
} from '@/src/services';
import { useTheme } from '@/src/theme';

type CustomSelectorMode = 'default' | 'delete' | null;

export default function SettingsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();

  const [cookieSummary, setCookieSummary] = useState<Record<CookiePlatform, { count: number; defaultProfile: string | null }>>(
    Object.fromEntries(
      LOCAL_COOKIE_PLATFORMS.map((platform) => [platform, { count: 0, defaultProfile: null }])
    ) as Record<CookiePlatform, { count: number; defaultProfile: string | null }>
  );
  const [customDomains, setCustomDomains] = useState<CustomDomainSummary[]>([]);
  const [selectorPlatform, setSelectorPlatform] = useState<CookiePlatform | null>(null);
  const [selectorProfiles, setSelectorProfiles] = useState<CookieProfile[]>([]);
  const [selectorDefaultProfile, setSelectorDefaultProfile] = useState<string | null>(null);

  const [customSelectorMode, setCustomSelectorMode] = useState<CustomSelectorMode>(null);
  const [customSelectorDomain, setCustomSelectorDomain] = useState<string | null>(null);
  const [customSelectorProfiles, setCustomSelectorProfiles] = useState<CustomDomainProfile[]>([]);
  const [customSelectorDefaultProfile, setCustomSelectorDefaultProfile] = useState<string | null>(null);

  const [showCustomImportModal, setShowCustomImportModal] = useState(false);
  const [customImportDomain, setCustomImportDomain] = useState('');
  const [diagnosticUnlockTaps, setDiagnosticUnlockTaps] = useState(0);

  const refreshCookieData = useCallback(async () => {
    try {
      const [summaryEntries, customDomainList] = await Promise.all([
        Promise.all(
          LOCAL_COOKIE_PLATFORMS.map(async (platform) => {
            const [profiles, defaultProfile] = await Promise.all([
              listCookieProfiles(platform),
              getDefaultCookieProfile(platform),
            ]);

            return [platform, { count: profiles.length, defaultProfile }] as const;
          })
        ),
        listCustomDomains(),
      ]);

      setCookieSummary(Object.fromEntries(summaryEntries) as Record<CookiePlatform, { count: number; defaultProfile: string | null }>);
      setCustomDomains(customDomainList);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      Alert.alert(t('common.error'), getErrorMessage(code));
    }
  }, [t]);

  useEffect(() => {
    void refreshCookieData();
  }, [refreshCookieData]);

  const customDefaultsMap = useMemo(() => {
    return Object.fromEntries(customDomains.map((item) => [item.domain, item.defaultProfileName])) as Record<string, string | null>;
  }, [customDomains]);

  const handleImportCookie = useCallback(async (platform: CookiePlatform) => {
    try {
      const result = await importCookieProfile(platform);
      if (!result.imported) {
        return;
      }

      if (result.profileName) {
        await setDefaultCookieProfile(platform, result.profileName);
      }

      await refreshCookieData();
      Alert.alert(t('common.success'), t('settings.cookieImportSuccess', { platform, profile: result.profileName ?? 'default' }));
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      Alert.alert(t('common.error'), getErrorMessage(code));
    }
  }, [refreshCookieData, t]);

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
      await refreshCookieData();
      setSelectorDefaultProfile(profileName);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      Alert.alert(t('common.error'), getErrorMessage(code));
    }
  }, [refreshCookieData, t]);

  const openCustomImportModal = useCallback((presetDomain?: string) => {
    setCustomImportDomain(presetDomain ?? '');
    setShowCustomImportModal(true);
  }, []);

  const closeCustomImportModal = useCallback(() => {
    setShowCustomImportModal(false);
    setCustomImportDomain('');
  }, []);

  const handleImportCustomCookie = useCallback(async () => {
    try {
      const result = await importCustomCookieProfile({
        domain: customImportDomain.trim() || null,
      });
      if (!result.imported || !result.result) {
        closeCustomImportModal();
        return;
      }

      await refreshCookieData();
      closeCustomImportModal();
      Alert.alert(
        t('common.success'),
        t('settings.customCookieImportSuccess', {
          profile: result.result.profileName,
          domains: result.result.boundDomains.length,
        }),
      );
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      Alert.alert(t('common.error'), getErrorMessage(code));
    }
  }, [closeCustomImportModal, customImportDomain, refreshCookieData, t]);

  const closeCustomSelector = useCallback(() => {
    setCustomSelectorMode(null);
    setCustomSelectorDomain(null);
    setCustomSelectorProfiles([]);
    setCustomSelectorDefaultProfile(null);
  }, []);

  const openCustomSelector = useCallback(async (domain: string, mode: Exclude<CustomSelectorMode, null>) => {
    try {
      const profiles = await listCustomDomainProfiles(domain);
      if (profiles.length === 0) {
        Alert.alert(t('common.error'), t('settings.noCustomDomainProfiles'));
        return;
      }
      setCustomSelectorMode(mode);
      setCustomSelectorDomain(domain);
      setCustomSelectorProfiles(profiles);
      setCustomSelectorDefaultProfile(customDefaultsMap[domain] ?? null);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      Alert.alert(t('common.error'), getErrorMessage(code));
    }
  }, [customDefaultsMap, t]);

  const handleCustomDomainPress = useCallback((domain: string) => {
    Alert.alert(
      domain,
      t('settings.customDomainActionPrompt'),
      [
        {
          text: t('settings.importCustomCookieAction'),
          onPress: () => {
            openCustomImportModal(domain);
          },
        },
        {
          text: t('settings.selectCustomDefaultAction'),
          onPress: () => {
            void openCustomSelector(domain, 'default');
          },
        },
        {
          text: t('settings.deleteCustomProfileAction'),
          style: 'destructive',
          onPress: () => {
            void openCustomSelector(domain, 'delete');
          },
        },
        {
          text: t('common.cancel'),
          style: 'cancel',
        },
      ],
    );
  }, [openCustomImportModal, openCustomSelector, t]);

  const handleSetCustomDefaultProfile = useCallback(async (domain: string, profileName: string) => {
    try {
      await setCustomDomainDefault(domain, profileName);
      await refreshCookieData();
      setCustomSelectorDefaultProfile(profileName);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      Alert.alert(t('common.error'), getErrorMessage(code));
    }
  }, [refreshCookieData, t]);

  const handleDeleteCustomProfile = useCallback(async (domain: string, profileName: string) => {
    Alert.alert(
      t('settings.deleteCustomProfileConfirmTitle'),
      t('settings.deleteCustomProfileConfirmMessage', { profile: profileName }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.deleteCustomProfileAction'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCustomDomainProfile(domain, profileName);
              await refreshCookieData();
              const remaining = await listCustomDomainProfiles(domain);
              if (remaining.length === 0) {
                closeCustomSelector();
              } else {
                setCustomSelectorProfiles(remaining);
                const currentDefault = customDefaultsMap[domain];
                const nextDefault = remaining.some((entry) => entry.profileName === currentDefault)
                  ? currentDefault
                  : remaining[0]?.profileName ?? null;
                setCustomSelectorDefaultProfile(nextDefault);
              }
            } catch (error) {
              const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
              Alert.alert(t('common.error'), getErrorMessage(code));
            }
          },
        },
      ],
    );
  }, [closeCustomSelector, customDefaultsMap, refreshCookieData, t]);

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
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
            {t('settings.appearance')}
          </Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.surface }]}>
            <ThemePicker />
          </View>
        </View>

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

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
            {t('settings.customCookieDomains')}
          </Text>
          <View style={[styles.sectionContent, { backgroundColor: colors.surface }]}>
            <SettingsItem
              icon="add-circle-outline"
              title={t('settings.addCustomCookie')}
              subtitle={t('settings.customDomainOptionalHint')}
              onPress={() => openCustomImportModal()}
            />
            {customDomains.map((entry) => (
              <SettingsItem
                key={entry.domain}
                icon="globe-outline"
                title={entry.domain}
                subtitle={t('settings.customDomainHint', {
                  count: entry.profileCount,
                  defaultProfile: entry.defaultProfileName ?? t('settings.noDefaultCookie'),
                })}
                onPress={() => handleCustomDomainPress(entry.domain)}
              />
            ))}
          </View>
        </View>

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

      <Modal
        visible={customSelectorDomain !== null && customSelectorMode !== null}
        transparent
        animationType="fade"
        onRequestClose={closeCustomSelector}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {customSelectorDomain && customSelectorMode === 'default'
                ? t('settings.selectDefaultForDomain', { domain: customSelectorDomain })
                : customSelectorDomain
                  ? t('settings.selectDeleteProfileForDomain', { domain: customSelectorDomain })
                  : ''}
            </Text>
            <ScrollView style={styles.modalList}>
              {customSelectorDomain && customSelectorProfiles.map((profile) => {
                const selected = customSelectorDefaultProfile === profile.profileName;
                return (
                  <Pressable
                    key={`${customSelectorDomain}-${profile.profileId}`}
                    onPress={() => {
                      if (!customSelectorDomain) return;
                      if (customSelectorMode === 'delete') {
                        void handleDeleteCustomProfile(customSelectorDomain, profile.profileName);
                        return;
                      }
                      void handleSetCustomDefaultProfile(customSelectorDomain, profile.profileName);
                    }}
                    style={({ pressed }) => [
                      styles.modalItem,
                      {
                        backgroundColor: pressed ? colors.surfaceHover : 'transparent',
                        borderColor: customSelectorMode === 'default' && selected ? colors.accent : colors.border,
                      },
                    ]}
                  >
                    <Text style={[
                      styles.modalItemTitle,
                      {
                        color: customSelectorMode === 'delete'
                          ? colors.error
                          : (customSelectorMode === 'default' && selected ? colors.accent : colors.text),
                      },
                    ]}>
                      {profile.profileName}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              onPress={closeCustomSelector}
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

      <Modal
        visible={showCustomImportModal}
        transparent
        animationType="fade"
        onRequestClose={closeCustomImportModal}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {t('settings.addCustomCookie')}
            </Text>
            <Text style={[styles.inputLabel, { color: colors.textMuted }]}>
              {t('settings.customDomainOptionalInputLabel')}
            </Text>
            <TextInput
              value={customImportDomain}
              onChangeText={setCustomImportDomain}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t('settings.customDomainOptionalPlaceholder')}
              placeholderTextColor={colors.textMuted}
              style={[
                styles.input,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={closeCustomImportModal}
                style={({ pressed }) => [
                  styles.modalActionButton,
                  { backgroundColor: pressed ? colors.surfaceHover : colors.background },
                ]}
              >
                <Text style={[styles.modalCloseText, { color: colors.text }]}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  void handleImportCustomCookie();
                }}
                style={({ pressed }) => [
                  styles.modalActionButton,
                  { backgroundColor: pressed ? colors.accent + 'bb' : colors.accent },
                ]}
              >
                <Text style={[styles.modalCloseText, { color: colors.background }]}>{t('settings.importCustomCookieAction')}</Text>
              </Pressable>
            </View>
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
    maxHeight: '75%',
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
  inputLabel: {
    fontSize: 12,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  modalActions: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 8,
  },
  modalActionButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
});
