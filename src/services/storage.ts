import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage keys
const KEYS = {
    DOWNLOAD_LOCATION: '@arsivinyo_download_location',
    DOWNLOAD_COUNT: '@arsivinyo_download_count',
    LAST_AD_SHOWN: '@arsivinyo_last_ad_shown',
} as const;

/**
 * Generic get function with type safety
 */
async function getItem<T>(key: string, defaultValue: T): Promise<T> {
    try {
        const value = await AsyncStorage.getItem(key);
        if (value === null) {
            return defaultValue;
        }
        return JSON.parse(value) as T;
    } catch (error) {
        console.error(`Failed to get ${key}:`, error);
        return defaultValue;
    }
}

/**
 * Generic set function
 */
async function setItem<T>(key: string, value: T): Promise<boolean> {
    try {
        await AsyncStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        console.error(`Failed to set ${key}:`, error);
        return false;
    }
}

// ============================================
// Download Location
// ============================================

/**
 * Get the saved download location path
 */
export async function getDownloadLocation(): Promise<string | null> {
    return getItem<string | null>(KEYS.DOWNLOAD_LOCATION, null);
}

/**
 * Save the download location path
 */
export async function setDownloadLocation(path: string): Promise<boolean> {
    return setItem(KEYS.DOWNLOAD_LOCATION, path);
}

// ============================================
// Download Count (for ad tracking)
// ============================================

/**
 * Get the current download count since last ad
 */
export async function getDownloadCount(): Promise<number> {
    return getItem<number>(KEYS.DOWNLOAD_COUNT, 0);
}

/**
 * Increment download count and return new value
 * Returns -1 if failed
 */
export async function incrementDownloadCount(): Promise<number> {
    const current = await getDownloadCount();
    const newCount = current + 1;
    const success = await setItem(KEYS.DOWNLOAD_COUNT, newCount);
    return success ? newCount : -1;
}

/**
 * Reset download count (after showing ad)
 */
export async function resetDownloadCount(): Promise<boolean> {
    return setItem(KEYS.DOWNLOAD_COUNT, 0);
}

/**
 * Check if it's time to show an interstitial ad
 * Returns true every 3 successful downloads
 */
export async function shouldShowInterstitialAd(): Promise<boolean> {
    const count = await getDownloadCount();
    return count > 0 && count % 3 === 0;
}

// ============================================
// Utility
// ============================================

/**
 * Clear all app storage (for debugging/reset)
 */
export async function clearAllStorage(): Promise<boolean> {
    try {
        const allKeys = Object.values(KEYS);
        await AsyncStorage.multiRemove(allKeys);
        return true;
    } catch (error) {
        console.error('Failed to clear storage:', error);
        return false;
    }
}
