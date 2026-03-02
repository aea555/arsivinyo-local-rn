import * as MediaLibrary from 'expo-media-library';
import { Alert, Linking, Platform } from 'react-native';

export interface PermissionStatus {
    granted: boolean;
    canAskAgain: boolean;
}

/**
 * Check if media library permission is granted
 */
export async function checkMediaPermission(): Promise<PermissionStatus> {
    try {
        const { status, canAskAgain } = await MediaLibrary.getPermissionsAsync(true);
        return {
            granted: status === 'granted',
            canAskAgain: canAskAgain ?? true,
        };
    } catch (error) {
        // Expo Go doesn't have full MediaLibrary permissions configured
        // This happens when AUDIO permission is not declared in AndroidManifest
        console.warn('MediaLibrary permission check failed (Expo Go limitation):', error);
        // Return granted as true to allow the app to continue - actual save may still work
        // or fail gracefully at download time
        return {
            granted: true,
            canAskAgain: false,
        };
    }
}

/**
 * Request media library permission
 */
export async function requestMediaPermission(): Promise<PermissionStatus> {
    try {
        const { status, canAskAgain } = await MediaLibrary.requestPermissionsAsync(true);
        return {
            granted: status === 'granted',
            canAskAgain: canAskAgain ?? false,
        };
    } catch (error) {
        // Expo Go doesn't have full MediaLibrary permissions configured
        console.warn('MediaLibrary permission request failed (Expo Go limitation):', error);
        return {
            granted: true,
            canAskAgain: false,
        };
    }
}

/**
 * Check all required permissions
 */
export async function checkAllPermissions(): Promise<{
    media: PermissionStatus;
    allGranted: boolean;
}> {
    const media = await checkMediaPermission();

    return {
        media,
        allGranted: media.granted,
    };
}

/**
 * Request all required permissions
 */
export async function requestAllPermissions(): Promise<{
    media: PermissionStatus;
    allGranted: boolean;
}> {
    const media = await requestMediaPermission();

    return {
        media,
        allGranted: media.granted,
    };
}

/**
 * Open app settings (for when permissions are permanently denied)
 */
export async function openAppSettings(): Promise<void> {
    if (Platform.OS === 'ios') {
        await Linking.openURL('app-settings:');
    } else {
        await Linking.openSettings();
    }
}

/**
 * Show permission denied alert with option to open settings
 */
export function showPermissionDeniedAlert(
    title: string,
    message: string,
    openSettingsText: string
): void {
    Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel' },
        {
            text: openSettingsText,
            onPress: () => openAppSettings(),
        },
    ]);
}
