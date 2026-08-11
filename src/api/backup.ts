import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import LocalDownloaderModule, {
    addBackupProgressListener,
    type LocalBackupCreateResult,
    type LocalBackupJobState,
    type LocalBackupPreview,
    type LocalBackupRestoreResult,
    type LocalBackupSecret,
    type LocalBackupSectionId,
} from '../native/localDownloader';
import {
    MAX_PASSPHRASE_WORDS,
    MIN_PASSPHRASE_WORDS,
    WORDLIST,
    generatePassphraseWords,
    uniformIndicesFromBytes,
} from '../features/backup/core';

/**
 * Whole-app backup and restore.
 *
 * The native module owns the container format, the encryption and every store it can reach
 * on its own. This layer owns exactly one thing native cannot: the preferences kept in
 * AsyncStorage. They are collected here into an opaque blob and handed down, so adding a
 * preference never needs a native change.
 */

function ensureAndroid(): void {
    if (Platform.OS !== 'android') {
        throw new Error('Backups are Android-only in this release.');
    }
}

/**
 * The AsyncStorage keys that make up the "settings" section.
 *
 * Deliberately an explicit list rather than `AsyncStorage.getAllKeys()`. A wildcard would
 * sweep up anything a library happens to store — caches, tokens, third-party state — and
 * put it in a file the user may share. Everything here is a preference the user set.
 *
 * Note what is *not* here: the audio-preset auto-apply configuration is stored natively and
 * travels in the music section instead, next to the tracks it applies to.
 */
export const BACKED_UP_SETTINGS_KEYS = [
    '@arsivinyo_theme',
    '@arsivinyo_download_location',
    '@arsivinyo_private_vault_sort_v1',
    '@arsivinyo_private_vault_show_tags_v1',
    '@arsivinyo_audio_presets_custom_v1',
    '@arsivinyo_audio_presets_builtin_overrides_v1',
] as const;

/** Read the backed-up preferences into the blob handed to the native writer. */
export async function collectSettingsBlob(): Promise<string> {
    const pairs = await AsyncStorage.multiGet([...BACKED_UP_SETTINGS_KEYS]);
    const settings: Record<string, string> = {};
    pairs.forEach(([key, value]) => {
        if (value !== null) settings[key] = value;
    });
    return JSON.stringify(settings);
}

/**
 * Write restored preferences back.
 *
 * Only keys in [BACKED_UP_SETTINGS_KEYS] are applied. A backup is a file that could have
 * been edited or come from somewhere else, so an unexpected key is ignored rather than
 * written — restoring must not be a way to set arbitrary storage.
 */
export async function applySettingsBlob(blob: string | null | undefined): Promise<number> {
    if (!blob) return 0;
    let parsed: unknown;
    try {
        parsed = JSON.parse(blob);
    } catch {
        return 0;
    }
    if (!parsed || typeof parsed !== 'object') return 0;

    const allowed = new Set<string>(BACKED_UP_SETTINGS_KEYS);
    const entries = Object.entries(parsed as Record<string, unknown>)
        .filter(([key, value]) => allowed.has(key) && typeof value === 'string')
        .map(([key, value]) => [key, value as string] as [string, string]);

    if (entries.length > 0) {
        await AsyncStorage.multiSet(entries);
    }
    return entries.length;
}

/**
 * Generate a passphrase using the platform CSPRNG.
 *
 * Randomness comes from the native module's `SecureRandom` because this runtime has no
 * `crypto.getRandomValues` and the project has no JS crypto dependency. `Math.random` is
 * not an option — a phrase drawn from it is only as unguessable as its seed.
 *
 * Rejection sampling keeps the draw uniform. With a 256-word list every byte maps cleanly
 * and nothing is ever rejected, but the guard costs nothing and keeps this correct if the
 * list changes size.
 */
export async function generatePassphrase(wordCount: number): Promise<string[]> {
    const needed = Math.max(MIN_PASSPHRASE_WORDS, Math.min(MAX_PASSPHRASE_WORDS, wordCount));
    let pool: number[] = [];

    // Loop rather than assume one batch suffices: `uniformIndicesFromBytes` returns null
    // when rejection consumed the pool before enough indices were accepted.
    for (;;) {
        const { bytes } = await LocalDownloaderModule.getSecureRandomBytes({
            count: Math.max(32, needed * 4),
        });
        pool = pool.concat(bytes);
        const indices = uniformIndicesFromBytes(pool, needed, WORDLIST.length);
        if (indices) {
            let i = 0;
            return generatePassphraseWords(needed, () => indices[i++]);
        }
    }
}

export { MAX_PASSPHRASE_WORDS, MIN_PASSPHRASE_WORDS };

/**
 * Write a backup to a location the user picks.
 *
 * Blocks for around a second per key slot while Argon2id runs, then for as long as it takes
 * to stream every selected section.
 */
export async function createBackup(input: {
    sections: LocalBackupSectionId[];
    secrets: LocalBackupSecret[];
    sectionSlots?: Record<string, string>;
    suggestedName?: string;
}): Promise<LocalBackupCreateResult> {
    ensureAndroid();
    const settings = input.sections.includes('settings')
        ? await collectSettingsBlob()
        : undefined;
    return LocalDownloaderModule.createBackup({ ...input, settings });
}

/**
 * The export or restore currently running, plus the outcome of the last one.
 *
 * A backup pins a foreground service, so it keeps going while the app is in the background
 * or the screen is closed. This is how a reopened screen finds out.
 */
export async function getBackupJobState(): Promise<LocalBackupJobState> {
    ensureAndroid();
    return LocalDownloaderModule.getBackupJobState();
}

export { addBackupProgressListener };

/** Read a picked backup's plaintext header. No secret needed. */
export async function previewBackup(): Promise<LocalBackupPreview> {
    ensureAndroid();
    return LocalDownloaderModule.previewBackup();
}

/**
 * Restore from a previewed backup, then write any restored preferences into AsyncStorage.
 *
 * Settings are applied here rather than natively because their shape belongs to this layer.
 * A failure to apply them does not undo the media that was already restored — the result
 * reports what landed either way.
 */
export async function restoreBackup(input: {
    uri: string;
    sections: LocalBackupSectionId[];
    secrets: LocalBackupSecret[];
}): Promise<LocalBackupRestoreResult & { settingsApplied: number }> {
    ensureAndroid();
    const result = await LocalDownloaderModule.restoreBackup(input);
    let settingsApplied = 0;
    if (result.success && input.sections.includes('settings')) {
        settingsApplied = await applySettingsBlob(result.settings);
    }
    return { ...result, settingsApplied };
}
