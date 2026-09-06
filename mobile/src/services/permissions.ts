import { Alert, Linking, Platform } from 'react-native';

export interface PermissionStatus {
  granted: boolean;
  canAskAgain: boolean;
}

/**
 * Storage/media access is handled by Android MediaStore + Photo Picker in this build.
 * No broad media permission is requested up-front.
 */
export async function checkMediaPermission(): Promise<PermissionStatus> {
  return {
    granted: true,
    canAskAgain: false,
  };
}

export async function requestMediaPermission(): Promise<PermissionStatus> {
  return checkMediaPermission();
}

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

export async function openAppSettings(): Promise<void> {
  if (Platform.OS === 'ios') {
    await Linking.openURL('app-settings:');
  } else {
    await Linking.openSettings();
  }
}

export function showPermissionDeniedAlert(
  title: string,
  message: string,
  openSettingsText: string
): void {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: openSettingsText,
      onPress: () => {
        void openAppSettings();
      },
    },
  ]);
}
