import { Platform } from 'react-native';
import LocalDownloaderModule, {
  addBackgroundStateListener,
  addDownloadProgressListener,
  addYtDlpUpdateProgressListener,
  type LocalBackgroundPermissionResult,
  type LocalBackgroundDownloadsState,
  type LocalStickyNotificationState,
  type LocalBackgroundState,
  type LocalBackgroundStateEvent,
  type LocalCookieProfile,
  type LocalCustomCookieImportInput,
  type LocalCustomCookieImportResult,
  type LocalCustomDomainProfile,
  type LocalCustomDomainSummary,
  type LocalDiagnostics,
  type LocalDownloadFailureLog,
  type LocalDownloadEvent,
  type LocalDownloadStartInput,
  type LocalDownloadStartResult,
  type LocalImpersonationSelfTestResult,
  type LocalPrivateAuthPurpose,
  type LocalPrivateAuthResult,
  type LocalPrivateCopyToPublicResult,
  type LocalPrivateImportResult,
  type LocalPrivateModeState,
  type LocalPrivateVideoItem,
  type LocalSaveToMediaStoreInput,
  type LocalSaveToMediaStoreResult,
  type LocalPlatform,
  type LocalQuickDownloadResult,
  type LocalTaskStatusResult,
  type LocalYtDlpUpdateCheckResult,
  type LocalYtDlpUpdateProgressEvent,
  type LocalYtDlpUpdateResult,
  type LocalYtDlpUpdateStatus,
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

export function listenBackgroundState(listener: (event: LocalBackgroundStateEvent) => void) {
  ensureAndroid();
  return addBackgroundStateListener(listener);
}

export function listenYtDlpUpdateProgress(listener: (event: LocalYtDlpUpdateProgressEvent) => void) {
  ensureAndroid();
  return addYtDlpUpdateProgressListener(listener);
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

export async function getLocalBackgroundState(): Promise<LocalBackgroundState> {
  ensureAndroid();
  return LocalDownloaderModule.getBackgroundState();
}

export async function ensureLocalBackgroundPermission(): Promise<LocalBackgroundPermissionResult> {
  ensureAndroid();
  return LocalDownloaderModule.ensureBackgroundPermission();
}

export async function setLocalBackgroundDownloadsEnabled(enabled: boolean): Promise<LocalBackgroundDownloadsState> {
  ensureAndroid();
  return LocalDownloaderModule.setBackgroundDownloadsEnabled({ enabled });
}

export async function setLocalStickyNotificationEnabled(enabled: boolean): Promise<LocalStickyNotificationState> {
  ensureAndroid();
  return LocalDownloaderModule.setStickyNotificationEnabled({ enabled });
}

export async function startQuickLocalDownloadFromClipboard(): Promise<LocalQuickDownloadResult> {
  ensureAndroid();
  return LocalDownloaderModule.startQuickDownloadFromClipboard();
}

export async function startQuickLocalDownloadWithUrl(url: string): Promise<LocalQuickDownloadResult> {
  ensureAndroid();
  return LocalDownloaderModule.startQuickDownloadWithUrl({ url });
}

export async function getLocalPrivateModeState(): Promise<LocalPrivateModeState> {
  ensureAndroid();
  return LocalDownloaderModule.getPrivateModeState();
}

export async function setLocalPrivateModeEnabled(enabled: boolean): Promise<LocalPrivateModeState> {
  ensureAndroid();
  return LocalDownloaderModule.setPrivateModeEnabled({ enabled });
}

export async function authenticateLocalPrivateAccess(purpose: LocalPrivateAuthPurpose): Promise<LocalPrivateAuthResult> {
  ensureAndroid();
  return LocalDownloaderModule.authenticatePrivateAccess({ purpose });
}

export async function listLocalPrivateVideos(): Promise<LocalPrivateVideoItem[]> {
  ensureAndroid();
  return LocalDownloaderModule.listPrivateVideos();
}

export async function deleteLocalPrivateVideo(id: string): Promise<{ success: boolean }> {
  ensureAndroid();
  return LocalDownloaderModule.deletePrivateVideo({ id });
}

export async function copyLocalPrivateVideoToPublicGallery(id: string): Promise<LocalPrivateCopyToPublicResult> {
  ensureAndroid();
  return LocalDownloaderModule.copyPrivateVideoToPublicGallery({ id });
}

export async function pickAndImportLocalVideoToPrivateVault(): Promise<LocalPrivateImportResult> {
  ensureAndroid();
  return LocalDownloaderModule.pickAndImportVideoToPrivateVault();
}

export async function makeLocalVideoPublic(id: string): Promise<{ success: boolean; uri?: string; code?: string; message?: string }> {
  ensureAndroid();
  return LocalDownloaderModule.makeVideoPublic({ id });
}

export async function prepareLocalPrivatePlayback(
  id: string,
  traceId?: string
): Promise<{ success: boolean; tempUri?: string; mimeType?: string }> {
  ensureAndroid();
  return LocalDownloaderModule.preparePrivatePlayback({ id, traceId });
}

export async function setLocalSecureScreen(enabled: boolean): Promise<{ success: boolean }> {
  ensureAndroid();
  return LocalDownloaderModule.setSecureScreen({ enabled });
}

export async function clearLocalPrivatePlaybackCache(): Promise<void> {
  ensureAndroid();
  return LocalDownloaderModule.clearPrivatePlaybackCache();
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

export async function getLocalDownloadFailureLogs(): Promise<LocalDownloadFailureLog[]> {
  ensureAndroid();
  return LocalDownloaderModule.getDownloadFailureLogs();
}

export async function getLocalYtDlpUpdateStatus(): Promise<LocalYtDlpUpdateStatus> {
  ensureAndroid();
  return LocalDownloaderModule.getYtDlpUpdateStatus();
}

export async function checkLocalYtDlpUpdate(): Promise<LocalYtDlpUpdateCheckResult> {
  ensureAndroid();
  return LocalDownloaderModule.checkYtDlpUpdate();
}

export async function updateLocalYtDlp(): Promise<LocalYtDlpUpdateResult> {
  ensureAndroid();
  return LocalDownloaderModule.updateYtDlp();
}

export async function clearLocalYtDlpOverride(): Promise<{ success: boolean; requiresRestart?: boolean }> {
  ensureAndroid();
  return LocalDownloaderModule.clearYtDlpOverride();
}

export async function runLocalImpersonationSelfTest(): Promise<LocalImpersonationSelfTestResult> {
  ensureAndroid();
  return LocalDownloaderModule.runImpersonationSelfTest();
}

export async function saveLocalFileToMediaStore(input: LocalSaveToMediaStoreInput): Promise<LocalSaveToMediaStoreResult> {
  ensureAndroid();
  return LocalDownloaderModule.saveToMediaStore(input);
}
