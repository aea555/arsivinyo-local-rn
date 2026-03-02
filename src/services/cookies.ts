import ExpoFileSystem from 'expo-file-system/build/ExpoFileSystem';
import LocalDownloaderModule, { type LocalCookieProfile, type LocalPlatform } from '../native/localDownloader';

export const LOCAL_COOKIE_PLATFORMS: LocalPlatform[] = ['youtube', 'instagram', 'facebook', 'twitter', 'reddit'];
export type CookiePlatform = LocalPlatform;
export type CookieProfile = LocalCookieProfile;

export async function listCookieProfiles(platform: CookiePlatform): Promise<LocalCookieProfile[]> {
  return LocalDownloaderModule.listCookieProfiles(platform);
}

export async function importCookieProfile(platform: CookiePlatform): Promise<{
  imported: boolean;
  profileName?: string;
  path?: string;
}> {
  let pickedFile;
  try {
    pickedFile = await ExpoFileSystem.pickFileAsync(undefined, 'text/*');
  } catch {
    return { imported: false };
  }

  const inferredName = ((pickedFile.uri.split('/').pop() || `profile_${Date.now()}`))
    .replace(/\.[^.]+$/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '_') || 'default';

  const imported = await LocalDownloaderModule.importCookie({
    platform,
    uri: pickedFile.uri,
    profileName: inferredName,
  });

  return {
    imported: true,
    profileName: imported.profileName,
    path: imported.path,
  };
}

export async function setDefaultCookieProfile(platform: CookiePlatform, profileName: string): Promise<void> {
  const result = await LocalDownloaderModule.setCookieDefault({ platform, profileName });
  if (!result.success) {
    throw new Error('INVALID_COOKIE_PROFILE');
  }
}

export async function getDefaultCookieProfile(platform: CookiePlatform): Promise<string | null> {
  const defaults = await LocalDownloaderModule.getCookieDefaults();
  return defaults[platform] ?? null;
}
