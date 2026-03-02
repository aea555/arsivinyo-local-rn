import * as Clipboard from 'expo-clipboard';
import { SUPPORTED_PLATFORM_HOSTS, type SupportedPlatform } from '../constants/supportedPlatforms';

/**
 * Regex for supported social media platforms (Twitter, Instagram, Facebook, Reddit only)
 */
const SUPPORTED_HOSTS = Object.values(SUPPORTED_PLATFORM_HOSTS).flat();

/**
 * Check if a string is a valid URL
 * Uses URL parsing instead of complex regex to avoid catastrophic backtracking
 */
export function isValidUrl(text: string): boolean {
    if (!text || typeof text !== 'string') {
        return false;
    }

    const trimmed = text.trim();

    // Quick sanity check - must have at least a dot for domain
    if (!trimmed.includes('.')) {
        return false;
    }

    // Try to parse as URL
    try {
        const urlString = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
        const url = new URL(urlString);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Check if URL is from a supported social media platform
 */
export function isSupportedPlatformUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
        return SUPPORTED_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    } catch {
        return false;
    }
}

export function getPlatformFromUrl(url: string): SupportedPlatform | null {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');

        for (const [platform, hosts] of Object.entries(SUPPORTED_PLATFORM_HOSTS)) {
            if (hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
                return platform as SupportedPlatform;
            }
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * Get the current clipboard content
 */
export async function getClipboardContent(): Promise<string | null> {
    try {
        const hasContent = await Clipboard.hasStringAsync();
        if (!hasContent) {
            return null;
        }
        return await Clipboard.getStringAsync();
    } catch (error) {
        console.error('Failed to read clipboard:', error);
        return null;
    }
}

/**
 * Get URL from clipboard if valid
 * Returns null if clipboard is empty or doesn't contain a valid URL
 */
export async function getUrlFromClipboard(): Promise<string | null> {
    const content = await getClipboardContent();

    if (!content) {
        return null;
    }

    const trimmed = content.trim();

    if (!isValidUrl(trimmed)) {
        return null;
    }

    // Ensure URL has protocol
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        return `https://${trimmed}`;
    }

    return trimmed;
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
    try {
        await Clipboard.setStringAsync(text);
        return true;
    } catch (error) {
        console.error('Failed to copy to clipboard:', error);
        return false;
    }
}
