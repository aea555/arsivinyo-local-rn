import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage keys
const KEYS = {
    DOWNLOAD_LOCATION: '@arsivinyo_download_location',
    DOWNLOAD_COUNT: '@arsivinyo_download_count',
    LAST_AD_SHOWN: '@arsivinyo_last_ad_shown',
    PRIVATE_VAULT_SORT: '@arsivinyo_private_vault_sort_v1',
    PRIVATE_VAULT_SHOW_TAGS: '@arsivinyo_private_vault_show_tags_v1',
} as const;

export type PrivateVaultSortMode = 'alpha' | 'time' | 'size' | 'duration';
export type PrivateVaultSortDirection = 'asc' | 'desc';
export interface PrivateVaultSortPreference {
    mode: PrivateVaultSortMode;
    direction: PrivateVaultSortDirection;
}

const DEFAULT_PRIVATE_VAULT_SORT: PrivateVaultSortPreference = {
    mode: 'alpha',
    direction: 'asc',
};

const PRIVATE_VAULT_SORT_MODES: readonly PrivateVaultSortMode[] = ['alpha', 'time', 'size', 'duration'];
const PRIVATE_VAULT_SORT_DIRECTIONS: readonly PrivateVaultSortDirection[] = ['asc', 'desc'];

function sanitizePrivateVaultSort(value: unknown): PrivateVaultSortPreference {
    if (!value || typeof value !== 'object') return DEFAULT_PRIVATE_VAULT_SORT;
    const v = value as Partial<PrivateVaultSortPreference>;
    const mode = PRIVATE_VAULT_SORT_MODES.includes(v.mode as PrivateVaultSortMode)
        ? (v.mode as PrivateVaultSortMode)
        : DEFAULT_PRIVATE_VAULT_SORT.mode;
    const direction = PRIVATE_VAULT_SORT_DIRECTIONS.includes(v.direction as PrivateVaultSortDirection)
        ? (v.direction as PrivateVaultSortDirection)
        : DEFAULT_PRIVATE_VAULT_SORT.direction;
    return { mode, direction };
}

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

// ============================================
// Private Vault Sort Preference
// ============================================

export async function getPrivateVaultSort(): Promise<PrivateVaultSortPreference> {
    const raw = await getItem<unknown>(KEYS.PRIVATE_VAULT_SORT, null);
    return sanitizePrivateVaultSort(raw);
}

export async function setPrivateVaultSort(value: PrivateVaultSortPreference): Promise<boolean> {
    return setItem(KEYS.PRIVATE_VAULT_SORT, sanitizePrivateVaultSort(value));
}

export async function getPrivateVaultShowTags(): Promise<boolean> {
    const raw = await getItem<unknown>(KEYS.PRIVATE_VAULT_SHOW_TAGS, true);
    return typeof raw === 'boolean' ? raw : true;
}

export async function setPrivateVaultShowTags(value: boolean): Promise<boolean> {
    return setItem(KEYS.PRIVATE_VAULT_SHOW_TAGS, value);
}

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
