import { File } from 'expo-file-system';
import LocalDownloaderModule, { type LocalCookieProfile, type LocalPlatform } from '../native/localDownloader';

export const LOCAL_COOKIE_PLATFORMS: LocalPlatform[] = ['youtube', 'instagram', 'facebook', 'twitter', 'reddit', 'tiktok'];
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
  let pickedUri: string | undefined;
  try {
    const fileApi = File as unknown as { pickFileAsync: (initialUri?: string, mimeType?: string) => Promise<{ uri: string }> };
    const pickedFile = await fileApi.pickFileAsync(undefined, 'text/*');
    pickedUri = pickedFile?.uri;
  } catch {
    return { imported: false };
  }

  if (!pickedUri) {
    return { imported: false };
  }

  const inferredName = ((pickedUri.split('/').pop() || `profile_${Date.now()}`))
    .replace(/\.[^.]+$/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '_') || 'default';

  const imported = await LocalDownloaderModule.importCookie({
    platform,
    uri: pickedUri,
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
