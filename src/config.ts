import Constants from 'expo-constants';

const expoConfig = Constants.expoConfig;
const extra = expoConfig?.extra ?? {};

const rawVersion = expoConfig?.version ?? '';
const rawVersionCode = (expoConfig as { android?: { versionCode?: number } } | null | undefined)?.android?.versionCode;

function deriveChannel(version: string): 'beta' | 'stable' | 'unknown' {
  if (!version) return 'unknown';
  if (version.includes('-beta.')) return 'beta';
  if (/-[a-z]+\./i.test(version)) return 'beta';
  return 'stable';
}

export const BUILD_CONFIG = {
    LOCAL_MODE: Boolean(extra.localMode),

    APP_VERSION: rawVersion,
    APP_VERSION_CODE: typeof rawVersionCode === 'number' ? rawVersionCode : null,
    APP_CHANNEL: deriveChannel(rawVersion),
};
