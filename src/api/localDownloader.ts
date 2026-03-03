import { Platform } from 'react-native';
import LocalDownloaderModule, {
  addDownloadProgressListener,
  type LocalCookieProfile,
  type LocalCustomCookieImportInput,
  type LocalCustomCookieImportResult,
  type LocalCustomDomainProfile,
  type LocalCustomDomainSummary,
  type LocalDiagnostics,
  type LocalDownloadEvent,
  type LocalDownloadStartInput,
  type LocalDownloadStartResult,
  type LocalSaveToMediaStoreInput,
  type LocalSaveToMediaStoreResult,
  type LocalPlatform,
  type LocalTaskStatusResult,
} from '../native/localDownloader';

function ensureAndroid(): void {
  if (Platform.OS !== 'android') {
    throw new Error('Local downloader is Android-only in this release.');
  }
}

export function listenDownloadProgress(listener: (event: LocalDownloadEvent) => void) {
  ensureAndroid();
  return addDownloadProgressListener(listener);
}

export async function startLocalDownload(input: LocalDownloadStartInput): Promise<LocalDownloadStartResult> {
  ensureAndroid();
  return LocalDownloaderModule.startDownload(input);
}

export async function getLocalTaskStatus(taskId: string): Promise<LocalTaskStatusResult> {
  ensureAndroid();
  return LocalDownloaderModule.getTaskStatus(taskId);
}

export async function cancelLocalTask(taskId: string): Promise<{ success: boolean }> {
  ensureAndroid();
  return LocalDownloaderModule.cancelTask(taskId);
}

export async function importLocalCookie(input: {
  platform: LocalPlatform;
  uri: string;
  profileName: string;
}): Promise<{ profileName: string; path: string }> {
  ensureAndroid();
  return LocalDownloaderModule.importCookie(input);
}

export async function listLocalCookieProfiles(platform: LocalPlatform): Promise<LocalCookieProfile[]> {
  ensureAndroid();
  return LocalDownloaderModule.listCookieProfiles(platform);
}

export async function setLocalCookieDefault(input: {
  platform: LocalPlatform;
  profileName: string;
}): Promise<{ success: boolean }> {
  ensureAndroid();
  return LocalDownloaderModule.setCookieDefault(input);
}

export async function getLocalCookieDefaults(): Promise<Record<LocalPlatform, string | null>> {
  ensureAndroid();
  return LocalDownloaderModule.getCookieDefaults();
}

export async function importLocalCustomCookie(input: LocalCustomCookieImportInput): Promise<LocalCustomCookieImportResult> {
  ensureAndroid();
  return LocalDownloaderModule.importCustomCookie(input);
}

export async function listLocalCustomDomains(): Promise<LocalCustomDomainSummary[]> {
  ensureAndroid();
  return LocalDownloaderModule.listCustomDomains();
}

export async function listLocalCustomDomainProfiles(domain: string): Promise<LocalCustomDomainProfile[]> {
  ensureAndroid();
  return LocalDownloaderModule.listCustomDomainProfiles(domain);
}

export async function setLocalCustomDomainDefault(input: { domain: string; profileName: string }): Promise<{ success: boolean }> {
  ensureAndroid();
  return LocalDownloaderModule.setCustomDomainDefault(input);
}

export async function deleteLocalCustomDomainProfile(input: { domain: string; profileName: string }): Promise<{ success: boolean }> {
  ensureAndroid();
  return LocalDownloaderModule.deleteCustomDomainProfile(input);
}

export async function getLocalDiagnostics(): Promise<LocalDiagnostics> {
  ensureAndroid();
  return LocalDownloaderModule.getDiagnostics();
}

export async function saveLocalFileToMediaStore(input: LocalSaveToMediaStoreInput): Promise<LocalSaveToMediaStoreResult> {
  ensureAndroid();
  return LocalDownloaderModule.saveToMediaStore(input);
}
