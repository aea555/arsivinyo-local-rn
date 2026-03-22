import { EventEmitter, type EventSubscription, requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import type {
  LocalCookieProfile,
  LocalBackgroundPermissionResult,
  LocalBackgroundState,
  LocalBackgroundStateEvent,
  LocalCustomCookieImportInput,
  LocalCustomCookieImportResult,
  LocalCustomDomainProfile,
  LocalCustomDomainSummary,
  LocalDiagnostics,
  LocalDownloadEvent,
  LocalDownloadStartInput,
  LocalDownloadStartResult,
  LocalPrivateAuthPurpose,
  LocalPrivateAuthResult,
  LocalPrivateModeState,
  LocalPrivateVideoItem,
  LocalImpersonationSelfTestResult,
  LocalPrivateCopyToPublicResult,
  LocalSaveToMediaStoreInput,
  LocalSaveToMediaStoreResult,
  LocalPlatform,
  LocalPrivateImportResult,
  LocalQuickDownloadResult,
  LocalTaskStatusResult,
} from './LocalDownloader.types';

type LocalDownloaderNativeModule = {
  startDownload(input: LocalDownloadStartInput): Promise<LocalDownloadStartResult>;
  getTaskStatus(taskId: string): Promise<LocalTaskStatusResult>;
  cancelTask(taskId: string): Promise<{ success: boolean }>;
  getBackgroundState(): Promise<LocalBackgroundState>;
  ensureBackgroundPermission(): Promise<LocalBackgroundPermissionResult>;
  startQuickDownloadFromClipboard(): Promise<LocalQuickDownloadResult>;
  startQuickDownloadWithUrl(input: { url: string }): Promise<LocalQuickDownloadResult>;
  getPrivateModeState(): Promise<LocalPrivateModeState>;
  setPrivateModeEnabled(input: { enabled: boolean }): Promise<LocalPrivateModeState>;
  authenticatePrivateAccess(input: { purpose: LocalPrivateAuthPurpose }): Promise<LocalPrivateAuthResult>;
  listPrivateVideos(): Promise<LocalPrivateVideoItem[]>;
  deletePrivateVideo(input: { id: string }): Promise<{ success: boolean }>;
  copyPrivateVideoToPublicGallery(input: { id: string }): Promise<LocalPrivateCopyToPublicResult>;
  pickAndImportVideoToPrivateVault(): Promise<LocalPrivateImportResult>;
  makeVideoPublic(input: { id: string }): Promise<{ success: boolean; uri?: string; code?: string; message?: string }>;
  preparePrivatePlayback(input: { id: string; traceId?: string }): Promise<{ success: boolean; tempUri?: string; mimeType?: string }>;
  setSecureScreen(input: { enabled: boolean }): Promise<{ success: boolean }>;
  clearPrivatePlaybackCache(): Promise<void>;
  importCookie(input: { platform: LocalPlatform; uri: string; profileName: string }): Promise<{ profileName: string; path: string }>;
  listCookieProfiles(platform: LocalPlatform): Promise<LocalCookieProfile[]>;
  setCookieDefault(input: { platform: LocalPlatform; profileName: string }): Promise<{ success: boolean }>;
  deleteCookieProfile(input: { platform: LocalPlatform; profileName: string }): Promise<{ success: boolean }>;
  getCookieDefaults(): Promise<Record<LocalPlatform, string | null>>;
  importCustomCookie(input: LocalCustomCookieImportInput): Promise<LocalCustomCookieImportResult>;
  listCustomDomains(): Promise<LocalCustomDomainSummary[]>;
  listCustomDomainProfiles(domain: string): Promise<LocalCustomDomainProfile[]>;
  setCustomDomainDefault(input: { domain: string; profileName: string }): Promise<{ success: boolean }>;
  deleteCustomDomainProfile(input: { domain: string; profileName: string }): Promise<{ success: boolean }>;
  getDiagnostics(): Promise<LocalDiagnostics>;
  runImpersonationSelfTest(): Promise<LocalImpersonationSelfTestResult>;
  saveToMediaStore(input: LocalSaveToMediaStoreInput): Promise<LocalSaveToMediaStoreResult>;
};

const unsupported = (): never => {
  throw new Error('Local downloader native module is available on Android development builds only.');
};

const NativeLocalDownloader: LocalDownloaderNativeModule = Platform.OS === 'android'
  ? requireNativeModule<LocalDownloaderNativeModule>('LocalDownloader')
  : {
      startDownload: async () => unsupported(),
      getTaskStatus: async () => unsupported(),
      cancelTask: async () => unsupported(),
      getBackgroundState: async () => unsupported(),
      ensureBackgroundPermission: async () => unsupported(),
      startQuickDownloadFromClipboard: async () => unsupported(),
      startQuickDownloadWithUrl: async () => unsupported(),
      getPrivateModeState: async () => unsupported(),
      setPrivateModeEnabled: async () => unsupported(),
      authenticatePrivateAccess: async () => unsupported(),
      listPrivateVideos: async () => unsupported(),
      deletePrivateVideo: async () => unsupported(),
      copyPrivateVideoToPublicGallery: async () => unsupported(),
      pickAndImportVideoToPrivateVault: async () => unsupported(),
      makeVideoPublic: async () => unsupported(),
      preparePrivatePlayback: async () => unsupported(),
      setSecureScreen: async () => unsupported(),
      clearPrivatePlaybackCache: async () => unsupported(),
      importCookie: async () => unsupported(),
      listCookieProfiles: async () => unsupported(),
      setCookieDefault: async () => unsupported(),
      deleteCookieProfile: async () => unsupported(),
      getCookieDefaults: async () => unsupported(),
      importCustomCookie: async () => unsupported(),
      listCustomDomains: async () => unsupported(),
      listCustomDomainProfiles: async () => unsupported(),
      setCustomDomainDefault: async () => unsupported(),
      deleteCustomDomainProfile: async () => unsupported(),
      getDiagnostics: async () => unsupported(),
      runImpersonationSelfTest: async () => unsupported(),
      saveToMediaStore: async () => unsupported(),
    };
const emitter: any = Platform.OS === 'android' ? new EventEmitter(NativeLocalDownloader as never) : null;

export function addDownloadProgressListener(listener: (event: LocalDownloadEvent) => void): EventSubscription {
  if (!emitter) {
    return { remove: () => undefined };
  }
  return emitter.addListener('downloadProgress', listener);
}

export function addBackgroundStateListener(listener: (event: LocalBackgroundStateEvent) => void): EventSubscription {
  if (!emitter) {
    return { remove: () => undefined };
  }
  return emitter.addListener('backgroundStateChanged', listener);
}

export default NativeLocalDownloader;
