import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra ?? {};

export const BUILD_CONFIG = {
    LOCAL_MODE: Boolean(extra.localMode),

    APP_VERSION: Constants.expoConfig?.version ?? '1.1.0',
};
